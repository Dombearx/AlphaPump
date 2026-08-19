"""Logika segregacji zgłoszeń — jedyne miejsce, w którym zapadają decyzje.

Trzy przebiegi, każdy uruchamiany przez kogoś innego:

* `run_daily()` — planista, raz na dobę. Czyta nowe zgłoszenia, klasyfikuje je
  i albo zakłada issue (błąd), albo otwiera dyskusję na Discordzie (zmiana).
* `handle_mention()` — bot, gdy ktoś oznaczy go w wątku dyskusyjnym. Czyta całą
  rozmowę i zamienia ustalenia w issue.
* `poll_pull_requests()` — pętla co kilka minut. Dokleja link do PR-ki w wątku
  tego issue, którego PR-ka dotyczy.
* `poll_issue_comments()` — ta sama pętla. Przekłada do wątku komentarze, które
  pojawiły się pod issue: agent bywa odpowiada pytaniem zamiast PR-ką, a wtedy
  pytanie musi trafić tam, gdzie są ludzie zdolni odpowiedzieć.

Klasa nie wie nic o HTTP, SQL-u ani o Discordzie: dostaje `Llm`, `IssueTracker`
i `Chat` w konstruktorze. Stąd testy z atrapami zamiast serwera na localhoście.
"""

from __future__ import annotations

import logging

from . import prompts
from .config import Config
from .feedback import FeedbackReader, MalformedFeedback
from .models import Classification, DailyReport, Discussion, Feedback, IssueDraft, Kind
from .ports import Chat, IssueTracker, Llm
from .state import State

logger = logging.getLogger(__name__)

# Ile otwartych issue pokazujemy modelowi przy sprawdzaniu duplikatów. Przy
# kilkudziesięciu otwartych zgłoszeniach starsze i tak nie są już kandydatami,
# a każde kosztuje miejsce w oknie kontekstu.
DUPLICATE_CANDIDATE_LIMIT = 30


class TriageService:
    def __init__(
        self,
        config: Config,
        state: State,
        reader: FeedbackReader,
        llm: Llm,
        tracker: IssueTracker,
        chat: Chat,
    ) -> None:
        self._config = config
        self._state = state
        self._reader = reader
        self._llm = llm
        self._tracker = tracker
        self._chat = chat

    # ----------------------------------------------------- przebieg dzienny --

    async def run_daily(self) -> DailyReport:
        """Przetwarza wszystkie zgłoszenia, których jeszcze nie widzieliśmy."""

        report = DailyReport()
        pending = self._state.pending(self._reader.file_names(), self._config.max_attempts)
        report.scanned = len(pending)
        if not pending:
            logger.info("brak nowych zgłoszeń")
            return report

        logger.info("nowych zgłoszeń do przejrzenia: %d", len(pending))
        for file_name in pending:
            try:
                await self._process_one(file_name, report)
            except Exception as error:  # noqa: BLE001 — jedno złe zgłoszenie nie kończy przebiegu
                attempts = self._state.mark_failed(file_name, repr(error))
                report.failures.append((file_name, repr(error)))
                logger.exception(
                    "zgłoszenie %s nieprzetworzone (podejście %d z %d)",
                    file_name,
                    attempts,
                    self._config.max_attempts,
                )
        logger.info("przebieg dzienny zakończony: %s", report)
        return report

    async def _process_one(self, file_name: str, report: DailyReport) -> None:
        try:
            feedback = self._reader.read(file_name)
        except MalformedFeedback as error:
            # Uszkodzony plik nie naprawi się jutro. Zapisujemy komplet podejść
            # od razu, żeby nie wracał codziennie do tej samej ściany.
            for _ in range(self._config.max_attempts):
                self._state.mark_failed(file_name, str(error))
            report.failures.append((file_name, str(error)))
            logger.error("pomijam %s: %s", file_name, error)
            return

        classification = await self._classify(feedback)
        logger.info(
            "zgłoszenie %s zaklasyfikowane jako %s: %s",
            file_name,
            classification.kind,
            classification.title,
        )

        if classification.kind is Kind.BUG:
            await self._handle_bug(feedback, classification, report)
        else:
            await self._handle_change_request(feedback, classification, report)

    async def _classify(self, feedback: Feedback) -> Classification:
        data = await self._llm.complete_json(
            self._config.classifier_model,
            prompts.CLASSIFY_SYSTEM,
            prompts.classify_user_prompt(feedback),
        )
        raw_kind = str(data.get("kind", "")).strip().lower().replace(" ", "_")
        if raw_kind == "bug":
            kind = Kind.BUG
        else:
            # Wszystko, czego model nie nazwał błędem, idzie do dyskusji.
            # To jest bezpieczniejszy domyślny wybór: dyskusję da się zamknąć
            # jednym zdaniem, a błędne issue trzeba zamknąć i posprzątać.
            if raw_kind != Kind.CHANGE_REQUEST:
                logger.warning("nieznana kategoria %r, traktuję jako prośbę o zmianę", raw_kind)
            kind = Kind.CHANGE_REQUEST

        title = str(data.get("title") or "").strip() or _fallback_title(feedback)
        return Classification(
            kind=kind,
            title=title[:120],
            summary=str(data.get("summary") or "").strip(),
        )

    # ---------------------------------------------------------------- błędy --

    async def _handle_bug(
        self,
        feedback: Feedback,
        classification: Classification,
        report: DailyReport,
    ) -> None:
        duplicate = await self._find_duplicate_issue(feedback)
        if duplicate is not None:
            comment_id = await self._tracker.comment(duplicate, prompts.duplicate_note(feedback))
            # Własna wypowiedź odhaczona od razu: odpytywanie ma jej nie odesłać
            # z powrotem do wątku, w którym za chwilę i tak ją ogłosimy.
            self._state.mark_comments_seen(duplicate, comment_id)
            tracked = self._state.issue(duplicate)
            if tracked and tracked.thread_id:
                await self._chat.post_in_thread(
                    tracked.thread_id, prompts.duplicate_thread_note(feedback)
                )
            self._state.mark_processed(feedback.file_name, Kind.BUG, duplicate, None)
            report.duplicates += 1
            logger.info("zgłoszenie %s to duplikat #%d", feedback.file_name, duplicate)
            return

        draft = await self._draft_bug_issue(feedback, classification)
        issue = await self._tracker.create_issue(
            draft.title,
            draft.body + prompts.feedback_footer(feedback),
            [self._config.label_trigger, self._config.label_bug],
        )

        # Issue zapisujemy w stanie **przed** wyjściem na Discorda. GitHub już je
        # ma; gdyby Discord odmówił, kolejny przebieg zobaczy je wśród kandydatów
        # na duplikat i dopisze komentarz zamiast zakładać drugie issue na ten
        # sam błąd. Identyfikatory wiadomości i wątku dołączą chwilę później —
        # zapis je dokleja, a nie nadpisuje pustymi wartościami.
        self._state.track_issue(issue.number, Kind.BUG, issue.url, draft.title, None, None)

        message_id = await self._chat.post(prompts.bug_announcement(issue, draft.title, feedback))
        thread_id = await self._chat.open_thread(message_id, prompts.thread_name(draft.title))

        self._state.track_issue(
            issue.number, Kind.BUG, issue.url, draft.title, message_id, thread_id
        )
        self._state.mark_processed(feedback.file_name, Kind.BUG, issue.number, thread_id)
        report.bugs += 1
        logger.info("założone issue #%d dla %s", issue.number, feedback.file_name)

    async def _draft_bug_issue(
        self, feedback: Feedback, classification: Classification
    ) -> IssueDraft:
        data = await self._llm.complete_json(
            self._config.writer_model,
            prompts.BUG_ISSUE_SYSTEM,
            prompts.bug_issue_user_prompt(feedback),
        )
        title = str(data.get("title") or "").strip() or classification.title
        body = str(data.get("body") or "").strip() or feedback.message
        return IssueDraft(title=title[:250], body=body)

    async def _find_duplicate_issue(self, feedback: Feedback) -> int | None:
        """Pyta model, czy któreś z otwartych issue bota opisuje już tę sprawę."""

        candidates = await self._tracker.list_open_issues(self._config.label_trigger)
        if not candidates:
            return None
        shortlist = candidates[:DUPLICATE_CANDIDATE_LIMIT]

        data = await self._llm.complete_json(
            self._config.writer_model,
            prompts.DUPLICATE_SYSTEM,
            prompts.duplicate_user_prompt(feedback, shortlist),
        )
        number = _as_optional_int(data.get("duplicate_of"))
        if number is None:
            return None
        if not any(candidate.number == number for candidate in shortlist):
            # Model potrafi podać numer spoza listy — wtedy jego odpowiedź nie
            # jest wskazaniem duplikatu, tylko halucynacją, i tak ją traktujemy.
            logger.warning("model wskazał #%s spoza listy kandydatów — ignoruję", number)
            return None
        logger.info("duplikat #%d: %s", number, data.get("reason", ""))
        return number

    # ------------------------------------------------------ prośby o zmianę --

    async def _handle_change_request(
        self,
        feedback: Feedback,
        classification: Classification,
        report: DailyReport,
    ) -> None:
        duplicate = await self._find_duplicate_discussion(feedback)
        if duplicate is not None:
            await self._chat.post_in_thread(
                duplicate.thread_id, prompts.duplicate_thread_note(feedback)
            )
            self._state.mark_processed(
                feedback.file_name,
                Kind.CHANGE_REQUEST,
                duplicate.issue_number,
                duplicate.thread_id,
            )
            report.duplicates += 1
            logger.info(
                "zgłoszenie %s dołączone do wątku %s", feedback.file_name, duplicate.thread_id
            )
            return

        message_id = await self._chat.post(
            prompts.change_request_announcement(
                classification.title, feedback, self._chat.mention()
            )
        )
        thread_id = await self._chat.open_thread(
            message_id, prompts.thread_name(classification.title)
        )
        self._state.record_discussion(
            Discussion(
                thread_id=thread_id,
                message_id=message_id,
                title=classification.title,
                source_text=feedback.message,
                reporter=feedback.nickname,
                source_file=feedback.file_name,
            )
        )
        self._state.mark_processed(feedback.file_name, Kind.CHANGE_REQUEST, None, thread_id)
        report.change_requests += 1
        logger.info("otwarta dyskusja %s dla %s", thread_id, feedback.file_name)

    async def _find_duplicate_discussion(self, feedback: Feedback) -> Discussion | None:
        """To samo co przy błędach, tylko kandydatami są trwające dyskusje."""

        open_discussions = self._state.open_discussions()
        if not open_discussions:
            return None
        shortlist = open_discussions[-DUPLICATE_CANDIDATE_LIMIT:]

        # Model dostaje numery porządkowe listy, nie identyfikatory wątków:
        # osiemnastocyfrowy identyfikator Discorda to zaproszenie do pomyłki
        # w ostatniej cyfrze, a numer 1..30 nie ma jak się przekręcić.
        listing = [
            (index, discussion.title, discussion.source_text)
            for index, discussion in enumerate(shortlist, start=1)
        ]
        data = await self._llm.complete_json(
            self._config.writer_model,
            prompts.DUPLICATE_SYSTEM,
            prompts.duplicate_thread_prompt(feedback, listing),
        )
        index = _as_optional_int(data.get("duplicate_of"))
        if index is None or not 1 <= index <= len(shortlist):
            return None
        return shortlist[index - 1]

    # --------------------------------------- domknięcie dyskusji oznaczeniem --

    async def handle_mention(self, thread_id: str) -> None:
        """Ktoś oznaczył bota w wątku — czas zamienić ustalenia w issue.

        Bez etapu dopytywania: rolą bota jest pośredniczyć między Discordem
        a GitHubem, więc issue powstaje z tego, co w wątku padło, nawet gdy
        rozmowa nie rozstrzygnęła wszystkiego. Czego nie ustalono, model opisuje
        w treści issue, a dalsze ustalenia idą już w wątku albo pod issue.
        """

        discussion = self._state.discussion(thread_id)
        if discussion is None:
            logger.debug("oznaczenie w nieznanym wątku %s — pomijam", thread_id)
            return

        if discussion.issue_number is not None:
            tracked = self._state.issue(discussion.issue_number)
            url = tracked.url if tracked else ""
            await self._chat.post_in_thread(
                thread_id, prompts.issue_already_exists_note(discussion.issue_number, url)
            )
            return

        messages = await self._chat.thread_messages(thread_id)
        # Wypowiedzi bota wypadają z materiału: to jego własne ogłoszenia
        # i potwierdzenia, a nie ustalenia zespołu.
        human_messages = [message for message in messages if not message.is_bot]

        data = await self._llm.complete_json(
            self._config.writer_model,
            prompts.FEATURE_ISSUE_SYSTEM,
            prompts.feature_issue_user_prompt(
                discussion.title,
                discussion.source_text,
                discussion.reporter,
                human_messages,
            ),
        )

        title = str(data.get("title") or "").strip() or discussion.title
        body = str(data.get("body") or "").strip() or discussion.source_text

        issue = await self._tracker.create_issue(
            title[:250],
            body + _discussion_footer(discussion, len(human_messages)),
            [self._config.label_trigger, self._config.label_feature],
        )
        self._state.track_issue(
            issue.number,
            Kind.CHANGE_REQUEST,
            issue.url,
            title,
            discussion.message_id,
            thread_id,
        )
        self._state.link_discussion_issue(thread_id, issue.number)
        await self._chat.post_in_thread(thread_id, prompts.issue_created_note(issue, title))
        logger.info("z dyskusji %s powstało issue #%d", thread_id, issue.number)

    # ---------------------------------------------------- nasłuch pull requestów --

    async def poll_pull_requests(self) -> int:
        """Sprawdza, czy do śledzonych issue powstały już PR-ki.

        Odpytywanie zamiast webhooka jest wymuszone topologią: minipc stoi za
        VPN-em i GitHub nie ma jak się do niego dobić. Skutek uboczny wychodzi
        na plus — PR-ka otwarta ręcznie zostanie zauważona tak samo jak ta
        z Akcji, bo liczy się powiązanie w GitHubie, a nie to, kto ją otworzył.
        """

        linked = 0
        for issue in self._state.issues_awaiting_pr():
            try:
                pull_request = await self._tracker.linked_pull_request(issue.number)
            except Exception:  # noqa: BLE001 — awaria GitHuba nie może ubić pętli
                logger.exception("nie udało się sprawdzić PR-ek dla #%d", issue.number)
                continue
            if pull_request is None:
                continue
            if issue.thread_id:
                await self._chat.post_in_thread(
                    issue.thread_id, prompts.pull_request_note(pull_request, issue.kind)
                )
            self._state.mark_pull_request(issue.number, pull_request.number, pull_request.url)
            linked += 1
            logger.info("issue #%d dostało PR-kę #%d", issue.number, pull_request.number)
        return linked

    async def poll_issue_comments(self) -> int:
        """Przekłada nowe komentarze spod issue do wątku na Discordzie.

        Agent w Akcjach nie zawsze kończy PR-ką. Gdy zgłoszenie jest zbyt ogólne,
        żeby je zlokalizować, ma napisać o tym w komentarzu — i taki komentarz
        był dotąd ślepym zaułkiem: powstawał na GitHubie, a rozmowa toczyła się
        na Discordzie. To samo dotyczy powiadomienia o nieudanym przebiegu.

        Odpytujemy te same issue co przy PR-kach — z wątkiem i bez PR-ki. Po
        powstaniu PR-ki rozmowa i tak przenosi się do niej, a każde dodatkowe
        issue to kolejne zapytanie w każdej rundzie pętli.
        """

        relayed = 0
        for issue in self._state.issues_awaiting_pr():
            if not issue.thread_id:
                continue
            try:
                comments = await self._tracker.issue_comments(issue.number)
            except Exception:  # noqa: BLE001 — awaria GitHuba nie może ubić pętli
                logger.exception("nie udało się pobrać komentarzy do #%d", issue.number)
                continue
            if not comments:
                continue

            newest = comments[-1].id
            if issue.last_comment_id is None:
                # Issue sprzed tej funkcji: nie wiemy, co wątek już widział.
                # Zapamiętujemy stan bieżący i milczymy — wysypanie całej
                # historii komentarzy byłoby gorsze niż jej pominięcie.
                self._state.mark_comments_seen(issue.number, newest)
                logger.info(
                    "issue #%d: zapamiętany stan komentarzy, bez przekazywania", issue.number
                )
                continue

            for comment in comments:
                if comment.id <= issue.last_comment_id:
                    continue
                await self._chat.post_in_thread(
                    issue.thread_id, prompts.issue_comment_note(comment, issue.number)
                )
                relayed += 1
            self._state.mark_comments_seen(issue.number, newest)
        return relayed


def _fallback_title(feedback: Feedback) -> str:
    """Gdy model nie zwrócił tytułu — pierwsza linia zgłoszenia jest lepsza niż nic."""

    first_line = feedback.message.strip().splitlines()[0] if feedback.message.strip() else ""
    title = first_line.strip() or f"Zgłoszenie od {feedback.nickname}"
    return title[:80]


def _discussion_footer(discussion: Discussion, message_count: int) -> str:
    return (
        "\n\n---\n"
        f"_Issue powstało z dyskusji na Discordzie ({message_count} wiadomości) "
        f"wokół zgłoszenia od **{discussion.reporter}**._\n\n"
        "<details><summary>Oryginalne zgłoszenie</summary>\n\n"
        f"```\n{discussion.source_text}\n```\n\n</details>"
    )


def _as_optional_int(value: object) -> int | None:
    """`duplicate_of` bywa liczbą, napisem `"12"`, `"#12"` albo `null`/`"brak"`."""

    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        cleaned = value.strip().lstrip("#")
        if cleaned.isdigit():
            return int(cleaned)
    return None
