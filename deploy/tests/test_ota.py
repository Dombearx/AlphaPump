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


PUBLISH_TOKEN = "testowy-token-wydawniczy"

AUTHORIZED = {"Authorization": f"Bearer {PUBLISH_TOKEN}"}


@pytest.fixture(autouse=True)
def publishing_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    """Publishing is token-gated; without this every upload here would 503."""
    monkeypatch.setenv(update_server.PUBLISH_TOKEN_VARIABLE, PUBLISH_TOKEN)


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
            headers=AUTHORIZED,
            data={"runtimeVersion": runtime_version, "platform": platform},
            files={"export": ("export.tar.gz", archive, "application/gzip")},
        )


def pointer(updates: Path, runtime_version: str = RUNTIME, platform: str = "android") -> dict:
    return json.loads((updates / platform / f"{runtime_version}.json").read_text())


BACKDATED = "2020-01-01T00:00:00.000Z"


def _backdate(updates: Path, runtime_version: str = RUNTIME, platform: str = "android") -> None:
    """Moves the current release's `createdAt` back, so tests about it can be exact."""
    target = updates / platform / f"{runtime_version}.json"
    described = json.loads(target.read_text())
    described["createdAt"] = BACKDATED
    target.write_text(json.dumps(described))


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


def test_identical_export_keeps_the_moment_it_was_published(updates: Path):
    """And it must keep its `createdAt`, which is the half phones actually read.

    The client does not compare identifiers to decide whether to offer an
    update -- it compares this timestamp with the one recorded when it
    downloaded the release. A moved `createdAt` under an unchanged identifier is
    a release that is forever newer than the copy already on the phone: offered
    at every launch, already on disk, and unchanged by the restart it asks for.
    """
    archive = build_export(assets={"assets/logo.png": b"udawany png"})

    publish(archive)
    _backdate(updates)

    publish(archive)

    assert pointer(updates)["createdAt"] == BACKDATED


def test_changed_export_gets_a_new_moment(updates: Path):
    """Only the *same* release inherits a timestamp; a different one must not.

    The pointer is backdated by hand so the assertion does not depend on two
    publishes landing in different seconds.
    """
    publish(build_export(bundle=b"var app = 1;"))
    _backdate(updates)

    publish(build_export(bundle=b"var app = 2;"))

    assert pointer(updates)["createdAt"] != BACKDATED


def test_assets_carry_their_file_extension(updates: Path):
    """Without it Android drops the asset from the update and says nothing.

    The client reads `fileExtension` with `getString`, so a missing one throws
    and the asset is skipped; iOS reads it with `requiredValue` and refuses the
    whole manifest. Either way the release reaches phones describing only its
    bundle. The launch asset is the documented exception -- the client stores it
    under its bare key and EAS does not send one either.
    """
    publish(build_export(assets={"assets/logo.png": b"udawany png"}))

    described = pointer(updates)
    assert described["assets"][0]["fileExtension"] == ".png"
    assert "fileExtension" not in described["launchAsset"]


def test_asset_without_an_extension_is_refused(updates: Path):
    """Better a failed release than one that quietly arrives without its files."""
    without_extension = {
        "version": 0,
        "bundler": "metro",
        "fileMetadata": {
            "android": {"bundle": BUNDLE_PATH, "assets": [{"path": "assets/logo.png"}]}
        },
    }
    response = publish(
        build_export(
            assets={"assets/logo.png": b"udawany png"},
            extra_members={"metadata.json": json.dumps(without_extension).encode()},
        )
    )
    assert response.status_code == 400
    assert "file extension" in response.text


def test_changed_bundle_changes_the_identifier(updates: Path):
    publish(build_export(bundle=b"var app = 1;"))
    first = pointer(updates)["id"]
    publish(build_export(bundle=b"var app = 2;"))

    assert pointer(updates)["id"] != first


def test_unreferenced_files_are_reclaimed(updates: Path):
    """Everything older than the release kept back for rollback goes away.

    Three publishes, not two: the one directly before the current release is
    still reachable through its `.prev.json` pointer, because that is what
    `POST /ota/rollback` puts back. Only the one before *that* is garbage.
    """
    publish(build_export(bundle=b"najstarsze", assets={"assets/logo.png": b"udawany png"}))
    stale = hashlib.md5(b"najstarsze").hexdigest()

    publish(build_export(bundle=b"poprzednie", assets={"assets/logo.png": b"udawany png"}))
    publish(build_export(bundle=b"nowe", assets={"assets/logo.png": b"udawany png"}))

    assert not (updates / "assets" / stale).exists()
    assert (updates / "assets" / hashlib.md5(b"poprzednie").hexdigest()).exists()
    # The unchanged image is still there: that is the whole point of naming
    # files after their contents.
    assert (updates / "assets" / hashlib.md5(b"udawany png").hexdigest()).exists()


def test_rollback_puts_the_previous_release_back(updates: Path):
    """The one failure `expo-updates` cannot cover: a release that launches and misbehaves."""
    publish(build_export(bundle=b"dobre"))
    good = pointer(updates)["id"]
    publish(build_export(bundle=b"zepsute"))
    assert pointer(updates)["id"] != good

    with TestClient(update_server.app) as client:
        response = client.post(
            "/ota/rollback",
            headers=AUTHORIZED,
            json={"platform": "android", "runtimeVersion": RUNTIME},
        )

    assert response.status_code == 200, response.text
    assert pointer(updates)["id"] == good
    # Going back is a rename, not a download: the files were never swept.
    assert (updates / "assets" / hashlib.md5(b"dobre").hexdigest()).exists()


def test_rollback_is_itself_reversible(updates: Path):
    """Sometimes the older release is the worse of the two."""
    publish(build_export(bundle=b"pierwsze"))
    publish(build_export(bundle=b"drugie"))
    second = pointer(updates)["id"]

    with TestClient(update_server.app) as client:
        body = {"platform": "android", "runtimeVersion": RUNTIME}
        client.post("/ota/rollback", headers=AUTHORIZED, json=body)
        again = client.post("/ota/rollback", headers=AUTHORIZED, json=body)

    assert again.status_code == 200, again.text
    assert pointer(updates)["id"] == second


def test_rollback_without_a_previous_release_says_so(updates: Path):
    publish(build_export())

    with TestClient(update_server.app) as client:
        response = client.post(
            "/ota/rollback",
            headers=AUTHORIZED,
            json={"platform": "android", "runtimeVersion": RUNTIME},
        )

    assert response.status_code == 404
    assert "only ever been one release" in response.text


def test_rollback_needs_the_token(updates: Path):
    publish(build_export(bundle=b"dobre"))
    publish(build_export(bundle=b"zepsute"))
    current = pointer(updates)["id"]

    with TestClient(update_server.app) as client:
        response = client.post(
            "/ota/rollback", json={"platform": "android", "runtimeVersion": RUNTIME}
        )

    assert response.status_code == 401
    assert pointer(updates)["id"] == current


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


def test_publishing_a_package_needs_the_token(updates: Path):
    """The property the `.apk` signature used to provide for free.

    A package published by anyone but the release workflow simply would not
    install, because Android checks its signature. An over-the-air update has no
    such check -- the app runs whatever this directory offers -- so the token is
    the only thing standing between VPN access and arbitrary code on every phone.
    """
    archive = build_export()

    with TestClient(update_server.app) as client:
        anonymous = client.post(
            "/ota",
            data={"runtimeVersion": RUNTIME, "platform": "android"},
            files={"export": ("export.tar.gz", archive, "application/gzip")},
        )
        wrong = client.post(
            "/ota",
            headers={"Authorization": f"Bearer {PUBLISH_TOKEN}x"},
            data={"runtimeVersion": RUNTIME, "platform": "android"},
            files={"export": ("export.tar.gz", archive, "application/gzip")},
        )

    assert anonymous.status_code == 401
    assert wrong.status_code == 401
    assert list(updates.glob("**/*.json")) == []


def test_reading_stays_open(updates: Path):
    """Phones read manifests without a token; only publishing is gated."""
    publish(build_export())
    with TestClient(update_server.app) as client:
        assert client.get("/ota").status_code == 200
