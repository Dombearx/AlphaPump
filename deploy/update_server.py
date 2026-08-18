# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "fastapi",
#     "python-multipart",
#     "uvicorn",
# ]
# ///
"""Redeploys AlphaPump on request: git pull followed by a docker compose rebuild.

Runs directly on the deploy host, not in Docker, so it can invoke git and
docker without needing the host's docker socket mounted into a container.
Declares its own dependencies via inline script metadata (PEP 723) so `uv
run deploy/update_server.py` installs just fastapi/uvicorn into an isolated
environment instead of syncing the rest of this repo (pnpm workspace,
Turborepo, ...), which it has no need for.

Also receives Android releases. The build happens in GitHub Actions, which
already joins the NetBird network to call `/update` (see
`.github/workflows/deploy.yml`), so it can hand the `.apk` straight to this
server rather than the minipc having to poll GitHub for it. Uploads land in
the directory Caddy serves under `/alphapump/download`, which is where phones look for
updates -- see `deploy/docker-compose.yml` and `apps/mobile/src/update/`.

Neither endpoint is authenticated, matching the trust model the rest of the
deployment already uses: reachability inside the VPN *is* the authorization
(`docs/stack_technologiczny.md`). For the upload that is a deliberate second
line rather than the only one -- Android refuses to replace an installed
package unless the new file carries the same signature, so an APK published
here by anyone but the release workflow does not install over the real app.
"""

import hashlib
import json
import logging
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Annotated, Any

import uvicorn
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import JSONResponse, PlainTextResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

UPDATE_SERVER_HOST = "0.0.0.0"
DEFAULT_UPDATE_SERVER_PORT = 40002
COMPOSE_FILE = "deploy/docker-compose.yml"

# Where Caddy looks for downloadable releases: the host side of the `/srv/alphapump/download`
# volume in `deploy/docker-compose.yml`.
#
# Deliberately *not* read from `APK_DIR`, the variable compose uses for the same
# directory, even though the default points at the same place. Compose resolves
# relative paths against `deploy/`, while this server runs with the repository
# root as its working directory (see `alphapump-update-server.service`), so one
# `APK_DIR=./apk` would mean two different directories -- and the failure would
# be silent: uploads landing where Caddy is not looking.
DEFAULT_APK_DIR = "deploy/apk"

# The manifest phones read to learn a newer release exists. Written *after* the
# `.apk` it points at, so no phone ever sees a manifest for a missing file.
MANIFEST_NAME = "latest.json"

# Release filenames are built by the workflow, but they arrive over the network
# and end up as a path, so they are checked rather than trusted: no directory
# separators, no `..`, nothing but the shape the workflow produces.
APK_NAME = re.compile(r"^alphapump-\d+\.apk$")

# How many previous releases stay downloadable. Enough to put yesterday's build
# back on a phone by hand; not so many that the minipc fills up with them.
KEEP_RELEASES = 3

# How long a staging file may sit in the release directory before it counts as
# abandoned. An upload that dies halfway -- a dropped VPN link, a service
# restarted mid-transfer -- leaves its `.part` behind, and a process killed
# outright never gets to clean up after itself. Each one is a full-sized
# release, and nothing else in here ever reclaims them: `_prune_old_releases`
# counts releases, and a `.part` file is not one. An hour is far longer than an
# upload takes over the VPN and far shorter than the gap between releases, so no
# upload still in flight is ever mistaken for garbage.
STALE_UPLOAD_SECONDS = 3600

# Chunk size for hashing and copying the upload. Large enough that a 60 MB APK
# is not ten thousand syscalls, small enough not to hold it all in memory.
CHUNK_BYTES = 1024 * 1024

app = FastAPI()


def apk_dir() -> Path:
    return Path(os.environ.get("UPDATE_SERVER_APK_DIR", DEFAULT_APK_DIR))


@app.get("/health", response_class=PlainTextResponse)
def health() -> PlainTextResponse:
    return PlainTextResponse("ok")


@app.get("/update", response_class=PlainTextResponse)
def update() -> PlainTextResponse:
    logger.info("Received update request")

    pull = subprocess.run(["git", "pull"], capture_output=True, text=True)
    if pull.returncode != 0:
        return PlainTextResponse(
            f"Failed to pull latest code\n{pull.stderr}", status_code=500
        )

    up = subprocess.run(
        [
            "docker",
            "compose",
            "-f",
            COMPOSE_FILE,
            "up",
            "-d",
            "--build",
            "--force-recreate",
        ],
        capture_output=True,
        text=True,
    )
    if up.returncode != 0:
        return PlainTextResponse(
            "Failed to restart service\n"
            f"Status: {up.returncode}\n{up.stdout}\n{up.stderr}",
            status_code=500,
        )

    return PlainTextResponse(
        f"Service restarted successfully\n{pull.stdout}\n{up.stdout}"
    )


@app.get("/apk")
def current_release() -> JSONResponse:
    """The release phones are currently offered, or 404 before the first upload.

    Exists for looking in from the minipc without reaching for the Caddy
    container, and to let the release workflow see what it replaced.
    """
    manifest = apk_dir() / MANIFEST_NAME
    if not manifest.is_file():
        raise HTTPException(status_code=404, detail="No release published yet")
    return JSONResponse(json.loads(manifest.read_text()))


@app.post("/apk", response_class=PlainTextResponse)
async def publish_release(
    manifest: Annotated[str, Form()],
    apk: Annotated[UploadFile, File()],
) -> PlainTextResponse:
    """Publishes an Android release: the `.apk` plus the manifest describing it.

    The manifest arrives as a form field rather than being derived here on
    purpose. `versionCode` has to match the number compiled into the package --
    only the build knows it, and a value guessed from the filename would be a
    second source of truth for the one number that decides what is newer.
    """
    described = _validated_manifest(manifest)
    name = described["file"]
    logger.info("Receiving release %s (versionCode %s)", name, described["versionCode"])

    directory = apk_dir()
    directory.mkdir(parents=True, exist_ok=True)

    # Swept before staging this upload rather than after publishing it: once the
    # disk is full every upload fails, and a sweep that only ran on success
    # would never run again -- exactly when it is needed most.
    abandoned = _sweep_stale_uploads(directory)
    if abandoned:
        logger.info("Removed abandoned uploads: %s", ", ".join(abandoned))

    # Written under a temporary name and moved into place, so a download that
    # dies halfway cannot leave a truncated `.apk` at the address phones fetch.
    digest = hashlib.sha256()
    with tempfile.NamedTemporaryFile(
        dir=directory, delete=False, suffix=".part"
    ) as staged:
        staging = Path(staged.name)
        try:
            while chunk := await apk.read(CHUNK_BYTES):
                digest.update(chunk)
                staged.write(chunk)
        except BaseException:
            # A client that disappears mid-upload, or a shutdown signal, must
            # not leave half a release on the disk. The sweep above is the
            # backstop for the cases that never reach this line at all.
            staging.unlink(missing_ok=True)
            raise

    received = digest.hexdigest()
    if received != described["sha256"].lower():
        staging.unlink(missing_ok=True)
        expected = described["sha256"]
        raise HTTPException(
            status_code=400,
            detail=f"Checksum mismatch: manifest says {expected}, file is {received}",
        )

    staging.chmod(0o644)
    staging.replace(directory / name)
    _write_manifest(directory, described)
    removed = _prune_old_releases(directory, keep=name)

    logger.info("Published %s; removed %s", name, ", ".join(removed) or "nothing")
    return PlainTextResponse(
        f"Published {name}\nRemoved: {', '.join(removed) or 'nothing'}\n"
    )


def _validated_manifest(raw: str) -> dict[str, Any]:
    """Parses the manifest form field, refusing anything a phone could not use."""
    try:
        described = json.loads(raw)
    except json.JSONDecodeError as error:
        raise HTTPException(
            status_code=400, detail=f"Manifest is not JSON: {error}"
        ) from error

    if not isinstance(described, dict):
        raise HTTPException(status_code=400, detail="Manifest must be a JSON object")

    missing = {
        "versionCode",
        "versionName",
        "file",
        "size",
        "md5",
        "sha256",
    } - described.keys()
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Manifest is missing: {', '.join(sorted(missing))}"
        )

    if not isinstance(described["versionCode"], int) or described["versionCode"] <= 0:
        raise HTTPException(
            status_code=400, detail="versionCode must be a positive integer"
        )

    # The filename becomes a path under the release directory, so it is matched
    # against the shape the workflow produces rather than merely stripped of
    # separators.
    if not APK_NAME.fullmatch(str(described["file"])):
        raise HTTPException(
            status_code=400,
            detail=f"Unexpected release filename: {described['file']!r}",
        )

    return described


def _write_manifest(directory: Path, described: dict[str, Any]) -> None:
    """Replaces `latest.json` in one step, so no phone reads it half-written."""
    staging = directory / f"{MANIFEST_NAME}.part"
    staging.write_text(json.dumps(described, indent=2, ensure_ascii=False) + "\n")
    staging.chmod(0o644)
    staging.replace(directory / MANIFEST_NAME)


def _sweep_stale_uploads(directory: Path) -> list[str]:
    """Removes staging files left behind by uploads that never finished."""
    cutoff = time.time() - STALE_UPLOAD_SECONDS

    removed = []
    for path in directory.glob("*.part"):
        try:
            if path.stat().st_mtime > cutoff:
                continue
            path.unlink()
        except FileNotFoundError:
            # Another upload finished with it between the glob and here.
            continue
        removed.append(path.name)
    return removed


def _prune_old_releases(directory: Path, keep: str) -> list[str]:
    """Drops all but the newest few releases, always keeping the current one."""
    releases = sorted(
        (path for path in directory.glob("alphapump-*.apk") if path.name != keep),
        key=lambda path: path.stat().st_mtime,
        reverse=True,
    )

    removed = []
    for path in releases[KEEP_RELEASES - 1 :]:
        path.unlink(missing_ok=True)
        removed.append(path.name)
    return removed


if __name__ == "__main__":
    port = int(os.environ.get("UPDATE_SERVER_PORT", DEFAULT_UPDATE_SERVER_PORT))
    uvicorn.run(app, host=UPDATE_SERVER_HOST, port=port)
