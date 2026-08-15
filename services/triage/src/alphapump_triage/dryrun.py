"""Tryb próbny: wszystko się liczy, nic nie powstaje.

Zamiast rozsiewać `if dry_run` po logice, podmieniamy adaptery. Odczyty idą do
prawdziwych źródeł — pliki zgłoszeń, otwarte issue, model — więc klasyfikacja
i wykrywanie duplikatów działają naprawdę i widać w logu, co by z nich wyszło.
Zapisy (issue, komentarz, wiadomość na Discordzie) kończą się na logu.

Stan przy `TRIAGE_DRY_RUN=true` trzymamy w pamięci (patrz `__main__`), żeby
przebieg próbny nie oznaczył zgłoszeń jako przetworzonych — inaczej pierwszy
prawdziwy przebieg uznałby, że nie ma nic do roboty.
"""

from __future__ import annotations

import itertools
import logging

from .models import ChatMessage, ExistingIssue, IssueRef, PullRequestRef
from .ports import Chat, IssueTracker

logger = logging.getLogger(__name__)


class DryRunIssueTracker:
    """Czyta z prawdziwego GitHuba, ale niczego tam nie zakłada."""

    def __init__(self, inner: IssueTracker) -> None:
        self._inner = inner
        self._numbers = itertools.count(900_001)

    async def create_issue(self, title: str, body: str, labels: list[str]) -> IssueRef:
        number = next(self._numbers)
        logger.info(
            "[próbnie] issue %s (etykiety: %s)\n--- treść ---\n%s\n--- koniec ---",
            title,
            ", ".join(labels),
            body,
        )
        return IssueRef(number=number, url=f"https://example.invalid/issues/{number}")

    async def list_open_issues(self, label: str) -> list[ExistingIssue]:
        return await self._inner.list_open_issues(label)

    async def comment(self, issue_number: int, body: str) -> None:
        logger.info("[próbnie] komentarz do #%d:\n%s", issue_number, body)

    async def linked_pull_request(self, issue_number: int) -> PullRequestRef | None:
        return await self._inner.linked_pull_request(issue_number)


class DryRunChat:
    """Wypisuje na log to, co poszłoby na Discorda."""

    def __init__(self, inner: Chat | None = None) -> None:
        self._inner = inner
        self._ids = itertools.count(1)

    def mention(self) -> str:
        return self._inner.mention() if self._inner else "@bota"

    async def post(self, text: str) -> str:
        message_id = f"proba-msg-{next(self._ids)}"
        logger.info("[próbnie] wiadomość na kanale (%s):\n%s", message_id, text)
        return message_id

    async def open_thread(self, message_id: str, name: str) -> str:
        thread_id = f"proba-watek-{next(self._ids)}"
        logger.info("[próbnie] wątek %r (%s) pod wiadomością %s", name, thread_id, message_id)
        return thread_id

    async def post_in_thread(self, thread_id: str, text: str) -> None:
        logger.info("[próbnie] wpis do wątku %s:\n%s", thread_id, text)

    async def thread_messages(self, thread_id: str) -> list[ChatMessage]:
        if self._inner is not None:
            return await self._inner.thread_messages(thread_id)
        return []
