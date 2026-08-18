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
