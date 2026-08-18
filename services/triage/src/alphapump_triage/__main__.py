"""Punkt wejścia usługi.

Jeden proces, trzy role: klient Discorda utrzymuje połączenie, planista odpala
przegląd zgłoszeń o umówionej godzinie, a pętla odpytywania szuka pull requestów.
Wszystkie trzy dzielą tę samą pętlę zdarzeń i ten sam plik stanu — rozbicie ich
na osobne kontenery oznaczałoby dwa procesy piszące do jednego SQLite'a i drugi
komplet sekretów, bez niczego w zamian.

Uruchomienie:

    python -m alphapump_triage            # usługa: bot + planista + odpytywanie
    python -m alphapump_triage once       # jeden przegląd zgłoszeń i wyjście
"""

from __future__ import annotations

import asyncio
import logging
import os
import sys

import discord
from aiohttp import web
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
from apscheduler.triggers.interval import IntervalTrigger

from .config import Config, ConfigError, load_config
from .discord_bot import DiscordChat, TriageBot
from .dryrun import DryRunChat, DryRunIssueTracker
from .feedback import FeedbackReader
from .github import GitHubIssues
from .http import create_http_app
from .openrouter import OpenRouterLlm
from .service import TriageService
from .state import State

logger = logging.getLogger("alphapump_triage")


def _configure_logging() -> None:
    logging.basicConfig(
        level=os.environ.get("TRIAGE_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    )
    # Discord loguje na INFO każde odświeżenie sesji podtrzymującej połączenie;
    # w logu usługi zostawiamy z tego tylko ostrzeżenia.
    logging.getLogger("discord").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def _run(config: Config, once: bool) -> None:
    # W trybie próbnym stan idzie do pamięci: przebieg ma pokazać, co by się
    # stało, a nie zapisać, że już się stało.
    state = State(":memory:" if config.dry_run else config.state_db)
    reader = FeedbackReader(config.feedback_dir)
    llm = OpenRouterLlm(
        api_key=config.openrouter_api_key,
        base_url=config.openrouter_base_url,
        timeout=config.llm_timeout_seconds,
    )
    github = GitHubIssues(
        token=config.github_token,
        repo=config.github_repo,
        api_url=config.github_api_url,
    )
    tracker = DryRunIssueTracker(github) if config.dry_run else github
    scheduler = AsyncIOScheduler(timezone=config.timezone)

    # Dzielona między planistę i serwer HTTP: przegląd o umówionej godzinie
    # i przegląd wywołany ręcznie z panelu administracyjnego nie mogą ruszyć
    # się naraz — obydwa czytają i oznaczają te same zgłoszenia.
    run_lock = asyncio.Lock()

    async def run_daily_scheduled() -> None:
        async with run_lock:
            await service.run_daily()

    async def handle_mention(thread_id: str) -> None:
        await service.handle_mention(thread_id)

    async def on_ready() -> None:
        if once:
            report = await service.run_daily()
            logger.info("przegląd na żądanie zakończony: %s", report)
            await bot.close()
            return

        scheduler.add_job(
            _guarded(run_daily_scheduled, "przegląd dzienny"),
            CronTrigger(
                hour=config.daily_hour, minute=config.daily_minute, timezone=config.timezone
            ),
            id="daily",
            # Restart kontenera tuż po zaplanowanej godzinie nie może zjeść
            # przebiegu; godzina tolerancji jest w sam raz na aktualizację stosu.
            misfire_grace_time=3600,
            coalesce=True,
            max_instances=1,
        )
        scheduler.add_job(
            _guarded(service.poll_pull_requests, "odpytywanie o pull requesty"),
            IntervalTrigger(seconds=config.pr_poll_seconds),
            id="pull-requests",
            coalesce=True,
            max_instances=1,
        )
        # Ten sam odstęp co przy PR-kach i ten sam zbiór issue — obie pętle
        # pytają GitHuba o to samo zgłoszenie, tylko o inną jego stronę.
        scheduler.add_job(
            _guarded(service.poll_issue_comments, "odpytywanie o komentarze"),
            IntervalTrigger(seconds=config.pr_poll_seconds),
            id="issue-comments",
            coalesce=True,
            max_instances=1,
        )
        scheduler.start()
        logger.info(
            "planista wystartował: przegląd o %02d:%02d (%s), pull requesty co %ds",
            config.daily_hour,
            config.daily_minute,
            config.timezone.key,
            config.pr_poll_seconds,
        )

    bot = TriageBot(on_mention=handle_mention, on_ready=on_ready)
    discord_chat = DiscordChat(bot, config.discord_channel_id)
    chat = DryRunChat(discord_chat) if config.dry_run else discord_chat
    service = TriageService(
        config=config, state=state, reader=reader, llm=llm, tracker=tracker, chat=chat
    )

    if config.dry_run:
        logger.warning("TRYB PRÓBNY: nic nie zostanie zapisane ani wysłane")

    # Tryb `once` jest jednorazowym przebiegiem z CLI, bez publiczności dla
    # panelu administracyjnego — serwer HTTP nie ma tam czego robić.
    http_runner: web.AppRunner | None = None
    if not once:
        http_app = create_http_app(config.http_token, service.run_daily, run_lock)
        http_runner = web.AppRunner(http_app)
        await http_runner.setup()
        await web.TCPSite(http_runner, "0.0.0.0", config.http_port).start()
        logger.info(
            "serwer HTTP nasłuchuje na porcie %d (ręczne wyzwolenie przeglądu)", config.http_port
        )

    try:
        await bot.start(config.discord_token)
    finally:
        if scheduler.running:
            scheduler.shutdown(wait=False)
        if http_runner is not None:
            await http_runner.cleanup()
        # `close()` również wtedy, gdy `start()` poległo na logowaniu: klient
        # zdążył już otworzyć własną sesję HTTP, a niedomknięta wypisuje przy
        # wyjściu ostrzeżenie, które wygląda jak awaria, a nią nie jest.
        await bot.close()
        await llm.aclose()
        await github.aclose()
        state.close()


def _guarded(job, name: str):
    """Opakowuje zadanie planisty tak, żeby wyjątek nie ubił harmonogramu.

    APScheduler przy nieobsłużonym wyjątku zostawia zadanie w harmonogramie, ale
    cisza w logu wyglądałaby jak „przebieg się nie odbył". Wolimy ślad.
    """

    async def run() -> None:
        logger.info("start: %s", name)
        try:
            await job()
        except Exception:  # noqa: BLE001
            logger.exception("zadanie %r zakończone błędem", name)

    return run


def main() -> int:
    _configure_logging()
    once = len(sys.argv) > 1 and sys.argv[1] == "once"
    try:
        config = load_config()
    except ConfigError as error:
        logger.error("konfiguracja: %s", error)
        return 2

    try:
        asyncio.run(_run(config, once=once))
    except KeyboardInterrupt:
        logger.info("zatrzymane")
    except discord.LoginFailure:
        # Najczęstszy błąd wdrożeniowy zaraz po literówce w kluczu: token
        # przeklejony z pola „Application ID" albo unieważniony przez reset.
        logger.error(
            "Discord odrzucił token z DISCORD_BOT_TOKEN. Wygeneruj nowy: "
            "https://discord.com/developers/applications → twoja aplikacja → Bot → Reset Token"
        )
        return 2
    except discord.PrivilegedIntentsRequired:
        logger.error(
            "Bot nie ma włączonej intencji MESSAGE CONTENT, a bez niej treść wiadomości "
            "w wątkach przychodzi pusta. Włącz ją: https://discord.com/developers/applications "
            "→ twoja aplikacja → Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT"
        )
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
