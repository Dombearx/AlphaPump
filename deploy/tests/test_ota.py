"""Publishing over-the-air updates: what lands on disk, and what gets reclaimed.

This is the directory the app reads its JavaScript from, so the tests are
weighted towards the ways it can go wrong rather than the way it goes right:
an archive that tries to write outside it, a runtime version that is really a
path, an export built for the wrong platform. Getting any of those wrong is not
a failed release -- it is a phone that launches into a bundle built against a
different native layer, which is exactly the failure nothing remote can fix.

English, unlike the rest of the repository, to match `update_server.py`.
"""

from __future__ import annotations

import hashlib
import io
import json
import sys
import tarfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import update_server  # noqa: E402

RUNTIME = "a1b2c3d4e5f6"
BUNDLE_PATH = "_expo/static/js/android/entry-6f1c.hbc"


@pytest.fixture
def updates(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    directory = tmp_path / "ota"
    directory.mkdir()
    monkeypatch.setenv("UPDATE_SERVER_OTA_DIR", str(directory))
    return directory


def build_export(
    *,
    bundle: bytes = b"var app = 1;",
    assets: dict[str, bytes] | None = None,
    platform: str = "android",
    extra_members: dict[str, bytes] | None = None,
) -> bytes:
    """A tarball shaped like the output of `expo export`."""
    assets = {} if assets is None else assets

    metadata = {
        "version": 0,
        "bundler": "metro",
        "fileMetadata": {
            platform: {
                "bundle": BUNDLE_PATH,
                "assets": [
                    {"path": path, "ext": path.rsplit(".", 1)[-1] if "." in path else "png"}
                    for path in assets
                ],
            }
        },
    }

    members: dict[str, bytes] = {
        "metadata.json": json.dumps(metadata).encode(),
        BUNDLE_PATH: bundle,
        **assets,
        **(extra_members or {}),
    }

    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        for name, content in members.items():
            info = tarfile.TarInfo(f"./{name}")
            info.size = len(content)
            tar.addfile(info, io.BytesIO(content))
    return buffer.getvalue()


def publish(archive: bytes, runtime_version: str = RUNTIME, platform: str = "android"):
    with TestClient(update_server.app) as client:
        return client.post(
            "/ota",
            data={"runtimeVersion": runtime_version, "platform": platform},
            files={"export": ("export.tar.gz", archive, "application/gzip")},
        )


def pointer(updates: Path, runtime_version: str = RUNTIME, platform: str = "android") -> dict:
    return json.loads((updates / platform / f"{runtime_version}.json").read_text())


def test_publishing_writes_pointer_and_assets(updates: Path):
    bundle = b"var app = 'wydanie';"
    response = publish(build_export(bundle=bundle, assets={"assets/logo.png": b"udawany png"}))
    assert response.status_code == 200, response.text

    described = pointer(updates)
    assert described["platform"] == "android"
    assert described["runtimeVersion"] == RUNTIME
    assert described["launchAsset"]["contentType"] == "application/javascript"
    assert len(described["assets"]) == 1
    assert described["assets"][0]["contentType"] == "image/png"

    # The file's name is the MD5 of its contents, and its `hash` the base64url
    # SHA-256 -- the two things the client uses to store and to verify it.
    key = hashlib.md5(bundle).hexdigest()
    assert described["launchAsset"]["key"] == key
    assert described["launchAsset"]["path"] == f"assets/{key}"
    assert (updates / "assets" / key).read_bytes() == bundle


def test_pointer_describes_its_own_location(updates: Path):
    """The API refuses a pointer that does not, so publishing must never write one."""
    publish(build_export())
    described = pointer(updates)
    assert described["platform"] == "android"
    assert described["runtimeVersion"] == RUNTIME


def test_identical_export_keeps_its_identifier(updates: Path):
    """Republishing an unchanged build must not look to phones like a new release."""
    archive = build_export(assets={"assets/logo.png": b"udawany png"})

    publish(archive)
    first = pointer(updates)["id"]
    publish(archive)
    second = pointer(updates)["id"]

    assert first == second


def test_changed_bundle_changes_the_identifier(updates: Path):
    publish(build_export(bundle=b"var app = 1;"))
    first = pointer(updates)["id"]
    publish(build_export(bundle=b"var app = 2;"))

    assert pointer(updates)["id"] != first


def test_unreferenced_files_are_reclaimed(updates: Path):
    publish(build_export(bundle=b"stare", assets={"assets/logo.png": b"udawany png"}))
    stale = hashlib.md5(b"stare").hexdigest()

    publish(build_export(bundle=b"nowe", assets={"assets/logo.png": b"udawany png"}))

    assert not (updates / "assets" / stale).exists()
    # The unchanged image is still there: that is the whole point of naming
    # files after their contents.
    assert (updates / "assets" / hashlib.md5(b"udawany png").hexdigest()).exists()


def test_file_shared_with_another_runtime_version_survives(updates: Path):
    """The sweep looks at every published pointer, not just the one it replaced."""
    shared = b"udawany png"
    publish(build_export(bundle=b"dla starej", assets={"assets/logo.png": shared}), "stara-warstwa")
    publish(build_export(bundle=b"dla nowej", assets={"assets/logo.png": shared}), "nowa-warstwa")

    # Replacing one runtime version's bundle must not take the image the other
    # one still launches with.
    publish(build_export(bundle=b"dla nowej, poprawione", assets={"assets/logo.png": shared}), "nowa-warstwa")

    assert (updates / "assets" / hashlib.md5(shared).hexdigest()).exists()
    assert (updates / "assets" / hashlib.md5(b"dla starej").hexdigest()).exists()


def test_unreadable_pointer_stops_the_sweep(updates: Path):
    """A full disk is recoverable; a deleted asset that something still needs is not."""
    publish(build_export(bundle=b"pierwsze"))
    (updates / "android" / "uszkodzona.json").write_text("to nie jest JSON")

    publish(build_export(bundle=b"drugie"))

    assert (updates / "assets" / hashlib.md5(b"pierwsze").hexdigest()).exists()


def test_archive_cannot_write_outside_the_directory(updates: Path, tmp_path: Path):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        content = b"podlozone"
        info = tarfile.TarInfo("../../wykradzione.txt")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))

    response = publish(buffer.getvalue())

    assert response.status_code == 400
    assert not (tmp_path / "wykradzione.txt").exists()
    assert not (updates.parent / "wykradzione.txt").exists()


def test_symlinks_are_refused(updates: Path):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        info = tarfile.TarInfo("./metadata.json")
        info.type = tarfile.SYMTYPE
        info.linkname = "/etc/passwd"
        tar.addfile(info)

    assert publish(buffer.getvalue()).status_code == 400


def test_runtime_version_cannot_be_a_path(updates: Path):
    for runtime_version in ["../../etc", "a/b", "", ".."]:
        response = publish(build_export(), runtime_version)
        assert response.status_code in (400, 422), runtime_version
    assert list(updates.glob("**/*.json")) == []


def test_unknown_platform_is_refused(updates: Path):
    assert publish(build_export(), RUNTIME, "windows").status_code == 400


def test_export_for_another_platform_is_refused(updates: Path):
    """An export built for iOS published as Android would crash every phone."""
    response = publish(build_export(platform="ios"), RUNTIME, "android")
    assert response.status_code == 400
    assert "another platform" in response.text


def test_export_without_metadata_is_refused(updates: Path):
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        content = b"nie ten plik"
        info = tarfile.TarInfo("./cokolwiek.txt")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))

    assert publish(buffer.getvalue()).status_code == 400


def test_metadata_naming_a_missing_file_is_refused(updates: Path):
    metadata = {
        "fileMetadata": {"android": {"bundle": "_expo/nie-ma-mnie.hbc", "assets": []}}
    }
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w:gz") as tar:
        content = json.dumps(metadata).encode()
        info = tarfile.TarInfo("./metadata.json")
        info.size = len(content)
        tar.addfile(info, io.BytesIO(content))

    response = publish(buffer.getvalue())
    assert response.status_code == 400
    assert list(updates.glob("**/*.json")) == []


def test_nothing_is_left_behind_when_publishing_fails(updates: Path):
    publish(build_export(platform="ios"), RUNTIME, "android")
    assert [path.name for path in updates.iterdir() if path.name.startswith(".staging")] == []


def test_listing_reports_what_phones_are_offered(updates: Path):
    with TestClient(update_server.app) as client:
        assert client.get("/ota").status_code == 404

    publish(build_export(assets={"assets/logo.png": b"udawany png"}))

    with TestClient(update_server.app) as client:
        body = client.get("/ota").json()

    assert body["android"][RUNTIME]["id"] == pointer(updates)["id"]
    assert body["android"][RUNTIME]["assetCount"] == 1
