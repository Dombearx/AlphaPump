"""Trwały stan usługi w pliku SQLite.

Trzyma trzy rzeczy, których nie da się odtworzyć z GitHuba ani z Discorda:

* które zgłoszenia zostały już przejrzane (inaczej każdy restart zakładałby
  te same issue od nowa),
* powiązanie issue → wątek na Discordzie (żeby link do PR-ki trafił tam, gdzie
  ludzie o tym issue rozmawiają),
* wątki z dyskusją o zmianie, które czekają na domknięcie oznaczeniem bota.

Dostęp jest synchroniczny mimo asynchronicznej reszty usługi. To jest świadome:
zapytania idą do pliku na lokalnym dysku i trwają mikrosekundy, a jedyny wątek
pętli zdarzeń i tak spędza czas na czekaniu na HTTP. Doklejanie tu puli wątków
kupiłoby wyłącznie okazję do wyścigu.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import UTC, datetime
from pathlib import Path

from .models import Discussion, Kind, TrackedIssue

_SCHEMA = """
CREATE TABLE IF NOT EXISTS feedback_seen (
    file_name    TEXT PRIMARY KEY,
    seen_at      TEXT NOT NULL,
    kind         TEXT,
    issue_number INTEGER,
    thread_id    TEXT,
    attempts     INTEGER NOT NULL DEFAULT 0,
    last_error   TEXT
);

CREATE TABLE IF NOT EXISTS issues (
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

CREATE TABLE IF NOT EXISTS discussions (
    thread_id    TEXT PRIMARY KEY,
    message_id   TEXT NOT NULL,
    title        TEXT NOT NULL,
    source_text  TEXT NOT NULL,
    reporter     TEXT NOT NULL,
    source_file  TEXT,
    created_at   TEXT NOT NULL,
    issue_number INTEGER,
    open_questions TEXT
);
"""


def _now() -> str:
    return datetime.now(UTC).isoformat()


class State:
    def __init__(self, path: str | Path) -> None:
        self._path = Path(path)
        if str(self._path) != ":memory:":
            self._path.parent.mkdir(parents=True, exist_ok=True)
        self._connection = sqlite3.connect(self._path, isolation_level=None)
        self._connection.row_factory = sqlite3.Row
        # WAL przeżywa nagłe ubicie kontenera bez psucia pliku; `foreign_keys`
        # jest tu na wyrost, ale kosztuje jedną linię i zamyka temat na przyszłość.
        self._connection.execute("PRAGMA journal_mode=WAL")
        self._connection.execute("PRAGMA foreign_keys=ON")
        self._connection.executescript(_SCHEMA)
        self._migrate()

    def _migrate(self) -> None:
        """Dokłada kolumny, których nie miały wcześniejsze wersje schematu.

        `CREATE TABLE IF NOT EXISTS` omija istniejącą tabelę w całości, a plik
        na minipc żyje od pierwszego uruchomienia usługi. Bez tego nowa kolumna
        pojawiłaby się wyłącznie na świeżej bazie — czyli w testach i nigdzie
        indziej.
        """

        columns = {
            row["name"] for row in self._connection.execute("PRAGMA table_info(discussions)")
        }
        if "open_questions" not in columns:
            self._connection.execute("ALTER TABLE discussions ADD COLUMN open_questions TEXT")

    def close(self) -> None:
        self._connection.close()

    # ------------------------------------------------------------ zgłoszenia --

    def pending(self, file_names: list[str], max_attempts: int) -> list[str]:
        """Zgłoszenia do przetworzenia: nieprzetworzone i jeszcze nieodpuszczone.

        Kolejność wejściowa (chronologiczna) jest zachowana, bo przy dwóch
        zgłoszeniach tego samego błędu duplikatem ma zostać to późniejsze.
        """

        rows = self._connection.execute(
            "SELECT file_name, kind, attempts FROM feedback_seen"
        ).fetchall()
        done = {row["file_name"] for row in rows if row["kind"] is not None}
        exhausted = {
            row["file_name"]
            for row in rows
            if row["kind"] is None and row["attempts"] >= max_attempts
        }
        skip = done | exhausted
        return [name for name in file_names if name not in skip]

    def mark_processed(
        self,
        file_name: str,
        kind: Kind,
        issue_number: int | None,
        thread_id: str | None,
    ) -> None:
        self._connection.execute(
            """
            INSERT INTO feedback_seen (file_name, seen_at, kind, issue_number, thread_id, attempts)
            VALUES (?, ?, ?, ?, ?, 0)
            ON CONFLICT(file_name) DO UPDATE SET
                seen_at = excluded.seen_at,
                kind = excluded.kind,
                issue_number = excluded.issue_number,
                thread_id = excluded.thread_id,
                last_error = NULL
            """,
            (file_name, _now(), str(kind), issue_number, thread_id),
        )

    def mark_failed(self, file_name: str, error: str) -> int:
        """Zapisuje nieudane podejście i zwraca ich łączną liczbę."""

        self._connection.execute(
            """
            INSERT INTO feedback_seen (file_name, seen_at, attempts, last_error)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(file_name) DO UPDATE SET
                seen_at = excluded.seen_at,
                attempts = feedback_seen.attempts + 1,
                last_error = excluded.last_error
            """,
            (file_name, _now(), error[:2000]),
        )
        row = self._connection.execute(
            "SELECT attempts FROM feedback_seen WHERE file_name = ?", (file_name,)
        ).fetchone()
        return int(row["attempts"]) if row else 0

    # ----------------------------------------------------------------- issue --

    def track_issue(
        self,
        number: int,
        kind: Kind,
        url: str,
        title: str,
        message_id: str | None,
        thread_id: str | None,
    ) -> None:
        self._connection.execute(
            """
            INSERT INTO issues (number, kind, url, title, message_id, thread_id, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(number) DO UPDATE SET
                url = excluded.url,
                title = excluded.title,
                message_id = COALESCE(excluded.message_id, issues.message_id),
                thread_id = COALESCE(excluded.thread_id, issues.thread_id)
            """,
            (number, str(kind), url, title, message_id, thread_id, _now()),
        )

    def issue(self, number: int) -> TrackedIssue | None:
        row = self._connection.execute(
            "SELECT * FROM issues WHERE number = ?", (number,)
        ).fetchone()
        return _to_tracked_issue(row) if row else None

    def issues_awaiting_pr(self) -> list[TrackedIssue]:
        """Issue z wątkiem na Discordzie, do których nie widzieliśmy jeszcze PR-ki.

        Issue bez wątku są pomijane: nie ma dokąd wysłać linku, więc odpytywanie
        GitHuba o nie byłoby czystym kosztem.
        """

        rows = self._connection.execute(
            "SELECT * FROM issues WHERE pr_number IS NULL AND thread_id IS NOT NULL ORDER BY number"
        ).fetchall()
        return [_to_tracked_issue(row) for row in rows]

    def mark_pull_request(self, issue_number: int, pr_number: int, pr_url: str) -> None:
        self._connection.execute(
            "UPDATE issues SET pr_number = ?, pr_url = ?, pr_linked_at = ? WHERE number = ?",
            (pr_number, pr_url, _now(), issue_number),
        )

    def open_issue_numbers(self) -> list[int]:
        rows = self._connection.execute("SELECT number FROM issues ORDER BY number").fetchall()
        return [int(row["number"]) for row in rows]

    # ------------------------------------------------------------- dyskusje ---

    def record_discussion(self, discussion: Discussion) -> None:
        self._connection.execute(
            """
            INSERT INTO discussions
                (thread_id, message_id, title, source_text, reporter, source_file, created_at,
                 issue_number, open_questions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(thread_id) DO UPDATE SET
                title = excluded.title,
                source_text = excluded.source_text
            """,
            (
                discussion.thread_id,
                discussion.message_id,
                discussion.title,
                discussion.source_text,
                discussion.reporter,
                discussion.source_file,
                _now(),
                discussion.issue_number,
                json.dumps(list(discussion.open_questions), ensure_ascii=False),
            ),
        )

    def discussion(self, thread_id: str) -> Discussion | None:
        row = self._connection.execute(
            "SELECT * FROM discussions WHERE thread_id = ?", (thread_id,)
        ).fetchone()
        return _to_discussion(row) if row else None

    def open_discussions(self) -> list[Discussion]:
        """Wątki, w których dyskusja trwa — czyli takie bez issue."""

        rows = self._connection.execute(
            "SELECT * FROM discussions WHERE issue_number IS NULL ORDER BY created_at"
        ).fetchall()
        return [_to_discussion(row) for row in rows]

    def record_open_questions(self, thread_id: str, questions: list[str]) -> None:
        """Zapamiętuje pytania, którymi bot odesłał dyskusję do zespołu."""

        self._connection.execute(
            "UPDATE discussions SET open_questions = ? WHERE thread_id = ?",
            (json.dumps(questions, ensure_ascii=False), thread_id),
        )

    def link_discussion_issue(self, thread_id: str, issue_number: int) -> None:
        self._connection.execute(
            "UPDATE discussions SET issue_number = ? WHERE thread_id = ?",
            (issue_number, thread_id),
        )


def _to_tracked_issue(row: sqlite3.Row) -> TrackedIssue:
    return TrackedIssue(
        number=int(row["number"]),
        kind=Kind(row["kind"]),
        url=row["url"],
        title=row["title"],
        thread_id=row["thread_id"],
        pr_number=int(row["pr_number"]) if row["pr_number"] is not None else None,
    )


def _to_discussion(row: sqlite3.Row) -> Discussion:
    return Discussion(
        thread_id=row["thread_id"],
        message_id=row["message_id"],
        title=row["title"],
        source_text=row["source_text"],
        reporter=row["reporter"],
        source_file=row["source_file"],
        issue_number=int(row["issue_number"]) if row["issue_number"] is not None else None,
        open_questions=_to_questions(row["open_questions"]),
    )


def _to_questions(raw: str | None) -> tuple[str, ...]:
    """Kolumna bywa pusta: sprzed migracji albo sprzed pierwszej rundy pytań."""

    if not raw:
        return ()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return ()
    return tuple(str(item) for item in parsed) if isinstance(parsed, list) else ()
