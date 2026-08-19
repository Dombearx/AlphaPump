"""Typy przenoszone między warstwami usługi.

Wszystkie są niezmienne i pozbawione zachowania. To jest celowe: logika siedzi
w `service.py`, a adaptery (`openrouter.py`, `github.py`, `discord_chat.py`)
tłumaczą świat zewnętrzny na te struktury i z powrotem. Dzięki temu test może
podstawić atrapę adaptera, nie udając ani HTTP-a, ani Discorda.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import StrEnum


class Kind(StrEnum):
    """Wynik klasyfikacji zgłoszenia.

    Dwie wartości, świadomie bez kosza na „inne": zgłoszenie, które nie jest
    ani błędem, ani prośbą o zmianę, i tak trafia do jednego z tych dwóch
    worków i zostaje zamknięte ręcznie. Trzecia kategoria kosztowałaby osobną
    ścieżkę w kodzie i osobne miejsce, w które nikt by nie zaglądał.
    """

    BUG = "bug"
    CHANGE_REQUEST = "change_request"


@dataclass(frozen=True)
class LogEntry:
    """Wpis z bufora logów telefonu dołączony do zgłoszenia."""

    level: str
    message: str
    at: str


@dataclass(frozen=True)
class Feedback:
    """Jedno zgłoszenie zwrotne — dokładnie to, co API zapisało na dysk.

    Kształt pliku ustala `apps/api/src/routes/feedback.ts`; `file_name` jest
    tożsamością zgłoszenia w stanie usługi, bo nazwa pliku jest unikalna
    (znacznik czasu + nick + losowy sufiks) i nie zmienia się po zapisie.
    """

    file_name: str
    nickname: str
    email: str
    sent_at: datetime
    message: str
    logs: tuple[LogEntry, ...] = ()


@dataclass(frozen=True)
class Classification:
    """Odpowiedź klasyfikatora: rodzaj plus tytuł do użycia dalej."""

    kind: Kind
    title: str
    summary: str


@dataclass(frozen=True)
class IssueDraft:
    """Treść issue przed wysłaniem na GitHuba."""

    title: str
    body: str


@dataclass(frozen=True)
class IssueRef:
    """Issue, które już istnieje na GitHubie."""

    number: int
    url: str


@dataclass(frozen=True)
class ExistingIssue:
    """Otwarte issue podawane LLM-owi jako kandydat na duplikat."""

    number: int
    title: str
    body: str
    url: str


@dataclass(frozen=True)
class PullRequestRef:
    """Pull request wskazujący na śledzone issue."""

    number: int
    url: str
    title: str


@dataclass(frozen=True)
class IssueComment:
    """Komentarz pod issue na GitHubie.

    `id` jest tu ważniejsze niż treść: po nim usługa poznaje, czego jeszcze nie
    przekazała do wątku. Numery komentarzy rosną w skali całego GitHuba, więc
    porównanie „większy niż ostatnio widziany" działa też wtedy, gdy dwa
    komentarze powstały w tej samej sekundzie.
    """

    id: int
    author: str
    body: str
    url: str


@dataclass(frozen=True)
class ChatMessage:
    """Wiadomość z wątku na Discordzie, w postaci podawanej LLM-owi."""

    author: str
    content: str
    at: datetime
    is_bot: bool = False


@dataclass(frozen=True)
class Discussion:
    """Wątek na Discordzie, w którym trwa ustalanie zakresu zmiany.

    `source_text` jest kopią oryginalnego zgłoszenia, a nie odwołaniem do pliku.
    Plik na minipc może zostać sprzątnięty albo przeniesiony, a wątek na
    Discordzie żyje tygodniami — kopia w bazie stanu sprawia, że domknięcie
    dyskusji nie zależy od tego, czy plik jeszcze tam leży.
    """

    thread_id: str
    message_id: str
    title: str
    source_text: str
    reporter: str
    source_file: str | None = None
    issue_number: int | None = None


@dataclass(frozen=True)
class TrackedIssue:
    """Issue, które usługa obserwuje w oczekiwaniu na pull requesta."""

    number: int
    kind: Kind
    url: str
    title: str
    thread_id: str | None
    pr_number: int | None = None
    last_comment_id: int | None = None


@dataclass
class DailyReport:
    """Podsumowanie jednego przebiegu dziennego — do logu i do testów."""

    scanned: int = 0
    bugs: int = 0
    change_requests: int = 0
    duplicates: int = 0
    failures: list[tuple[str, str]] = field(default_factory=list)

    def __str__(self) -> str:
        return (
            f"przejrzano={self.scanned} błędy={self.bugs} "
            f"zmiany={self.change_requests} duplikaty={self.duplicates} "
            f"błędy_przetwarzania={len(self.failures)}"
        )
