"""Serwer HTTP: ręczne wyzwolenie przebiegu segregacji z panelu administracyjnego.

Usługa poza tym nie wystawia żadnego portu na zewnątrz (patrz komentarz przy
serwisie `triage` w `deploy/docker-compose.yml`) — ten jest wyjątkiem, bo panel
administracyjny musi mieć jak poprosić o przebieg wtedy, kiedy sam chce, a nie
czekać na kolejny obieg odpytywania. Token w `TRIAGE_HTTP_TOKEN` jest drugą
warstwą obrony, nie jedyną: pierwszą jest to, że port stoi wyłącznie w sieci
Compose.

Przebieg wywołany stąd robi to samo co ten z planisty — sprawdza nowe zgłoszenia,
klasyfikuje je i albo zakłada issue, albo otwiera dyskusję na Discordzie (patrz
`service.run_pass`) — z jedną różnicą: nie obowiązuje go karencja po nieudanych
podejściach, bo po tej stronie portu stoi człowiek przy przycisku. Odkąd planista
chodzi co kilkanaście sekund, to jest już główny powód, dla którego ten przycisk
istnieje; drugim jest podsumowanie przebiegu w liczbach.
"""

from __future__ import annotations

import asyncio
import logging
import secrets
from collections.abc import Awaitable, Callable

from aiohttp import web

from .models import TriageReport

logger = logging.getLogger(__name__)

RunPass = Callable[[], Awaitable[TriageReport]]


def _report_to_json(report: TriageReport) -> dict:
    return {
        "scanned": report.scanned,
        "bugs": report.bugs,
        "changeRequests": report.change_requests,
        "duplicates": report.duplicates,
        "failures": [{"file": name, "error": error} for name, error in report.failures],
    }


def create_http_app(token: str, run_pass: RunPass, lock: asyncio.Lock) -> web.Application:
    """Składa aplikację aiohttp. `lock` jest dzielony z planistą — patrz `__main__`,
    żeby ręczne wyzwolenie i przebieg z odpytywania nie ruszyły się naraz."""

    app = web.Application()

    async def health(_request: web.Request) -> web.Response:
        return web.json_response({"status": "ok"})

    async def run(request: web.Request) -> web.Response:
        presented = request.headers.get("Authorization", "")
        # `compare_digest`, nie `!=` — tak samo jak w `deploy/update_server.py`.
        # Różnica jest tu teoretyczna (port stoi wyłącznie w sieci Compose), ale
        # sprawdzenie tokenu napisane wprost jest tym, co ktoś kiedyś skopiuje
        # w miejsce, w którym teoretyczna przestaje być.
        if not secrets.compare_digest(presented, f"Bearer {token}"):
            return web.json_response({"error": "brak albo zły token"}, status=401)

        # Sprawdzenie przed wejściem do `async with` jest świadomie nieszczelne
        # (ktoś mógłby trafić w okno między sprawdzeniem a przejęciem blokady)
        # — ale przy panelu administracyjnym obsługiwanym przez jedną osobę to
        # ryzyko czysto teoretyczne, a alternatywa (kolejkowanie żądań) kazałaby
        # przeglądarce czekać, aż zwolni się poprzedni przebieg, bez informacji,
        # że to robi.
        if lock.locked():
            return web.json_response(
                {"error": "przegląd już trwa — spróbuj ponownie za chwilę"}, status=409
            )

        logger.info("przegląd wywołany ręcznie przez panel administracyjny")
        async with lock:
            report = await run_pass()

        return web.json_response(_report_to_json(report))

    app.router.add_get("/health", health)
    app.router.add_post("/run", run)
    return app
