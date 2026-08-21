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

Also receives releases, in two shapes. `POST /ota` takes an over-the-air
update: the JavaScript bundle and its assets, a couple of megabytes, which the
app applies itself without the system installer. `POST /apk` takes a full
Android package, tens of megabytes, needed only when the native layer changes.
Most releases touch nothing but TypeScript, so most releases are the first kind.

Both are built by GitHub Actions, which already joins the NetBird network to
call `/update` (see `.github/workflows/deploy.yml`) and so can hand the file
straight to this server rather than the minipc having to poll GitHub for it.
Packages land in the directory Caddy serves under `/alphapump/download`;
over-the-air updates land in the one it serves under `/alphapump/ota`, whose
manifests the API reads -- see `deploy/docker-compose.yml`.

Reading is not authenticated, matching the trust model the rest of the
deployment already uses: reachability inside the VPN *is* the authorization
(`docs/stack_technologiczny.md`). **Publishing and redeploying are**, and that
asymmetry is the point.

For `.apk` uploads authorization was never the only line -- Android refuses to
replace an installed package unless the new file carries the same signature, so
a package published here by anyone but the release workflow does not install
over the real app. An over-the-air update has no equivalent: it is JavaScript,
and the app runs whatever this directory offers for its runtime version. Without
a token, anyone who can reach this port inside the VPN could hand every phone in
the group arbitrary code -- something that was simply not possible while releases
were packages. `UPDATE_SERVER_PUBLISH_TOKEN` restores the property that the
signature used to provide for free.

What limits the damage of a *bad* publish, as opposed to a hostile one, is on
the client: `expo-updates` falls back to the bundle built into the `.apk` when a
downloaded one fails to launch, so a broken release costs a restart rather than
the app.

The token lives on this host, so it does not survive the host being taken over.
Closing that too means signing updates where the key is -- in the release
workflow, not here -- which also means building the manifest there. That is a
real change in shape, not a flag, and it is not worth it while the whole stack
is one minipc that already holds the database.
"""

import asyncio
import base64
import hashlib
import json
import logging
import mimetypes
import os
import re
import secrets
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Annotated, Any

import uvicorn
from fastapi import FastAPI, File, Form, Header, HTTPException, UploadFile
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

# Where over-the-air updates land: the host side of the `/srv/alphapump/ota`
# volume Caddy serves the files from, and of the read-only `/data/ota` the API
# reads manifests from (`deploy/docker-compose.yml`). Same split as the `.apk`
# directory above -- this process writes, the containers read.
DEFAULT_OTA_DIR = "deploy/ota"

# Update files are named after the hash of their own contents, so every release
# can share one directory: two builds differing only in JavaScript reuse every
# image and font between them without a line of code to arrange it.
ASSETS_SUBDIR = "assets"

OTA_PLATFORMS = ("android", "ios")

# The native layer's fingerprint, and a path segment. Checked rather than
# stripped, for the same reason the `.apk` filename is: it arrives over the
# network and decides which file gets written.
RUNTIME_VERSION = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")

# What the app runs. Hermes bytecode still travels under the JavaScript type --
# the client keys off this string, not off the file extension.
LAUNCH_CONTENT_TYPE = "application/javascript"

# Shared secret the release workflow proves it holds before it may change
# anything on this host: publishing a release, or redeploying the stack.
# Deliberately *not* optional-if-unset -- an unset token answers a loud 503
# rather than quietly accepting whatever arrives.
#
# Unset therefore stops deployments too, which is the intended trade: the
# alternative was an unauthenticated `git pull` plus `docker compose` running as
# a host user in the `docker` group. Reading (`GET /apk`, `GET /ota`, `/health`)
# stays open, so it is always possible to see what the host is offering.
PUBLISH_TOKEN_VARIABLE = "UPDATE_SERVER_PUBLISH_TOKEN"

# An export is single-digit megabytes. The ceiling is not tuning, it is the
# bound that stops a malformed or hostile archive from filling the disk while
# it decompresses -- the compressed size says nothing about the unpacked one.
MAX_EXPORT_BYTES = 256 * 1024 * 1024

app = FastAPI()

# One redeploy at a time. Two overlapping `docker compose up --build` runs on the
# same stack race each other over the same containers and the same build cache,
# and the loser's failure is indistinguishable from a broken commit.
redeploy_lock = asyncio.Lock()


def apk_dir() -> Path:
    return Path(os.environ.get("UPDATE_SERVER_APK_DIR", DEFAULT_APK_DIR))


def ota_dir() -> Path:
    return Path(os.environ.get("UPDATE_SERVER_OTA_DIR", DEFAULT_OTA_DIR))


def require_publish_token(authorization: str | None) -> None:
    """Refuses the request unless it carries the publishing secret.

    Compared with `compare_digest` rather than `==`: the difference is
    theoretical over a VPN link, but a token check written the obvious way is
    the kind of thing that gets copied into somewhere it matters.
    """
    expected = os.environ.get(PUBLISH_TOKEN_VARIABLE, "")
    if expected == "":
        raise HTTPException(
            status_code=503,
            detail=(
                f"Publishing is disabled: {PUBLISH_TOKEN_VARIABLE} is not set on the "
                "update server. Set it in a systemd drop-in "
                "(sudo systemctl edit alphapump-update-server) and restart the service."
            ),
        )

    presented = authorization[7:] if (authorization or "").startswith("Bearer ") else ""
    if not secrets.compare_digest(presented, expected):
        raise HTTPException(status_code=401, detail="Missing or wrong publishing token")


@app.get("/health", response_class=PlainTextResponse)
def health() -> PlainTextResponse:
    return PlainTextResponse("ok")


@app.get("/update", response_class=PlainTextResponse)
def update_wrong_method() -> PlainTextResponse:
    """Answers the shape this endpoint used to have, and says what replaced it.

    Kept because the old call was a plain `GET` with no credentials: a bare 405
    would look like a broken deployment to whoever is still making it.
    """
    return PlainTextResponse(
        "Redeploying is POST /update with the publishing token:\n"
        '  curl -X POST -H "Authorization: Bearer $UPDATE_SERVER_PUBLISH_TOKEN" .../update\n',
        status_code=405,
    )


@app.post("/update", response_class=PlainTextResponse)
async def update(
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    """Pulls the latest code and rebuilds the stack.

    `POST` with the publishing token, not the bare `GET` this used to be. Both
    halves matter. The token, because this endpoint runs `git pull` and `docker
    compose` as a host user in the `docker` group -- the most powerful thing in
    the deployment, and until now the only one reachable without proving
    anything, while publishing a release next to it needed a secret. The method,
    because a state-changing `GET` fires from any page someone in the VPN opens
    (`<img src="http://minipc:40002/update">`), from a browser prefetch, and from
    anything that crawls a URL it was handed.
    """
    require_publish_token(authorization)

    if redeploy_lock.locked():
        raise HTTPException(status_code=409, detail="A redeploy is already running")

    async with redeploy_lock:
        return await asyncio.to_thread(_redeploy)


def _redeploy() -> PlainTextResponse:
    logger.info("Received update request")

    before = _own_source_digest()

    pull = subprocess.run(["git", "pull"], capture_output=True, text=True)
    if pull.returncode != 0:
        return PlainTextResponse(
            f"Failed to pull latest code\n{pull.stderr}", status_code=500
        )

    # Images are tagged with the commit they were built from, so `docker images`
    # answers "what is actually running" and going back is `IMAGE_TAG=<older sha>
    # docker compose up -d` against an image still on disk -- rather than a
    # checkout plus a fifteen-minute rebuild on the live stack.
    revision = subprocess.run(
        ["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True
    )
    tag = revision.stdout.strip() if revision.returncode == 0 else "local"

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
        env={**os.environ, "IMAGE_TAG": tag},
    )
    if up.returncode != 0:
        return PlainTextResponse(
            "Failed to restart service\n"
            f"Status: {up.returncode}\n{up.stdout}\n{up.stderr}",
            status_code=500,
        )

    restarting = _own_source_digest() != before
    if restarting:
        _restart_after_response()

    return PlainTextResponse(
        f"Service restarted successfully ({tag})\n{pull.stdout}\n{up.stdout}"
        + (
            "\nThis server's own code changed in the pull; restarting into it.\n"
            if restarting
            else ""
        )
    )


def _own_source_digest() -> str:
    """Hash of this file, to notice when a pull replaced the running code."""
    try:
        return hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
    except OSError:
        return ""


def _restart_after_response() -> None:
    """Re-executes this process once the response is on the wire.

    `/update` pulls the repository but runs from memory, so a deploy that adds a
    route here left the server answering 404 on it while `/health` looked fine --
    which reads as a broken release rather than as stale code. The release
    workflow used to work around that by asking `/openapi.json` whether the route
    it was about to call even existed.

    `os.execv` rather than `systemctl restart`: it needs no privileges the
    service does not already have, and systemd keeps supervising the same PID.
    If the new code cannot start, the process exits and `Restart=always` brings
    it back through `ExecStart`.
    """

    def relaunch() -> None:
        time.sleep(1)
        logger.info("Restarting into the code that was just pulled")
        try:
            os.execv(sys.executable, [sys.executable, str(Path(__file__).resolve())])
        except OSError:
            logger.exception("Could not restart; systemd will pick this up if the process dies")

    threading.Thread(target=relaunch, daemon=True).start()


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
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    """Publishes an Android release: the `.apk` plus the manifest describing it.

    The manifest arrives as a form field rather than being derived here on
    purpose. `versionCode` has to match the number compiled into the package --
    only the build knows it, and a value guessed from the filename would be a
    second source of truth for the one number that decides what is newer.
    """
    require_publish_token(authorization)

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


# --------------------------------------------------- over-the-air updates


@app.get("/ota")
def current_updates() -> JSONResponse:
    """What each runtime version is currently offered, or 404 before the first publish.

    The counterpart of `GET /apk`: a way to see from the minipc what phones are
    being handed, without reading the manifest out of the API container.
    """
    published: dict[str, dict[str, Any]] = {}
    for platform in OTA_PLATFORMS:
        directory = ota_dir() / platform
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.json")):
            try:
                described = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                logger.warning("Skipping unreadable update pointer %s", path)
                continue
            published.setdefault(platform, {})[path.stem] = {
                "id": described.get("id"),
                "createdAt": described.get("createdAt"),
                "assetCount": len(described.get("assets", [])),
            }

    if not published:
        raise HTTPException(status_code=404, detail="No over-the-air update published yet")
    return JSONResponse(published)


@app.post("/ota", response_class=PlainTextResponse)
async def publish_update(
    runtime_version: Annotated[str, Form(alias="runtimeVersion")],
    platform: Annotated[str, Form()],
    export: Annotated[UploadFile, File()],
    authorization: Annotated[str | None, Header()] = None,
) -> PlainTextResponse:
    """Publishes an over-the-air update: the output of `expo export`, as a tarball.

    The runtime version arrives as a form field rather than being read out of
    the export, because the export does not carry it: it is a fingerprint of the
    *native* layer, computed by the build from the prebuilt project. Getting it
    wrong hands phones a bundle built against a different native layer, which
    crashes on launch -- so it is checked here and checked again by the API,
    which refuses a pointer that does not describe its own location.
    """
    require_publish_token(authorization)

    if platform not in OTA_PLATFORMS:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown platform {platform!r}; expected one of {', '.join(OTA_PLATFORMS)}",
        )
    if not RUNTIME_VERSION.fullmatch(runtime_version):
        raise HTTPException(
            status_code=400, detail=f"Unexpected runtime version: {runtime_version!r}"
        )

    directory = ota_dir()
    directory.mkdir(parents=True, exist_ok=True)

    logger.info("Receiving over-the-air update for %s/%s", platform, runtime_version)

    # The whole staging area is one temporary directory, removed on the way out
    # whatever happens: an upload that dies halfway leaves nothing behind, so
    # this endpoint needs no equivalent of `_sweep_stale_uploads`.
    with tempfile.TemporaryDirectory(dir=directory, prefix=".staging-") as staging:
        archive = Path(staging) / "export.tar.gz"
        await _receive_upload(export, archive)

        unpacked = Path(staging) / "export"
        unpacked.mkdir()
        _extract_export(archive, unpacked)

        launch, assets = _describe_export(unpacked, platform)
        update = _assemble_update(runtime_version, platform, launch, assets)

        stored = _store_assets(directory, [launch, *assets])
        _write_pointer(directory, platform, runtime_version, update)

    removed = _sweep_unreferenced_assets(directory)

    logger.info(
        "Published %s for %s/%s; %d new file(s), removed %d",
        update["id"],
        platform,
        runtime_version,
        stored,
        len(removed),
    )
    return PlainTextResponse(
        f"Published {update['id']} for {platform}/{runtime_version}\n"
        f"Files: {len(assets) + 1} ({stored} new)\n"
        f"Removed: {', '.join(removed) or 'nothing'}\n"
    )


async def _receive_upload(upload: UploadFile, target: Path) -> None:
    """Streams the upload to disk, refusing anything past the size ceiling.

    Read in chunks rather than with `.read()`: an export is a few megabytes
    today, but the ceiling exists precisely for the case where the thing on the
    wire is not what we expect.
    """
    written = 0
    with target.open("wb") as sink:
        while chunk := await upload.read(CHUNK_BYTES):
            written += len(chunk)
            if written > MAX_EXPORT_BYTES:
                raise HTTPException(
                    status_code=413,
                    detail=f"Export is larger than {MAX_EXPORT_BYTES} bytes",
                )
            sink.write(chunk)


def _safe_member_name(name: str) -> str:
    """The archive member's path, refused unless it stays inside the directory.

    `tarfile.extractall` is not used at all, here or anywhere below: it happily
    writes through absolute paths, `..` segments and symlinks pointing out of
    the tree. Everything this server unpacks arrives over the network, so
    members are read one at a time and written by hand.
    """
    cleaned = name[2:] if name.startswith("./") else name
    parts = PurePosixPath(cleaned).parts

    if not parts or cleaned.startswith("/") or ".." in parts:
        raise HTTPException(status_code=400, detail=f"Unsafe path in export: {name!r}")
    return str(PurePosixPath(*parts))


def _extract_export(archive: Path, into: Path) -> None:
    """Unpacks the export, bounded by size and by where files may land."""
    total = 0
    try:
        with tarfile.open(archive, "r:*") as tar:
            for member in tar:
                if member.isdir():
                    continue
                if not member.isreg():
                    # Symlinks, devices and hard links have no business in an
                    # `expo export`, and are the shapes that turn unpacking into
                    # a way to write outside the directory.
                    raise HTTPException(
                        status_code=400,
                        detail=f"Export contains a non-regular file: {member.name!r}",
                    )

                total += member.size
                if total > MAX_EXPORT_BYTES:
                    # Checked against the *unpacked* sizes: the compressed
                    # upload says nothing about how much disk it becomes.
                    raise HTTPException(
                        status_code=413,
                        detail=f"Export unpacks to more than {MAX_EXPORT_BYTES} bytes",
                    )

                source = tar.extractfile(member)
                if source is None:
                    continue

                target = into / _safe_member_name(member.name)
                target.parent.mkdir(parents=True, exist_ok=True)
                with target.open("wb") as sink:
                    shutil.copyfileobj(source, sink, CHUNK_BYTES)
    except tarfile.TarError as error:
        raise HTTPException(status_code=400, detail=f"Export is not a readable tar: {error}") from error


def _describe_export(root: Path, platform: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Reads `metadata.json` and turns every file it names into an asset entry.

    `expo export` writes this file next to the bundle; it is the only thing that
    knows which of the exported files is the one the app launches.
    """
    metadata_path = root / "metadata.json"
    if not metadata_path.is_file():
        raise HTTPException(
            status_code=400, detail="Export has no metadata.json -- is it the output of `expo export`?"
        )

    try:
        metadata = json.loads(metadata_path.read_text())
    except json.JSONDecodeError as error:
        raise HTTPException(status_code=400, detail=f"metadata.json is not JSON: {error}") from error

    described = (metadata.get("fileMetadata") or {}).get(platform)
    if not isinstance(described, dict):
        raise HTTPException(
            status_code=400,
            detail=f"Export carries nothing for {platform} -- was it exported for another platform?",
        )

    bundle = described.get("bundle")
    if not isinstance(bundle, str):
        raise HTTPException(status_code=400, detail=f"No bundle listed for {platform}")

    launch = _asset_entry(root, bundle, LAUNCH_CONTENT_TYPE)

    assets = []
    for asset in described.get("assets") or []:
        path = asset.get("path")
        if not isinstance(path, str):
            raise HTTPException(status_code=400, detail=f"Malformed asset entry: {asset!r}")
        # `mime.getType` on the client side keys off the extension too, so an
        # unknown one becomes the catch-all rather than an error: a font the
        # mimetypes table has not heard of should still reach the phone.
        guessed = mimetypes.guess_type(f"asset.{asset.get('ext', '')}")[0]
        assets.append(_asset_entry(root, path, guessed or "application/octet-stream"))

    return launch, assets


def _asset_entry(root: Path, relative: str, content_type: str) -> dict[str, Any]:
    """One exported file, described the way the update protocol wants it.

    Two hashes, because they answer two questions. `key` (MD5) is the file's
    name on the phone and in the shared directory here; `hash` (SHA-256,
    base64url) is what the client checks after downloading. Both are computed
    once, at publish time, rather than on every phone's check.
    """
    source = root / _safe_member_name(relative)
    if not source.is_file():
        raise HTTPException(
            status_code=400, detail=f"metadata.json names a file the export does not contain: {relative!r}"
        )

    data = source.read_bytes()
    key = hashlib.md5(data).hexdigest()
    digest = hashlib.sha256(data).digest()

    return {
        "key": key,
        "contentType": content_type,
        "hash": base64.urlsafe_b64encode(digest).decode().rstrip("="),
        "path": f"{ASSETS_SUBDIR}/{key}",
        # Not part of the stored description -- stripped before writing.
        "_source": str(source),
    }


def _assemble_update(
    runtime_version: str,
    platform: str,
    launch: dict[str, Any],
    assets: list[dict[str, Any]],
) -> dict[str, Any]:
    """The description the API reads and turns into a manifest.

    The identifier is derived from the contents rather than drawn at random, so
    republishing an unchanged export does not look to phones like a new release
    they have to download.
    """
    def public(entry: dict[str, Any]) -> dict[str, Any]:
        return {key: value for key, value in entry.items() if not key.startswith("_")}

    body = {
        "runtimeVersion": runtime_version,
        "platform": platform,
        "launchAsset": public(launch),
        "assets": [public(asset) for asset in assets],
    }
    digest = hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    return {
        "id": f"{digest[0:8]}-{digest[8:12]}-{digest[12:16]}-{digest[16:20]}-{digest[20:32]}",
        "createdAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z"),
        **body,
        "metadata": {},
        "extra": {},
    }


def _store_assets(directory: Path, entries: list[dict[str, Any]]) -> int:
    """Moves the exported files into the shared, content-addressed directory.

    A file already there is left alone rather than rewritten: its name is the
    hash of its contents, so identical name means identical file. This is what
    makes a JavaScript-only release cost a couple of megabytes -- every image
    and font is already on the phone and already here.
    """
    assets = directory / ASSETS_SUBDIR
    assets.mkdir(parents=True, exist_ok=True)

    added = 0
    for entry in entries:
        target = assets / entry["key"]
        if target.exists():
            continue

        # Written under a temporary name and moved into place: a phone reading
        # the directory must never find a file that is only half there.
        staging = target.with_suffix(".part")
        shutil.copyfile(entry["_source"], staging)
        staging.chmod(0o644)
        staging.replace(target)
        added += 1

    return added


def _write_pointer(
    directory: Path, platform: str, runtime_version: str, update: dict[str, Any]
) -> None:
    """Replaces the description in one step, *after* the files it points at.

    Order matters the same way it does for `latest.json`: no phone may read a
    description of an update whose files are not all on disk yet.
    """
    target_dir = directory / platform
    target_dir.mkdir(parents=True, exist_ok=True)

    target = target_dir / f"{runtime_version}.json"
    staging = target.with_suffix(".json.part")
    staging.write_text(json.dumps(update, indent=2, ensure_ascii=False) + "\n")
    staging.chmod(0o644)
    staging.replace(target)


def _sweep_unreferenced_assets(directory: Path) -> list[str]:
    """Drops files no published update mentions any more.

    Mark and sweep rather than "delete what the previous release used": the
    shared directory is reached from several runtime versions at once, and a
    file the outgoing Android update dropped may still be the one iOS launches.

    Runs *after* the new pointer is in place, so a file this release introduced
    is always reachable by the time anything looks for garbage.
    """
    assets = directory / ASSETS_SUBDIR
    if not assets.is_dir():
        return []

    referenced: set[str] = set()
    for platform in OTA_PLATFORMS:
        for path in (directory / platform).glob("*.json"):
            try:
                described = json.loads(path.read_text())
            except (OSError, json.JSONDecodeError):
                # An unreadable pointer means we cannot know what it needs. The
                # safe reading is "everything", so nothing is swept this time --
                # a full disk is recoverable, a deleted asset is not.
                logger.warning("Unreadable update pointer %s -- skipping the sweep", path)
                return []
            for entry in [described.get("launchAsset"), *(described.get("assets") or [])]:
                if isinstance(entry, dict) and isinstance(entry.get("key"), str):
                    referenced.add(entry["key"])

    removed = []
    for path in assets.iterdir():
        if not path.is_file() or path.name in referenced:
            continue
        path.unlink(missing_ok=True)
        removed.append(path.name)
    return sorted(removed)


if __name__ == "__main__":
    port = int(os.environ.get("UPDATE_SERVER_PORT", DEFAULT_UPDATE_SERVER_PORT))
    uvicorn.run(app, host=UPDATE_SERVER_HOST, port=port)
