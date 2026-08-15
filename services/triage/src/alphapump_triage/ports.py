"""Granice usługi: co `TriageService` zakłada o świecie zewnętrznym.

Trzy protokoły — model językowy, system zgłoszeń, komunikator. Logika zna
wyłącznie te trzy kształty, więc test podstawia atrapę zamiast udawać HTTP-a
i bramę Discorda, a wymiana Discorda na cokolwiek innego jest jednym plikiem.
"""

from __future__ import annotations

from typing import Protocol

from .models import ChatMessage, ExistingIssue, IssueRef, PullRequestRef


class Llm(Protocol):
    """Model językowy zwracający obiekt JSON.

    Celowo jedna metoda zamiast `classify`/`summarize`/`draft`: treść zadania
    jest w promptach (`prompts.py`), a adapter odpowiada tylko za dowiezienie
    odpowiedzi w postaci słownika. Dzięki temu zmiana promptu nie dotyka
    warstwy HTTP, a atrapa w teście nie musi wiedzieć, o co pytamy.
    """

    async def complete_json(self, model: str, system: str, user: str) -> dict: ...


class IssueTracker(Protocol):
    """Tyle GitHuba, ile ta usługa naprawdę potrzebuje."""

    async def create_issue(self, title: str, body: str, labels: list[str]) -> IssueRef: ...

    async def list_open_issues(self, label: str) -> list[ExistingIssue]: ...

    async def comment(self, issue_number: int, body: str) -> None: ...

    async def linked_pull_request(self, issue_number: int) -> PullRequestRef | None: ...


class Chat(Protocol):
    """Tyle Discorda, ile ta usługa naprawdę potrzebuje.

    Identyfikatory są napisami, nie liczbami: w bazie stanu i tak lądują jako
    tekst, a Discord potrafi zwrócić wartości spoza zakresu, w którym JSON
    zachowuje precyzję liczb.
    """

    def mention(self) -> str: ...

    async def post(self, text: str) -> str: ...

    async def open_thread(self, message_id: str, name: str) -> str: ...

    async def post_in_thread(self, thread_id: str, text: str) -> None: ...

    async def thread_messages(self, thread_id: str) -> list[ChatMessage]: ...
