"""Stan decyduje, czy zgłoszenie wróci jutro — najdroższe pomyłki siedzą tutaj."""

from __future__ import annotations

import pytest

from alphapump_triage.models import Discussion, Kind
from alphapump_triage.state import State


@pytest.fixture
def state() -> State:
    return State(":memory:")


def test_przetworzone_zgloszenie_nie_wraca(state: State):
    state.mark_processed("a.json", Kind.BUG, 12, "w1")

    assert state.pending(["a.json", "b.json"], max_attempts=3) == ["b.json"]


def test_nieudane_zgloszenie_wraca_do_wyczerpania_prob(state: State):
    state.mark_failed("a.json", "OpenRouter nie odpowiedział")
    assert state.pending(["a.json"], max_attempts=3) == ["a.json"]

    state.mark_failed("a.json", "znowu")
    assert state.pending(["a.json"], max_attempts=3) == ["a.json"]

    assert state.mark_failed("a.json", "i jeszcze raz") == 3
    # Trzecia porażka odkłada zgłoszenie na bok: dalsze próby kosztowałyby
    # zapytania do modelu i nie zmieniłyby wyniku.
    assert state.pending(["a.json"], max_attempts=3) == []


def test_udane_podejscie_kasuje_licznik_porazek(state: State):
    state.mark_failed("a.json", "chwilowa awaria sieci")
    state.mark_processed("a.json", Kind.BUG, 5, "w1")

    assert state.pending(["a.json"], max_attempts=3) == []


def test_kolejnosc_wejsciowa_jest_zachowana(state: State):
    assert state.pending(["b.json", "a.json"], max_attempts=3) == ["b.json", "a.json"]


def test_sledzone_issue_czeka_na_pr_dopoki_go_nie_ma(state: State):
    state.track_issue(7, Kind.BUG, "https://example/7", "Błąd", "msg-1", "w1")

    assert [issue.number for issue in state.issues_awaiting_pr()] == [7]

    state.mark_pull_request(7, 21, "https://example/pull/21")

    assert state.issues_awaiting_pr() == []


def test_issue_bez_watku_nie_jest_odpytywane(state: State):
    """Nie ma dokąd wysłać linku, więc odpytywanie GitHuba byłoby czystym kosztem."""

    state.track_issue(8, Kind.BUG, "https://example/8", "Błąd", None, None)

    assert state.issues_awaiting_pr() == []


def test_ponowne_sledzenie_nie_kasuje_watku(state: State):
    state.track_issue(9, Kind.BUG, "https://example/9", "Błąd", "msg-1", "w1")
    state.track_issue(9, Kind.BUG, "https://example/9", "Nowy tytuł", None, None)

    issue = state.issue(9)
    assert issue is not None
    assert issue.thread_id == "w1"
    assert issue.title == "Nowy tytuł"


def test_dyskusja_znika_z_otwartych_po_zalozeniu_issue(state: State):
    state.record_discussion(
        Discussion(
            thread_id="w1",
            message_id="m1",
            title="Odliczanie przerw",
            source_text="Przydałby się timer",
            reporter="kasia",
        )
    )
    assert [d.thread_id for d in state.open_discussions()] == ["w1"]

    state.link_discussion_issue("w1", 42)

    assert state.open_discussions() == []
    discussion = state.discussion("w1")
    assert discussion is not None and discussion.issue_number == 42
