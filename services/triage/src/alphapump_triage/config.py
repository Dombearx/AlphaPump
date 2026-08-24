"""Konfiguracja usługi ze zmiennych środowiskowych.

Ta sama zasada, co w `apps/api/src/config.ts`: brakujący sekret ma zatrzymać
start, a nie objawić się w środku nocy jako wątek na Discordzie bez issue.
Wszystko, co ma sensowną wartość domyślną, ją dostaje; wszystko, czego zgadnąć
się nie da (tokeny, identyfikator kanału), jest wymagane.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError


class ConfigError(RuntimeError):
    """Konfiguracja nie pozwala wystartować."""


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise ConfigError(f"brak wymaganej zmiennej środowiskowej {name}")
    return value


def _optional(name: str, default: str) -> str:
    value = os.environ.get(name, "").strip()
    return value or default


def _flag(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if not raw:
        return default
    return raw in {"1", "true", "yes", "tak"}


def _positive_int(name: str, default: int) -> int:
    raw = _optional(name, str(default))
    try:
        value = int(raw)
    except ValueError as error:
        raise ConfigError(f"{name} musi być liczbą całkowitą, jest: {raw!r}") from error
    if value <= 0:
        raise ConfigError(f"{name} musi być dodatnie, jest: {value}")
    return value


@dataclass(frozen=True)
class Config:
    feedback_dir: str
    state_db: str

    feedback_poll_seconds: int
    retry_after_seconds: int
    timezone: ZoneInfo

    openrouter_api_key: str
    openrouter_base_url: str
    classifier_model: str
    writer_model: str
    llm_timeout_seconds: float

    github_token: str
    github_repo: str
    github_api_url: str
    label_trigger: str
    label_bug: str
    label_feature: str

    discord_token: str
    discord_channel_id: int

    pr_poll_seconds: int
    max_attempts: int
    dry_run: bool

    http_port: int
    http_token: str

    @property
    def github_owner(self) -> str:
        return self.github_repo.split("/", 1)[0]

    @property
    def github_name(self) -> str:
        return self.github_repo.split("/", 1)[1]


def load_config() -> Config:
    """Czyta środowisko i zwraca komplet ustawień albo rzuca `ConfigError`."""

    repo = _optional("TRIAGE_GITHUB_REPO", "Dombearx/AlphaPump")
    if repo.count("/") != 1 or not all(repo.split("/")):
        raise ConfigError(f"TRIAGE_GITHUB_REPO ma format właściciel/repozytorium, jest: {repo!r}")

    timezone_name = _optional("TRIAGE_TIMEZONE", "Europe/Warsaw")
    try:
        timezone = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as error:
        raise ConfigError(f"nieznana strefa czasowa TRIAGE_TIMEZONE={timezone_name!r}") from error

    channel_raw = _required("DISCORD_CHANNEL_ID")
    try:
        channel_id = int(channel_raw)
    except ValueError as error:
        raise ConfigError(f"DISCORD_CHANNEL_ID musi być liczbą, jest: {channel_raw!r}") from error

    return Config(
        feedback_dir=_optional("TRIAGE_FEEDBACK_DIR", "/data/feedback"),
        state_db=_optional("TRIAGE_STATE_DB", "/data/state/triage.sqlite3"),
        # Zgłoszenie ma zostać przeczytane wtedy, kiedy przyszło, a nie o umówionej
        # godzinie następnej doby. Odpytywanie katalogu jest tanie (`glob` po
        # lokalnym katalogu plus jedno zapytanie do SQLite'a), a model językowy
        # rusza dopiero wtedy, gdy naprawdę pojawił się nowy plik — więc częsty
        # przebieg nie kosztuje ani zapytań do OpenRoutera, ani do GitHuba.
        feedback_poll_seconds=_positive_int("TRIAGE_FEEDBACK_POLL_SECONDS", 15),
        # Karencja po nieudanym podejściu. Przy przebiegu co kilkanaście sekund
        # `TRIAGE_MAX_ATTEMPTS` wyczerpałoby się w niecałą minutę i chwilowa
        # awaria OpenRoutera odkładałaby zgłoszenie na bok na zawsze. Kwadrans
        # rozkłada trzy podejścia na pół godziny — tyle, ile trwa przeciętna
        # niedostępność usługi zewnętrznej.
        retry_after_seconds=_positive_int("TRIAGE_RETRY_AFTER_SECONDS", 900),
        timezone=timezone,
        openrouter_api_key=_required("OPENROUTER_API_KEY"),
        openrouter_base_url=_optional("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1"),
        # Klasyfikacja to decyzja binarna na krótkim tekście — idzie na tańszy,
        # szybki model. Pisanie treści issue czyta potem Claude Code w Akcji,
        # więc jakość opisu przekłada się wprost na jakość poprawki i tam
        # domyślnie stoi mocniejszy model.
        classifier_model=_optional("TRIAGE_CLASSIFIER_MODEL", "openai/gpt-5.6-terra"),
        writer_model=_optional("TRIAGE_WRITER_MODEL", "anthropic/claude-sonnet-5"),
        llm_timeout_seconds=float(_positive_int("TRIAGE_LLM_TIMEOUT_SECONDS", 120)),
        github_token=_required("TRIAGE_GITHUB_TOKEN"),
        github_repo=repo,
        github_api_url=_optional("TRIAGE_GITHUB_API_URL", "https://api.github.com"),
        label_trigger=_optional("TRIAGE_LABEL_TRIGGER", "ai-triage"),
        label_bug=_optional("TRIAGE_LABEL_BUG", "bug"),
        label_feature=_optional("TRIAGE_LABEL_FEATURE", "enhancement"),
        discord_token=_required("DISCORD_BOT_TOKEN"),
        discord_channel_id=channel_id,
        pr_poll_seconds=_positive_int("TRIAGE_PR_POLL_SECONDS", 120),
        # Po tylu nieudanych podejściach zgłoszenie zostaje odłożone na bok.
        # Bez tego licznika jeden plik nie do przetworzenia wracałby w każdym
        # przebiegu i w każdym kosztował te same zapytania do LLM-a.
        max_attempts=_positive_int("TRIAGE_MAX_ATTEMPTS", 3),
        dry_run=_flag("TRIAGE_DRY_RUN"),
        # Port jest wewnętrzny do sieci Compose (usługa nie ma `ports:`), więc
        # ma sensowną wartość domyślną. Token nie ma — to jedyne, co chroni
        # ręczne wyzwolenie przeglądu przed każdym, kto trafi w ten port.
        http_port=_positive_int("TRIAGE_HTTP_PORT", 8090),
        http_token=_required("TRIAGE_HTTP_TOKEN"),
    )
