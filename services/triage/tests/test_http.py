from __future__ import annotations

import asyncio

from aiohttp.test_utils import TestClient, TestServer

from alphapump_triage.http import create_http_app
from alphapump_triage.models import TriageReport


async def test_health_nie_wymaga_tokenu() -> None:
    app = create_http_app("sekret", lambda: _unreachable(), asyncio.Lock())
    async with TestClient(TestServer(app)) as client:
        response = await client.get("/health")
        assert response.status == 200


async def test_odmawia_bez_poprawnego_tokenu() -> None:
    calls: list[None] = []

    async def run_pass() -> TriageReport:
        calls.append(None)
        return TriageReport()

    app = create_http_app("sekret", run_pass, asyncio.Lock())
    async with TestClient(TestServer(app)) as client:
        bez_naglowka = await client.post("/run")
        assert bez_naglowka.status == 401

        zly_token = await client.post("/run", headers={"Authorization": "Bearer zly"})
        assert zly_token.status == 401

        assert calls == []


async def test_uruchamia_przeglad_i_zwraca_raport() -> None:
    async def run_pass() -> TriageReport:
        return TriageReport(scanned=3, bugs=1, change_requests=1, duplicates=1, failures=[])

    app = create_http_app("sekret", run_pass, asyncio.Lock())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/run", headers={"Authorization": "Bearer sekret"})
        assert response.status == 200
        body = await response.json()
        assert body == {
            "scanned": 3,
            "bugs": 1,
            "changeRequests": 1,
            "duplicates": 1,
            "failures": [],
        }


async def test_niesie_bledy_przetwarzania_w_raporcie() -> None:
    async def run_pass() -> TriageReport:
        report = TriageReport(scanned=1)
        report.failures.append(("zgloszenie.json", "błąd modelu"))
        return report

    app = create_http_app("sekret", run_pass, asyncio.Lock())
    async with TestClient(TestServer(app)) as client:
        response = await client.post("/run", headers={"Authorization": "Bearer sekret"})
        body = await response.json()
        assert body["failures"] == [{"file": "zgloszenie.json", "error": "błąd modelu"}]


async def test_odmawia_gdy_przeglad_juz_trwa() -> None:
    started = asyncio.Event()
    release = asyncio.Event()

    async def run_pass() -> TriageReport:
        started.set()
        await release.wait()
        return TriageReport(scanned=1)

    app = create_http_app("sekret", run_pass, asyncio.Lock())
    async with TestClient(TestServer(app)) as client:
        first = asyncio.ensure_future(
            client.post("/run", headers={"Authorization": "Bearer sekret"})
        )
        await started.wait()

        second = await client.post("/run", headers={"Authorization": "Bearer sekret"})
        assert second.status == 409

        release.set()
        first_response = await first
        assert first_response.status == 200


async def _unreachable() -> TriageReport:
    raise AssertionError("/health nie powinno wołać przeglądu")
