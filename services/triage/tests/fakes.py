"""Atrapy adapterów — tyle świata zewnętrznego, ile potrzeba do sprawdzenia decyzji.

Każda z nich zapamiętuje, co dostała, bo w tej usłudze wynikiem działania jest
właśnie skutek uboczny: założone issue, wysłana wiadomość, dopisany komentarz.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from itertools import count
from zoneinfo import ZoneInfo

from alphapump_triage.config import Config
from alphapump_triage.models import ChatMessage, ExistingIssue, IssueRef, PullRequestRef


class FakeLlm:
    """Zwraca odpowiedzi przygotowane pod kolejne wywołania.

    Odpowiedź może być słownikiem albo funkcją `(model, system, user) -> dict`,
    gdy test chce podjąć decyzję na podstawie treści promptu.
    """

    def __init__(self, responses: list[dict | Callable[[str, str, str], dict]]) -> None:
        self._responses = list(responses)
        self.calls: list[tuple[str, str, str]] = []

    async def complete_json(self, model: str, system: str, user: str) -> dict:
        self.calls.append((model, system, user))
        if not self._responses:
            raise AssertionError(f"nieoczekiwane zapytanie do modelu {model}:\n{user[:400]}")
        response = self._responses.pop(0)
        return response(model, system, user) if callable(response) else response


class FakeTracker:
    def __init__(self, open_issues: list[ExistingIssue] | None = None) -> None:
        self.open_issues = open_issues or []
        self.created: list[tuple[str, str, list[str]]] = []
        self.comments: list[tuple[int, str]] = []
        self.pull_requests: dict[int, PullRequestRef] = {}
        self._numbers = count(101)

    async def create_issue(self, title: str, body: str, labels: list[str]) -> IssueRef:
        self.created.append((title, body, labels))
        number = next(self._numbers)
        return IssueRef(number=number, url=f"https://github.com/test/test/issues/{number}")

    async def list_open_issues(self, label: str) -> list[ExistingIssue]:
        return list(self.open_issues)

    async def comment(self, issue_number: int, body: str) -> None:
        self.comments.append((issue_number, body))

    async def linked_pull_request(self, issue_number: int) -> PullRequestRef | None:
        return self.pull_requests.get(issue_number)


class FakeChat:
    def __init__(self, thread_history: dict[str, list[ChatMessage]] | None = None) -> None:
        self.posts: list[str] = []
        self.threads: dict[str, str] = {}
        self.thread_posts: list[tuple[str, str]] = []
        self.history = thread_history or {}
        self._ids = count(1)

    def mention(self) -> str:
        return "<@999>"

    async def post(self, text: str) -> str:
        self.posts.append(text)
        return f"msg-{next(self._ids)}"

    async def open_thread(self, message_id: str, name: str) -> str:
        thread_id = f"thread-{next(self._ids)}"
        self.threads[thread_id] = name
        return thread_id

    async def post_in_thread(self, thread_id: str, text: str) -> None:
        self.thread_posts.append((thread_id, text))

    async def thread_messages(self, thread_id: str) -> list[ChatMessage]:
        return self.history.get(thread_id, [])


def make_config(**overrides) -> Config:
    defaults = dict(
        feedback_dir="/nieistotne",
        state_db=":memory:",
        daily_hour=3,
        daily_minute=17,
        timezone=ZoneInfo("Europe/Warsaw"),
        openrouter_api_key="test",
        openrouter_base_url="https://example.invalid/v1",
        classifier_model="klasyfikator",
        writer_model="redaktor",
        llm_timeout_seconds=5.0,
        github_token="test",
        github_repo="Dombearx/AlphaPump",
        github_api_url="https://example.invalid",
        label_trigger="ai-triage",
        label_bug="bug",
        label_feature="enhancement",
        discord_token="test",
        discord_channel_id=1,
        pr_poll_seconds=60,
        max_attempts=3,
        dry_run=False,
        http_port=8090,
        http_token="test",
    )
    defaults.update(overrides)
    return Config(**defaults)


def chat_message(author: str, content: str, is_bot: bool = False) -> ChatMessage:
    return ChatMessage(author=author, content=content, at=datetime.now(UTC), is_bot=is_bot)
