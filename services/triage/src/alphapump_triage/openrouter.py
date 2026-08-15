"""Adapter OpenRoutera — jedyne miejsce, w którym usługa rozmawia z modelem.

Ten sam dostawca, którego używa już backend (`apps/api/src/llm/`), więc na
minipc jest jeden klucz i jeden rachunek. Interfejs jest zgodny z OpenAI, ale
korzystamy z niego wprost przez HTTP: całe zapotrzebowanie to jedno wywołanie
czatu, a biblioteka kliencka dokładałaby zależność cięższą niż ten plik.
"""

from __future__ import annotations

import asyncio
import json
import logging
import re

import httpx

logger = logging.getLogger(__name__)

# Modele potrafią opakować JSON w blok ```json mimo wyraźnej prośby w prompcie.
_FENCE = re.compile(r"^\s*```(?:json)?\s*|\s*```\s*$", re.IGNORECASE)


class LlmError(RuntimeError):
    """Model nie odpowiedział albo odpowiedział czymś, co nie jest JSON-em."""


class OpenRouterLlm:
    def __init__(
        self,
        api_key: str,
        base_url: str = "https://openrouter.ai/api/v1",
        timeout: float = 120.0,
        attempts: int = 3,
    ) -> None:
        self._attempts = attempts
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            timeout=timeout,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                # OpenRouter pokazuje te dwie wartości w statystykach konta —
                # dzięki nim ruch segregacji zgłoszeń da się odróżnić od ruchu
                # aplikacji, gdy przyjdzie sprawdzić, co właściwie kosztuje.
                # Tytuł bez znaków spoza ASCII: nagłówki HTTP są kodowane
                # ASCII i polska nazwa wywaliłaby klienta już przy starcie.
                "HTTP-Referer": "https://github.com/Dombearx/AlphaPump",
                "X-Title": "AlphaPump triage",
            },
        )

    async def aclose(self) -> None:
        await self._client.aclose()

    async def complete_json(self, model: str, system: str, user: str) -> dict:
        """Jedno pytanie, jedna odpowiedź w postaci słownika.

        `response_format` prosi o obiekt JSON, ale nie każdy model na
        OpenRouterze go respektuje — dlatego odpowiedź i tak przechodzi przez
        zdejmowanie bloku ```` ``` ````. Nieudane parsowanie jest traktowane jak
        błąd sieciowy i ponawiane: to zwykle jednorazowe potknięcie modelu.
        """

        payload = {
            "model": model,
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            "response_format": {"type": "json_object"},
            # Zadania są klasyfikacyjno-redakcyjne, nie twórcze: przy wyższej
            # temperaturze ten sam feedback raz jest błędem, raz prośbą o zmianę.
            "temperature": 0.2,
        }

        last_error: Exception | None = None
        for attempt in range(1, self._attempts + 1):
            try:
                response = await self._client.post("/chat/completions", json=payload)
                response.raise_for_status()
                return _extract_json(response.json())
            except (httpx.HTTPError, LlmError, json.JSONDecodeError, KeyError) as error:
                last_error = error
                if attempt == self._attempts:
                    break
                # Wykładniczo, bo najczęstsza przyczyna to limit zapytań po
                # stronie dostawcy, a ten mija z czasem, nie po ponowieniu.
                delay = 2**attempt
                logger.warning(
                    "zapytanie do %s nieudane (%s), ponawiam za %ds", model, error, delay
                )
                await asyncio.sleep(delay)

        raise LlmError(f"model {model} nie odpowiedział poprawnie: {last_error!r}")


def _extract_json(body: dict) -> dict:
    choices = body.get("choices") or []
    if not choices:
        raise LlmError(f"odpowiedź bez treści: {body}")
    content = choices[0].get("message", {}).get("content")
    if not isinstance(content, str) or not content.strip():
        raise LlmError("model zwrócił pustą treść")

    cleaned = _FENCE.sub("", content.strip())
    parsed = json.loads(cleaned)
    if not isinstance(parsed, dict):
        raise LlmError(f"model zwrócił {type(parsed).__name__}, oczekiwano obiektu")
    return parsed
