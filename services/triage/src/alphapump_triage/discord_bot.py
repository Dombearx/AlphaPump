"""Bot Discorda: ogłoszenia, wątki i nasłuch oznaczeń.

Dwie rzeczy w jednym pliku, bo są dwiema stronami tego samego połączenia:

* `DiscordChat` — implementacja portu `Chat`, czyli „jak usługa pisze na Discorda",
* `TriageBot` — klient, który utrzymuje to połączenie i woła usługę, gdy ktoś
  oznaczy bota w wątku.

Bot **musi** mieć włączoną intencję „Message Content" w panelu dewelopera
Discorda. Bez niej `message.content` przychodzi puste i domknięcie dyskusji
skończyłoby się issue napisanym na podstawie samych pustych wiadomości — awaria
cicha, więc sprawdzamy ją przy starcie i mówimy o niej wprost w logu.
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

import discord

from . import prompts
from .models import ChatMessage

logger = logging.getLogger(__name__)

# Tydzień — maksimum, jakie Discord przyjmuje. Dyskusja o zakresie zmiany
# potrafi się ciągnąć kilka dni, a zarchiwizowany wątek trzeba odmrażać przed
# każdą odpowiedzią.
THREAD_ARCHIVE_MINUTES = 10080


class DiscordChat:
    """Port `Chat` oparty o jeden kanał tekstowy."""

    def __init__(self, client: discord.Client, channel_id: int) -> None:
        self._client = client
        self._channel_id = channel_id

    def mention(self) -> str:
        user = self._client.user
        return f"<@{user.id}>" if user else "@bota"

    async def _channel(self) -> discord.TextChannel:
        channel = self._client.get_channel(self._channel_id)
        if channel is None:
            # Pamięć podręczna klienta bywa pusta zaraz po starcie i po
            # przerwie w połączeniu — wtedy trzeba dopytać API.
            channel = await self._client.fetch_channel(self._channel_id)
        if not isinstance(channel, discord.TextChannel):
            raise RuntimeError(
                f"kanał {self._channel_id} nie jest kanałem tekstowym "
                f"({type(channel).__name__}) — wątki wymagają kanału tekstowego"
            )
        return channel

    async def _thread(self, thread_id: str) -> discord.Thread:
        thread = self._client.get_channel(int(thread_id))
        if thread is None:
            thread = await self._client.fetch_channel(int(thread_id))
        if not isinstance(thread, discord.Thread):
            raise RuntimeError(f"{thread_id} nie jest wątkiem")
        if thread.archived:
            # Wątek zarchiwizowany sam po tygodniu ciszy: link do PR-ki ma
            # prawo przyjść później niż ostatnia wypowiedź.
            await thread.edit(archived=False)
        return thread

    async def post(self, text: str) -> str:
        channel = await self._channel()
        first: discord.Message | None = None
        for part in prompts.chunk(text):
            message = await channel.send(part)
            first = first or message
        assert first is not None  # `chunk` nigdy nie zwraca pustej listy
        return str(first.id)

    async def open_thread(self, message_id: str, name: str) -> str:
        channel = await self._channel()
        message = await channel.fetch_message(int(message_id))
        thread = await message.create_thread(
            name=name, auto_archive_duration=THREAD_ARCHIVE_MINUTES
        )
        return str(thread.id)

    async def post_in_thread(self, thread_id: str, text: str) -> None:
        thread = await self._thread(thread_id)
        for part in prompts.chunk(text):
            await thread.send(part)

    async def thread_messages(self, thread_id: str) -> list[ChatMessage]:
        """Cała rozmowa, od najstarszej wiadomości.

        Wiadomość otwierająca wątek należy do kanału nadrzędnego, nie do wątku,
        więc jej tu nie ma — i dobrze: jej treść usługa ma zapisaną w stanie
        jako `source_text`, w postaci sprzed formatowania na Discorda.
        """

        thread = await self._thread(thread_id)
        messages: list[ChatMessage] = []
        async for message in thread.history(limit=None, oldest_first=True):
            messages.append(
                ChatMessage(
                    author=message.author.display_name,
                    content=message.content or "",
                    at=message.created_at,
                    is_bot=message.author.bot,
                )
            )
        return messages


MentionHandler = Callable[[str], Awaitable[None]]


class TriageBot(discord.Client):
    """Klient Discorda, który reaguje wyłącznie na oznaczenie w wątku."""

    def __init__(self, on_mention: MentionHandler, on_ready: Callable[[], Awaitable[None]]) -> None:
        intents = discord.Intents.default()
        # Bez tej intencji treść wiadomości przychodzi pusta — a cała wartość
        # domknięcia dyskusji siedzi właśnie w treści.
        intents.message_content = True
        super().__init__(intents=intents)
        self._on_mention = on_mention
        self._on_ready = on_ready
        self._started = False

    async def on_ready(self) -> None:
        logger.info("zalogowany jako %s", self.user)
        # `on_ready` potrafi przyjść ponownie po zerwaniu połączenia; planista
        # i pętla odpytywania mają wystartować dokładnie raz.
        if not self._started:
            self._started = True
            await self._on_ready()

    async def on_message(self, message: discord.Message) -> None:
        if self.user is None or message.author.id == self.user.id:
            return
        if message.author.bot:
            return
        if not isinstance(message.channel, discord.Thread):
            return
        # Świadomie tylko bezpośrednie oznaczenie użytkownika bota: `@everyone`
        # i oznaczenie roli nie mają uruchamiać zakładania issue.
        if not any(user.id == self.user.id for user in message.mentions):
            return

        thread_id = str(message.channel.id)
        logger.info("oznaczenie w wątku %s od %s", thread_id, message.author.display_name)
        try:
            await message.add_reaction("👀")
        except discord.HTTPException:
            # Reakcja to uprzejmość, nie część działania — brak uprawnienia do
            # jej dodania nie może zablokować zakładania issue.
            logger.debug("nie udało się dodać reakcji w wątku %s", thread_id)

        try:
            await self._on_mention(thread_id)
        except Exception:  # noqa: BLE001 — wyjątek nie może wywrócić pętli klienta
            logger.exception("nie udało się obsłużyć oznaczenia w wątku %s", thread_id)
            try:
                await message.channel.send(
                    "⚠️ Nie udało mi się założyć issue z tej dyskusji. "
                    "Szczegóły są w logu usługi na minipc — spróbujcie oznaczyć mnie ponownie."
                )
            except discord.HTTPException:
                logger.exception("nie udało się nawet zgłosić błędu w wątku %s", thread_id)
