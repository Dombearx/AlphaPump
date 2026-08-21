"""What the minipc keeps and what it throws away.

The release directory is the one place in this deployment that grows without
bound if nobody prunes it: every release is tens of megabytes and phones only
ever want the newest. These tests cover both ways a file can end up stranded
there -- a superseded release and an upload that never finished.

English, unlike the rest of the repository, to match `update_server.py`.
"""

from __future__ import annotations

import hashlib
import json
import os
import sys
import time
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import update_server  # noqa: E402


PUBLISH_TOKEN = "testowy-token-wydawniczy"


@pytest.fixture(autouse=True)
def publishing_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Publishing is token-gated; without this every upload here would 503."""
    monkeypatch.setenv(update_server.PUBLISH_TOKEN_VARIABLE, PUBLISH_TOKEN)


AUTHORIZED = {"Authorization": f"Bearer {PUBLISH_TOKEN}"}


@pytest.fixture
def releases(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "apk"
    directory.mkdir()
    monkeypatch.setenv("UPDATE_SERVER_APK_DIR", str(directory))
    return directory


def write_release(directory: Path, version: int, age_seconds: float = 0) -> Path:
    path = directory / f"alphapump-{version}.apk"
    path.write_bytes(b"udawany pakiet")
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))
    return path


def write_staging(directory: Path, name: str, age_seconds: float) -> Path:
    path = directory / name
    path.write_bytes(b"polowa pakietu")
    stamp = time.time() - age_seconds
    os.utime(path, (stamp, stamp))
    return path


def test_prune_keeps_three_releases_including_the_new_one(releases: Path):
    for version, age in [(50, 400), (51, 300), (52, 200), (53, 100)]:
        write_release(releases, version, age)
    write_release(releases, 54)

    removed = update_server._prune_old_releases(releases, keep="alphapump-54.apk")

    assert sorted(removed) == ["alphapump-50.apk", "alphapump-51.apk"]
    assert sorted(path.name for path in releases.glob("*.apk")) == [
        "alphapump-52.apk",
        "alphapump-53.apk",
        "alphapump-54.apk",
    ]


def test_abandoned_upload_is_swept(releases: Path):
    """An upload cut halfway leaves a full-sized file nothing else reclaims."""
    write_staging(releases, "tmpabc.part", age_seconds=update_server.STALE_UPLOAD_SECONDS + 60)
    write_staging(releases, "latest.json.part", age_seconds=update_server.STALE_UPLOAD_SECONDS + 60)

    removed = update_server._sweep_stale_uploads(releases)

    assert sorted(removed) == ["latest.json.part", "tmpabc.part"]
    assert list(releases.glob("*.part")) == []


def test_upload_still_in_flight_is_left_alone(releases: Path):
    write_staging(releases, "tmpxyz.part", age_seconds=5)

    assert update_server._sweep_stale_uploads(releases) == []
    assert (releases / "tmpxyz.part").exists()


def test_publishing_sweeps_and_prunes(releases: Path):
    """The whole point, end to end: uploading a release cleans up after the old ones."""
    for version, age in [(60, 400), (61, 300), (62, 200)]:
        write_release(releases, version, age)
    write_staging(releases, "tmpstare.part", age_seconds=update_server.STALE_UPLOAD_SECONDS + 60)

    content = b"nowy pakiet"
    manifest = {
        "versionCode": 63,
        "versionName": "0.1.0",
        "file": "alphapump-63.apk",
        "size": len(content),
        "md5": hashlib.md5(content).hexdigest(),
        "sha256": hashlib.sha256(content).hexdigest(),
    }

    with TestClient(update_server.app) as client:
        response = client.post(
            "/apk",
            headers=AUTHORIZED,
            data={"manifest": json.dumps(manifest)},
            files={"apk": ("alphapump-63.apk", content, "application/vnd.android.package-archive")},
        )

    assert response.status_code == 200, response.text
    assert sorted(path.name for path in releases.glob("*.apk")) == [
        "alphapump-61.apk",
        "alphapump-62.apk",
        "alphapump-63.apk",
    ]
    assert list(releases.glob("*.part")) == []
    assert json.loads((releases / "latest.json").read_text())["versionCode"] == 63


def test_publishing_a_package_needs_the_token(releases: Path):
    content = b"podlozony pakiet"
    manifest = {
        "versionCode": 99,
        "versionName": "9.9.9",
        "file": "alphapump-99.apk",
        "size": len(content),
        "md5": hashlib.md5(content).hexdigest(),
        "sha256": hashlib.sha256(content).hexdigest(),
    }
    files = {"apk": ("alphapump-99.apk", content, "application/vnd.android.package-archive")}

    with TestClient(update_server.app) as client:
        anonymous = client.post("/apk", data={"manifest": json.dumps(manifest)}, files=files)
        wrong = client.post(
            "/apk",
            headers={"Authorization": "Bearer nie-ten-token"},
            data={"manifest": json.dumps(manifest)},
            files=files,
        )

    assert anonymous.status_code == 401
    assert wrong.status_code == 401
    assert list(releases.glob("*.apk")) == []


def test_publishing_is_refused_loudly_when_no_token_is_configured(
    releases: Path, monkeypatch: pytest.MonkeyPatch
):
    """Unset means disabled, not open -- and says so, rather than 401-ing forever."""
    monkeypatch.delenv(update_server.PUBLISH_TOKEN_VARIABLE)

    with TestClient(update_server.app) as client:
        response = client.post(
            "/apk",
            headers=AUTHORIZED,
            data={"manifest": "{}"},
            files={"apk": ("alphapump-1.apk", b"x", "application/octet-stream")},
        )

    assert response.status_code == 503
    assert update_server.PUBLISH_TOKEN_VARIABLE in response.text


def test_reading_the_current_release_stays_open(releases: Path):
    """Phones read this without a token; only publishing is gated."""
    with TestClient(update_server.app) as client:
        assert client.get("/health").status_code == 200
        assert client.get("/apk").status_code == 404


def test_redeploying_needs_the_token(monkeypatch: pytest.MonkeyPatch):
    """`/update` runs git and docker as a host user; it may not be anonymous.

    The call is also POST now. A state-changing GET fires from any page someone
    in the VPN opens, from a browser prefetch, and from anything that follows a
    URL it was handed -- so the old shape answers 405 with instructions instead
    of quietly still working.
    """
    ran: list[list[str]] = []
    monkeypatch.setattr(
        update_server.subprocess,
        "run",
        lambda command, **_: ran.append(command) or _CompletedFake(),
    )

    with TestClient(update_server.app) as client:
        anonymous = client.post("/update")
        wrong = client.post("/update", headers={"Authorization": "Bearer nie-ten-token"})
        old_shape = client.get("/update")

    assert anonymous.status_code == 401
    assert wrong.status_code == 401
    assert old_shape.status_code == 405
    assert "POST /update" in old_shape.text
    assert ran == [], "nothing may run before the token checks out"


def test_redeploying_tags_images_with_the_commit(monkeypatch: pytest.MonkeyPatch):
    """Going back to a previous version has to be possible without a rebuild."""
    seen: list[tuple[list[str], str | None]] = []

    def fake_run(command, **kwargs):
        seen.append((command, (kwargs.get("env") or {}).get("IMAGE_TAG")))
        if command[:2] == ["git", "rev-parse"]:
            return _CompletedFake(stdout="abc1234\n")
        return _CompletedFake()

    monkeypatch.setattr(update_server.subprocess, "run", fake_run)

    with TestClient(update_server.app) as client:
        response = client.post("/update", headers=AUTHORIZED)

    assert response.status_code == 200, response.text
    compose = [tag for command, tag in seen if command[:2] == ["docker", "compose"]]
    assert compose == ["abc1234"]


class _CompletedFake:
    """Stands in for `subprocess.CompletedProcess` without running anything."""

    def __init__(self, returncode: int = 0, stdout: str = "", stderr: str = ""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr
