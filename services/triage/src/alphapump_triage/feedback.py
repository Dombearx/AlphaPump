"""Czytanie zgłoszeń zwrotnych z katalogu na minipc.

Źródłem prawdy jest `apps/api/src/routes/feedback.ts`: jeden plik JSON na
zgłoszenie, nazwa zaczyna się znacznikiem czasu ISO z podmienionymi dwukropkami.
Usługa montuje ten katalog **tylko do odczytu** — kasowanie przetworzonych plików
byłoby nieodwracalne, a stan „co już przejrzane" i tak trzyma własna baza.
"""

from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from pathlib import Path

from .models import Feedback, LogEntry

logger = logging.getLogger(__name__)


class MalformedFeedback(ValueError):
    """Plik jest w katalogu zgłoszeń, ale nie da się go odczytać jako zgłoszenia."""


def _parse_timestamp(raw: str) -> datetime:
    """`sentAt` zapisuje `Date.toISOString()`, czyli zawsze UTC z sufiksem `Z`."""

    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError as error:
        raise MalformedFeedback(f"nieczytelna data zgłoszenia: {raw!r}") from error
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def parse_feedback(file_name: str, payload: object) -> Feedback:
    """Zamienia odczytany JSON w `Feedback`, pilnując wymaganych pól."""

    if not isinstance(payload, dict):
        raise MalformedFeedback("zgłoszenie nie jest obiektem JSON")

    message = payload.get("message")
    if not isinstance(message, str) or not message.strip():
        raise MalformedFeedback("zgłoszenie bez treści")

    raw_logs = payload.get("logs") or []
    logs: list[LogEntry] = []
    if isinstance(raw_logs, list):
        for entry in raw_logs:
            if not isinstance(entry, dict):
                continue
            logs.append(
                LogEntry(
                    level=str(entry.get("level", "log")),
                    message=str(entry.get("message", "")),
                    at=str(entry.get("at", "")),
                )
            )

    sent_at_raw = payload.get("sentAt")
    if not isinstance(sent_at_raw, str):
        raise MalformedFeedback("zgłoszenie bez daty wysłania")

    return Feedback(
        file_name=file_name,
        nickname=str(payload.get("nickname") or "nieznany"),
        email=str(payload.get("email") or ""),
        sent_at=_parse_timestamp(sent_at_raw),
        message=message.strip(),
        logs=tuple(logs),
    )


class FeedbackReader:
    """Dostęp do katalogu ze zgłoszeniami."""

    def __init__(self, directory: str | Path) -> None:
        self._directory = Path(directory)

    def file_names(self) -> list[str]:
        """Nazwy plików zgłoszeń, posortowane — czyli chronologicznie.

        Sortowanie po nazwie wystarcza za sortowanie po dacie, bo nazwa zaczyna
        się znacznikiem czasu ISO o stałej szerokości. Nieistniejący katalog nie
        jest błędem: tak wygląda stos, do którego nikt jeszcze nic nie zgłosił.
        """

        if not self._directory.is_dir():
            logger.warning("katalog zgłoszeń %s nie istnieje", self._directory)
            return []
        return sorted(path.name for path in self._directory.glob("*.json") if path.is_file())

    def read(self, file_name: str) -> Feedback:
        """Wczytuje jedno zgłoszenie po nazwie pliku."""

        path = self._directory / file_name
        try:
            raw = path.read_text(encoding="utf-8")
        except OSError as error:
            raise MalformedFeedback(f"nie da się odczytać {file_name}: {error}") from error
        try:
            payload = json.loads(raw)
        except json.JSONDecodeError as error:
            raise MalformedFeedback(f"{file_name} nie jest poprawnym JSON-em: {error}") from error
        return parse_feedback(file_name, payload)
