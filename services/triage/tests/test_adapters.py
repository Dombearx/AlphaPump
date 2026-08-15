"""Adaptery: rozbieranie odpowiedzi GitHuba i modelu, składanie tekstów dla ludzi."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from alphapump_triage.github import _pull_request_from_event
from alphapump_triage.models import Feedback, IssueRef, Kind, PullRequestRef
from alphapump_triage.openrouter import LlmError, _extract_json
from alphapump_triage.prompts import (
    DISCORD_LIMIT,
    bug_announcement,
    chunk,
    duplicate_note,
    pull_request_note,
    thread_name,
)


def _feedback(message: str) -> Feedback:
    return Feedback(
        file_name="x.json",
        nickname="kasia",
        email="k@example.com",
        sent_at=datetime(2026, 8, 14, 18, 3, tzinfo=UTC),
        message=message,
    )


# ------------------------------------------------------------- OpenRouter ---


def test_wyciaga_json_z_odpowiedzi():
    body = {"choices": [{"message": {"content": '{"kind": "bug"}'}}]}

    assert _extract_json(body) == {"kind": "bug"}


def test_zdejmuje_blok_kodu_dokladany_przez_model():
    """Prompt prosi o goły JSON, ale modele i tak lubią opakować go w ```."""

    body = {"choices": [{"message": {"content": '```json\n{"kind": "bug"}\n```'}}]}

    assert _extract_json(body) == {"kind": "bug"}


@pytest.mark.parametrize(
    "body",
    [
        {"choices": []},
        {"choices": [{"message": {"content": ""}}]},
        {"choices": [{"message": {"content": "[1, 2]"}}]},
    ],
)
def test_odrzuca_odpowiedzi_nie_bedace_obiektem(body):
    with pytest.raises((LlmError, ValueError)):
        _extract_json(body)


# ----------------------------------------------------------------- GitHub ---


def test_rozpoznaje_pr_ke_w_osi_czasu():
    event = {
        "event": "cross-referenced",
        "source": {
            "issue": {
                "number": 42,
                "title": "Naprawa zapisu serii",
                "html_url": "https://github.com/x/y/issues/42",
                "pull_request": {"html_url": "https://github.com/x/y/pull/42"},
            }
        },
    }

    reference = _pull_request_from_event(event)

    assert reference == PullRequestRef(42, "https://github.com/x/y/pull/42", "Naprawa zapisu serii")


def test_odwolanie_z_innego_issue_to_nie_pr_ka():
    """Oś czasu miesza odwołania z issue i z PR-ek — rozróżnia je klucz `pull_request`."""

    event = {
        "event": "cross-referenced",
        "source": {"issue": {"number": 43, "html_url": "https://github.com/x/y/issues/43"}},
    }

    assert _pull_request_from_event(event) is None


@pytest.mark.parametrize("event", [{"event": "labeled"}, {"event": "commented"}, {}])
def test_pozostale_zdarzenia_sa_pomijane(event):
    assert _pull_request_from_event(event) is None


# ------------------------------------------------------- teksty dla ludzi ---


def test_cytat_obejmuje_wszystkie_linie_zgloszenia():
    """Bez `>` w każdej linii druga linia wygląda jak wypowiedź bota, nie użytkownika."""

    text = bug_announcement(IssueRef(7, "https://example/7"), "Tytuł", _feedback("pierwsza\ndruga"))

    assert "> pierwsza\n> druga" in text


def test_dlugie_zgloszenie_jest_przycinane_w_cytacie():
    text = duplicate_note(_feedback("x" * 5000))

    assert len(text) < DISCORD_LIMIT
    assert text.rstrip().endswith("…")


def test_dzieli_dluga_tresc_po_akapitach():
    paragraphs = "\n\n".join(["akapit " * 50] * 20)

    parts = chunk(paragraphs)

    assert len(parts) > 1
    assert all(len(part) <= DISCORD_LIMIT for part in parts)
    # Nic nie ginie po drodze — sklejenie odtwarza treść.
    assert "".join(parts).replace("\n", "").replace(" ", "") == paragraphs.replace(
        "\n", ""
    ).replace(" ", "")


def test_dzieli_nawet_akapit_bez_zadnej_przerwy():
    parts = chunk("x" * 5000)

    assert all(len(part) <= DISCORD_LIMIT for part in parts)
    assert "".join(parts) == "x" * 5000


def test_nazwa_watku_miesci_sie_w_limicie_discorda():
    name = thread_name("bardzo długi tytuł " * 20)

    assert len(name) <= 100


def test_tresc_o_pr_ce_zalezy_od_rodzaju_zgloszenia():
    reference = PullRequestRef(3, "https://example/pull/3", "Zmiana")

    assert "naprawia" in pull_request_note(reference, Kind.BUG)
    assert "realizuje" in pull_request_note(reference, Kind.CHANGE_REQUEST)
