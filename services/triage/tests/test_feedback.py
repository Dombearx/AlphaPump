"""Czytanie katalogu zgłoszeń — kształt pliku ustala backend, nie ta usługa."""

from __future__ import annotations

import pytest

from alphapump_triage.feedback import FeedbackReader, MalformedFeedback, parse_feedback


def test_czyta_zgloszenie_zapisane_przez_backend(reader: FeedbackReader, write_feedback):
    name = write_feedback(
        "Aplikacja gubi ostatnią serię.",
        logs=[{"level": "error", "message": "TypeError: undefined", "at": "18:03:10"}],
    )

    feedback = reader.read(name)

    assert feedback.nickname == "kasia"
    assert feedback.message == "Aplikacja gubi ostatnią serię."
    assert feedback.sent_at.year == 2026
    assert feedback.logs[0].level == "error"


def test_pliki_wracaja_chronologicznie(reader: FeedbackReader, write_feedback):
    """Nazwa zaczyna się znacznikiem czasu, więc sortowanie po nazwie = po dacie."""

    write_feedback("później", sent_at="2026-08-14T20:00:00.000Z")
    write_feedback("wcześniej", sent_at="2026-08-14T06:00:00.000Z")

    names = reader.file_names()

    assert [reader.read(name).message for name in names] == ["wcześniej", "później"]


def test_brak_katalogu_to_nie_awaria(tmp_path):
    assert FeedbackReader(tmp_path / "nie-ma").file_names() == []


def test_ignoruje_pliki_spoza_wzorca(reader: FeedbackReader, write_feedback, feedback_dir):
    write_feedback("prawdziwe")
    (feedback_dir / ".gitkeep").write_text("", encoding="utf-8")
    (feedback_dir / "notatka.txt").write_text("cokolwiek", encoding="utf-8")

    assert len(reader.file_names()) == 1


def test_uszkodzony_json_daje_czytelny_blad(reader: FeedbackReader, feedback_dir):
    (feedback_dir / "zepsute.json").write_text("{nie jest json", encoding="utf-8")

    with pytest.raises(MalformedFeedback):
        reader.read("zepsute.json")


@pytest.mark.parametrize(
    "payload",
    [
        {"sentAt": "2026-08-14T18:03:12.481Z"},
        {"message": "   ", "sentAt": "2026-08-14T18:03:12.481Z"},
        {"message": "coś"},
        {"message": "coś", "sentAt": "wczoraj"},
    ],
)
def test_odrzuca_zgloszenia_bez_wymaganych_pol(payload):
    with pytest.raises(MalformedFeedback):
        parse_feedback("x.json", payload)


def test_znosi_smiecie_w_logach():
    """Log jest dodatkiem — pojedynczy zepsuty wpis nie może przekreślić zgłoszenia."""

    feedback = parse_feedback(
        "x.json",
        {
            "message": "treść",
            "sentAt": "2026-08-14T18:03:12.481Z",
            "logs": ["nie obiekt", {"level": "warn", "message": "ok", "at": "18:00"}],
        },
    )

    assert len(feedback.logs) == 1
    assert feedback.logs[0].message == "ok"
