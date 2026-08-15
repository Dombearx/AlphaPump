from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

import pytest

from alphapump_triage.feedback import FeedbackReader
from alphapump_triage.models import Feedback


@pytest.fixture
def feedback_dir(tmp_path: Path) -> Path:
    directory = tmp_path / "feedback"
    directory.mkdir()
    return directory


@pytest.fixture
def write_feedback(feedback_dir: Path):
    """Zapisuje plik zgłoszenia w kształcie, w jakim robi to backend."""

    def _write(
        message: str,
        nickname: str = "kasia",
        sent_at: str = "2026-08-14T18:03:12.481Z",
        logs: list[dict] | None = None,
        file_name: str | None = None,
    ) -> str:
        name = file_name or f"{sent_at.replace(':', '-').replace('.', '-')}_{nickname}_abc123.json"
        payload = {
            "nickname": nickname,
            "email": f"{nickname}@example.com",
            "sentAt": sent_at,
            "message": message,
            "logs": logs or [],
        }
        (feedback_dir / name).write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        return name

    return _write


@pytest.fixture
def reader(feedback_dir: Path) -> FeedbackReader:
    return FeedbackReader(feedback_dir)


@pytest.fixture
def sample_feedback() -> Feedback:
    return Feedback(
        file_name="2026-08-14_kasia_abc.json",
        nickname="kasia",
        email="kasia@example.com",
        sent_at=datetime(2026, 8, 14, 18, 3, tzinfo=UTC),
        message="Po zapisaniu serii aplikacja pokazuje zero powtórzeń.",
    )
