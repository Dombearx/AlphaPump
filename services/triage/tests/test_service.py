"""Przebiegi usługi: co powstaje na GitHubie, a co na Discordzie i dlaczego."""

from __future__ import annotations

import sqlite3

import pytest

from alphapump_triage.feedback import FeedbackReader
from alphapump_triage.models import Discussion, ExistingIssue, IssueComment, Kind, PullRequestRef
from alphapump_triage.service import TriageService
from alphapump_triage.state import State
from fakes import FakeChat, FakeLlm, FakeTracker, chat_message, make_config

BUG = {"kind": "bug", "title": "Zapisana seria pokazuje zero powtórzeń", "summary": "s"}
CHANGE = {"kind": "change_request", "title": "Timer przerw", "summary": "s"}
NO_DUPLICATE = {"duplicate_of": None, "reason": "inna sprawa"}


def build(
    reader: FeedbackReader,
    llm_responses: list,
    tracker: FakeTracker | None = None,
    chat: FakeChat | None = None,
    state: State | None = None,
    **config_overrides,
):
    tracker = tracker or FakeTracker()
    chat = chat or FakeChat()
    state = state or State(":memory:")
    service = TriageService(
        config=make_config(**config_overrides),
        state=state,
        reader=reader,
        llm=FakeLlm(llm_responses),
        tracker=tracker,
        chat=chat,
    )
    return service, tracker, chat, state


# ------------------------------------------------------------------ błędy ---


async def test_blad_trafia_na_githuba_i_dostaje_watek(reader, write_feedback):
    write_feedback("Po zapisaniu serii widzę zero powtórzeń.")
    service, tracker, chat, state = build(
        reader,
        [BUG, {"title": "Seria zapisuje się z zerem powtórzeń", "body": "## Objaw\n…"}],
    )

    report = await service.run_pass()

    assert report.bugs == 1
    title, body, labels = tracker.created[0]
    assert title == "Seria zapisuje się z zerem powtórzeń"
    assert labels == ["ai-triage", "bug"]
    # Stopka jest śladem po źródle — bez niej issue nie da się powiązać z plikiem.
    assert "Zgłoszenie od **kasia**" in body

    # Wiadomość na kanale i wątek pod nią — wątek musi istnieć, zanim powstanie
    # PR-ka, bo to do niego trafi link.
    assert len(chat.posts) == 1
    assert "#101" in chat.posts[0]
    assert len(chat.threads) == 1
    assert state.issues_awaiting_pr()[0].number == 101


async def test_duplikat_bledu_dopisuje_komentarz_zamiast_nowego_issue(reader, write_feedback):
    write_feedback("Zapisana seria pokazuje zero powtórzeń, u mnie też.")
    tracker = FakeTracker(
        open_issues=[
            ExistingIssue(11, "Seria z zerem powtórzeń", "opis", "https://example/11"),
        ]
    )
    state = State(":memory:")
    state.track_issue(11, Kind.BUG, "https://example/11", "Seria z zerem powtórzeń", "m", "w1")
    service, tracker, chat, state = build(
        reader,
        [BUG, {"duplicate_of": 11, "reason": "ten sam objaw"}],
        tracker=tracker,
        state=state,
    )

    report = await service.run_pass()

    assert report.duplicates == 1
    assert tracker.created == []
    assert tracker.comments[0][0] == 11
    # Wątek istniejącego issue dostaje informację, żeby rozmowa nadążała za GitHubem.
    assert chat.thread_posts[0][0] == "w1"


async def test_odmowa_discorda_nie_gubi_zalozonego_issue(reader, write_feedback):
    """GitHub już ma issue — jutrzejszy przebieg ma je zobaczyć, a nie założyć drugie."""

    write_feedback("Zapisana seria pokazuje zero powtórzeń.")

    class ZepsutyChat(FakeChat):
        async def post(self, text: str) -> str:
            raise RuntimeError("Discord nie odpowiada")

    service, tracker, chat, state = build(
        reader,
        [BUG, {"title": "T", "body": "B"}],
        chat=ZepsutyChat(),
    )

    report = await service.run_pass()

    assert len(report.failures) == 1
    assert len(tracker.created) == 1
    assert state.issue(101) is not None


async def test_numer_duplikatu_spoza_listy_jest_ignorowany(reader, write_feedback):
    """Model bywa kreatywny w numerach — halucynacja nie może przekierować zgłoszenia."""

    write_feedback("Zapisana seria pokazuje zero powtórzeń.")
    tracker = FakeTracker(
        open_issues=[ExistingIssue(11, "Coś innego", "opis", "https://example/11")]
    )
    service, tracker, chat, _ = build(
        reader,
        [BUG, {"duplicate_of": 999, "reason": "zmyślone"}, {"title": "T", "body": "B"}],
        tracker=tracker,
    )

    await service.run_pass()

    assert tracker.comments == []
    assert len(tracker.created) == 1


# -------------------------------------------------------- prośby o zmianę ---


async def test_prosba_o_zmiane_nie_zaklada_issue_tylko_dyskusje(reader, write_feedback):
    write_feedback("Fajnie byłoby mieć timer odliczający przerwy między seriami.")
    service, tracker, chat, state = build(reader, [CHANGE])

    report = await service.run_pass()

    assert report.change_requests == 1
    # Zakres zmiany ustala zespół, nie model — issue powstanie dopiero po dyskusji.
    assert tracker.created == []
    assert len(chat.threads) == 1
    assert "oznaczcie <@999>" in chat.posts[0]
    assert state.open_discussions()[0].source_text.startswith("Fajnie byłoby")


async def test_druga_prosba_o_to_samo_dolacza_do_watku(reader, write_feedback):
    write_feedback("Timer przerw byłby przydatny.", file_name="2026-08-14T06-00-00_a_1.json")
    write_feedback("Chciałbym odliczanie przerwy.", file_name="2026-08-14T07-00-00_b_2.json")
    service, tracker, chat, state = build(
        reader,
        [CHANGE, CHANGE, {"duplicate_of": 1, "reason": "to samo"}],
    )

    report = await service.run_pass()

    assert report.change_requests == 1
    assert report.duplicates == 1
    # Jedna wiadomość na kanale, drugie zgłoszenie wpada do istniejącego wątku.
    assert len(chat.posts) == 1
    assert len(chat.thread_posts) == 1


# ------------------------------------------- domknięcie dyskusji oznaczeniem --


async def test_oznaczenie_w_watku_tworzy_issue_z_ustalen(reader):
    state = State(":memory:")
    state.record_discussion(
        Discussion(
            thread_id="w1",
            message_id="m1",
            title="Timer przerw",
            source_text="Fajnie byłoby mieć timer przerw.",
            reporter="kasia",
        )
    )
    chat = FakeChat(
        thread_history={
            "w1": [
                chat_message("domin", "Niech domyślnie będzie 90 sekund."),
                chat_message("bot", "Ogłoszenie bota", is_bot=True),
                chat_message("ola", "I dźwięk na koniec, ale bez wibracji."),
            ]
        }
    )
    service, tracker, chat, state = build(
        reader,
        [{"title": "Timer przerw między seriami", "body": "## Zakres\n- 90 s domyślnie"}],
        chat=chat,
        state=state,
    )

    await service.handle_mention("w1")

    title, body, labels = tracker.created[0]
    assert labels == ["ai-triage", "enhancement"]
    assert title == "Timer przerw między seriami"
    assert "Oryginalne zgłoszenie" in body
    assert state.discussion("w1").issue_number == 101
    # Wątek dowiaduje się o issue, a issue trafia pod obserwację PR-ek.
    assert "#101" in chat.thread_posts[-1][1]
    assert state.issues_awaiting_pr()[0].number == 101


async def test_wypowiedzi_bota_nie_wchodza_do_ustalen(reader):
    """Ogłoszenia bota to nie są wymagania zespołu — model ma ich nie widzieć."""

    state = State(":memory:")
    state.record_discussion(Discussion("w1", "m1", "Timer", "Timer przerw.", "kasia"))
    chat = FakeChat(
        thread_history={
            "w1": [
                chat_message("bot", "Oznaczcie mnie, gdy dojdziecie do porozumienia", is_bot=True),
                chat_message("domin", "90 sekund."),
            ]
        }
    )
    captured: list[str] = []

    def writer(model: str, system: str, user: str) -> dict:
        captured.append(user)
        return {"title": "T", "body": "B"}

    service, *_ = build(reader, [writer], chat=chat, state=state)

    await service.handle_mention("w1")

    assert "90 sekund" in captured[0]
    assert "Oznaczcie mnie" not in captured[0]


async def test_nierozstrzygnieta_dyskusja_i_tak_konczy_sie_issue(reader):
    """Bot jest pośrednikiem: zakłada issue, zamiast dopytywać o brakujące ustalenia."""

    state = State(":memory:")
    state.record_discussion(Discussion("w1", "m1", "Przyciski", "Przyciski są zbędne.", "domin"))
    chat = FakeChat(thread_history={"w1": [chat_message("domin", "Wywalmy oba.")]})
    service, tracker, chat, state = build(
        reader,
        [
            {
                "title": "Uproszczenie przycisków",
                "body": "## Zakres\n- usunąć przyciski",
                # Prompt o pytania nie prosi, ale model bywa uczynny ponad miarę
                # — takie pole nie ma prawa zatrzymać issue.
                "open_questions": ["Kliknięcie poza formularzem zapisuje czy odrzuca zmiany?"],
            }
        ],
        chat=chat,
        state=state,
    )

    await service.handle_mention("w1")

    title, _, labels = tracker.created[0]
    assert title == "Uproszczenie przycisków"
    assert labels == ["ai-triage", "enhancement"]
    assert state.discussion("w1").issue_number == 101
    # W wątku ląduje link do issue, a nie lista pytań.
    watek, tresc = chat.thread_posts[-1]
    assert watek == "w1"
    assert "#101" in tresc
    assert "zapisuje czy odrzuca" not in tresc


async def test_oznaczenie_w_nieznanym_watku_nic_nie_robi(reader):
    service, tracker, chat, _ = build(reader, [])

    await service.handle_mention("wątek-z-innej-rozmowy")

    assert tracker.created == []
    assert chat.thread_posts == []


async def test_powtorne_oznaczenie_nie_dubluje_issue(reader):
    state = State(":memory:")
    state.record_discussion(Discussion("w1", "m1", "Timer", "Timer przerw.", "kasia"))
    state.link_discussion_issue("w1", 55)
    state.track_issue(55, Kind.CHANGE_REQUEST, "https://example/55", "Timer", "m1", "w1")
    service, tracker, chat, _ = build(reader, [], state=state)

    await service.handle_mention("w1")

    assert tracker.created == []
    assert "#55" in chat.thread_posts[0][1]


# --------------------------------------------------------- pull requesty ----


async def test_link_do_pr_ki_ladu_je_w_watku_issue(reader):
    state = State(":memory:")
    state.track_issue(101, Kind.BUG, "https://example/101", "Błąd", "m1", "w1")
    tracker = FakeTracker()
    tracker.pull_requests[101] = PullRequestRef(7, "https://example/pull/7", "Naprawa serii")
    service, tracker, chat, state = build(reader, [], tracker=tracker, state=state)

    assert await service.poll_pull_requests() == 1

    assert "https://example/pull/7" in chat.thread_posts[0][1]
    # Drugi przebieg milczy: link ma paść raz, a nie co dwie minuty.
    assert await service.poll_pull_requests() == 0
    assert len(chat.thread_posts) == 1


async def test_awaria_githuba_nie_przerywa_petli(reader):
    state = State(":memory:")
    state.track_issue(1, Kind.BUG, "u", "A", "m", "w1")
    state.track_issue(2, Kind.BUG, "u", "B", "m", "w2")

    class Wybuchowy(FakeTracker):
        async def linked_pull_request(self, issue_number: int):
            if issue_number == 1:
                raise RuntimeError("502 z GitHuba")
            return PullRequestRef(9, "https://example/pull/9", "Druga")

    service, tracker, chat, state = build(reader, [], tracker=Wybuchowy(), state=state)

    assert await service.poll_pull_requests() == 1
    assert chat.thread_posts[0][0] == "w2"


# ------------------------------------------- komentarze pod issue -----------


async def test_nowy_komentarz_pod_issue_trafia_do_watku(reader):
    """Agent bywa odpowiada pytaniem zamiast PR-ką — pytanie ma trafić do ludzi."""

    state = State(":memory:")
    state.track_issue(101, Kind.BUG, "https://example/101", "Panel admina", "m1", "w1")
    tracker = FakeTracker()
    tracker.issue_threads[101] = [
        IssueComment(
            id=9100,
            author="github-actions[bot]",
            body="Zgłoszenie jest zbyt ogólne, żeby je zlokalizować — o którą zakładkę chodzi?",
            url="https://example/101#c9100",
        )
    ]
    service, tracker, chat, state = build(reader, [], tracker=tracker, state=state)

    assert await service.poll_issue_comments() == 1

    watek, tresc = chat.thread_posts[0]
    assert watek == "w1"
    assert "zbyt ogólne" in tresc
    assert "github-actions[bot]" in tresc

    # Drugi obieg milczy: komentarz ma paść raz, a nie co dwie minuty.
    assert await service.poll_issue_comments() == 0
    assert len(chat.thread_posts) == 1


async def test_wlasny_komentarz_nie_wraca_do_watku(reader, write_feedback):
    """Duplikat błędu dostaje komentarz na GitHubie i wpis w wątku — nie dwa wpisy."""

    write_feedback("Znowu zero powtórzeń po zapisaniu serii.")
    state = State(":memory:")
    state.track_issue(55, Kind.BUG, "https://example/55", "Seria z zerem", "m1", "w1")
    tracker = FakeTracker(
        open_issues=[ExistingIssue(55, "Seria z zerem", "Zero powtórzeń", "https://example/55")]
    )
    service, tracker, chat, state = build(
        reader, [BUG, {"duplicate_of": 55, "reason": "to samo"}], tracker=tracker, state=state
    )

    await service.run_pass()
    wpisow_po_duplikacie = len(chat.thread_posts)

    assert await service.poll_issue_comments() == 0
    assert len(chat.thread_posts) == wpisow_po_duplikacie


async def test_issue_z_pr_ka_nie_jest_juz_odpytywane(reader):
    """Po powstaniu PR-ki rozmowa przenosi się do niej — nie ma po co pytać dalej."""

    state = State(":memory:")
    state.track_issue(101, Kind.BUG, "https://example/101", "Błąd", "m1", "w1")
    state.mark_pull_request(101, 7, "https://example/pull/7")
    tracker = FakeTracker()
    tracker.issue_threads[101] = [
        IssueComment(id=9100, author="domin", body="jeszcze jedno", url="https://example/c")
    ]
    service, tracker, chat, state = build(reader, [], tracker=tracker, state=state)

    assert await service.poll_issue_comments() == 0
    assert chat.thread_posts == []


async def test_issue_sprzed_tej_funkcji_nie_wysypuje_historii(reader, tmp_path):
    """Baza na minipc zna issue sprzed tej pętli — ich wątki nie mają dostać zaległości."""

    sciezka = tmp_path / "stan.sqlite3"
    stara = sqlite3.connect(sciezka)
    stara.executescript(
        """
        CREATE TABLE issues (
            number       INTEGER PRIMARY KEY,
            kind         TEXT NOT NULL,
            url          TEXT NOT NULL,
            title        TEXT NOT NULL,
            message_id   TEXT,
            thread_id    TEXT,
            created_at   TEXT NOT NULL,
            pr_number    INTEGER,
            pr_url       TEXT,
            pr_linked_at TEXT
        );
        INSERT INTO issues (number, kind, url, title, message_id, thread_id, created_at)
        VALUES (23, 'bug', 'https://example/23', 'Stare', 'm1', 'w1', '2026-08-01T00:00:00+00:00');
        """
    )
    stara.commit()
    stara.close()

    tracker = FakeTracker()
    tracker.issue_threads[23] = [
        IssueComment(id=9001, author="domin", body="sprzed tygodnia", url="https://example/a"),
        IssueComment(id=9002, author="domin", body="i wczorajszy", url="https://example/b"),
    ]
    service, tracker, chat, state = build(reader, [], tracker=tracker, state=State(sciezka))

    assert await service.poll_issue_comments() == 0
    assert chat.thread_posts == []

    # Ale kolejny, prawdziwie nowy komentarz już przechodzi.
    tracker.issue_threads[23].append(
        IssueComment(id=9003, author="domin", body="a to jest nowe", url="https://example/c")
    )
    assert await service.poll_issue_comments() == 1
    assert "a to jest nowe" in chat.thread_posts[0][1]


# ---------------------------------------------------------- odporność -------


async def test_awaria_jednego_zgloszenia_nie_konczy_przebiegu(reader, write_feedback):
    write_feedback("pierwsze", file_name="2026-08-14T06-00-00_a_1.json")
    write_feedback("drugie", file_name="2026-08-14T07-00-00_b_2.json")

    def wybuchowy_klasyfikator(model: str, system: str, user: str) -> dict:
        if "pierwsze" in user:
            raise RuntimeError("OpenRouter padł")
        return CHANGE

    service, tracker, chat, state = build(reader, [wybuchowy_klasyfikator, CHANGE])

    report = await service.run_pass()

    assert report.change_requests == 1
    assert len(report.failures) == 1
    # Zgłoszenie, które padło, wróci po karencji; to udane — nigdy.
    assert state.pending(
        ["2026-08-14T06-00-00_a_1.json", "2026-08-14T07-00-00_b_2.json"], max_attempts=3
    ) == ["2026-08-14T06-00-00_a_1.json"]


async def test_zgloszenie_po_porazce_nie_wraca_w_najblizszym_przebiegu(reader, write_feedback):
    """Karencja liczy się w przebiegu, a nie dopiero w `state.pending`.

    Planista chodzi co kilkanaście sekund. Gdyby `run_pass` nie podawał dalej
    `retry_after_seconds`, trzy podejścia z `TRIAGE_MAX_ATTEMPTS` wypaliłyby się
    w niecałą minutę i pierwsza lepsza czkawka OpenRoutera odkładałaby zgłoszenie
    na bok bezpowrotnie.
    """

    write_feedback("pierwsze", file_name="2026-08-14T06-00-00_a_1.json")

    def wybuchowy_klasyfikator(model: str, system: str, user: str) -> dict:
        raise RuntimeError("OpenRouter padł")

    service, tracker, chat, state = build(
        reader, [wybuchowy_klasyfikator, wybuchowy_klasyfikator], retry_after_seconds=900
    )

    pierwszy = await service.run_pass()
    drugi = await service.run_pass()

    assert len(pierwszy.failures) == 1
    assert drugi.scanned == 0
    # Licznik podejść stoi na jednym: drugi przebieg nawet nie sięgnął po model.
    assert state.pending(["2026-08-14T06-00-00_a_1.json"], max_attempts=3) == [
        "2026-08-14T06-00-00_a_1.json"
    ]


async def test_reczny_przebieg_nie_czeka_na_koniec_karencji(reader, write_feedback):
    """Przycisk w panelu ma znaczyć „teraz", także dla zgłoszenia po porażce.

    Karencja broni przed trzema podejściami pod rząd do usługi, która nie
    odpowiada — a nie przed kimś, kto właśnie poprawił klucz w `.env`.
    """

    write_feedback("pierwsze", file_name="2026-08-14T06-00-00_a_1.json")

    def raz_wybuchowy(model: str, system: str, user: str) -> dict:
        raise RuntimeError("OpenRouter padł")

    service, tracker, chat, state = build(reader, [raz_wybuchowy, CHANGE], retry_after_seconds=900)

    await service.run_pass()
    naprawiony = await service.run_pass(ignore_cooldown=True)

    assert naprawiony.change_requests == 1


async def test_uszkodzony_plik_odpada_od_razu(reader, write_feedback, feedback_dir):
    (feedback_dir / "2026-08-14T06-00-00_zepsute.json").write_text("{", encoding="utf-8")
    service, tracker, chat, state = build(reader, [])

    report = await service.run_pass()

    assert len(report.failures) == 1
    # Uszkodzony plik nie naprawi się za kwadrans — nie ma po co go ponawiać.
    assert state.pending(["2026-08-14T06-00-00_zepsute.json"], max_attempts=3) == []


async def test_nieznana_kategoria_ladu_je_w_dyskusji(reader, write_feedback):
    """Bezpieczny domyślny wybór: rozmowę zamyka się zdaniem, issue — sprzątaniem."""

    write_feedback("Super apka!")
    service, tracker, chat, _ = build(reader, [{"kind": "coś_nowego", "title": "Pochwała"}])

    report = await service.run_pass()

    assert report.change_requests == 1
    assert tracker.created == []


async def test_brak_tytulu_od_modelu_nie_blokuje_zgloszenia(reader, write_feedback):
    write_feedback("Nie da się usunąć ćwiczenia z planu.\nDrugi wiersz.")
    service, tracker, chat, _ = build(reader, [{"kind": "change_request"}])

    await service.run_pass()

    assert "Nie da się usunąć ćwiczenia z planu." in chat.threads[next(iter(chat.threads))]


@pytest.mark.parametrize(
    ("wartosc", "oczekiwany_numer"),
    [(11, 11), ("11", 11), ("#11", 11), (None, None), ("brak", None), (True, None)],
)
async def test_rozne_ksztalty_odpowiedzi_o_duplikacie(
    reader, write_feedback, wartosc, oczekiwany_numer
):
    write_feedback("Zapisana seria pokazuje zero powtórzeń.")
    tracker = FakeTracker(
        open_issues=[ExistingIssue(11, "Seria z zerem", "opis", "https://example/11")]
    )
    responses: list = [BUG, {"duplicate_of": wartosc}]
    if oczekiwany_numer is None:
        responses.append({"title": "T", "body": "B"})
    service, tracker, chat, _ = build(reader, responses, tracker=tracker)

    await service.run_pass()

    if oczekiwany_numer is None:
        assert len(tracker.created) == 1
    else:
        assert tracker.comments[0][0] == oczekiwany_numer
