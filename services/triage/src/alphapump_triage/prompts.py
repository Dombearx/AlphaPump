"""Prompty i renderowanie tekstów widocznych dla ludzi.

Wszystko po polsku, bo po polsku pisane są zgłoszenia, komentarze w repozytorium
i rozmowy na Discordzie. Treść issue czyta potem Claude Code w Akcji — stąd
nacisk w promptach na konkret (co, gdzie, kiedy), a nie na uprzejmą narrację.

Prompty żyją osobno od adaptera HTTP, żeby zmiana sformułowania nie wymagała
dotykania warstwy sieciowej i żeby dało się je obejrzeć w jednym miejscu.
"""

from __future__ import annotations

from .models import ChatMessage, ExistingIssue, Feedback, IssueRef, Kind, PullRequestRef

# Discord tnie wiadomości po 2000 znakach; zostawiamy zapas na ozdobniki
# doklejane przy składaniu treści.
DISCORD_LIMIT = 2000

_JSON_ONLY = "Odpowiedz wyłącznie obiektem JSON, bez komentarza przed ani po, bez bloku ```."

CLASSIFY_SYSTEM = f"""Jesteś asystentem, który segreguje zgłoszenia zwrotne z aplikacji
treningowej AlphaPump (aplikacja mobilna na Androida + backend + panel).

Zdecyduj, czy zgłoszenie opisuje:
- "bug" — coś działa niezgodnie z oczekiwaniem: błąd, awaria, zła liczba, brak
  reakcji interfejsu, dane, które zniknęły. Naprawa nie wymaga decyzji
  produktowej, tylko poprawienia kodu.
- "change_request" — prośba o nową funkcję, zmianę zachowania albo rozbudowę.
  Wymaga ustalenia zakresu, zanim ktokolwiek zacznie to pisać.

Zgłoszenia bez treści merytorycznej (pochwała, test, przypadkowy tekst)
klasyfikuj jako "change_request" z tytułem oddającym ich charakter — trafią wtedy
do dyskusji na Discordzie, gdzie da się je zamknąć bez zakładania issue.

{_JSON_ONLY}
Kształt: {{"kind": "bug" | "change_request", "title": "krótki tytuł po polsku,
maks. 80 znaków, bez kropki na końcu", "summary": "jedno zdanie streszczenia"}}"""

DUPLICATE_SYSTEM = f"""Sprawdzasz, czy nowe zgłoszenie z aplikacji AlphaPump dotyczy tej
samej sprawy, co jedno z już otwartych zgłoszeń.

Duplikat to ten sam problem lub ta sama prośba — nawet opisana innymi słowami,
przez inną osobę, na innym ekranie tej samej funkcji. Dwa różne błędy w tym samym
ekranie duplikatem NIE są. W razie wątpliwości odpowiadaj null: dwa issue da się
scalić jednym kliknięciem, a zgubione zgłoszenie nie wraca.

{_JSON_ONLY}
Kształt: {{"duplicate_of": <numer istniejącego zgłoszenia> | null,
"reason": "krótkie uzasadnienie po polsku"}}"""

BUG_ISSUE_SYSTEM = f"""Piszesz treść zgłoszenia błędu (GitHub issue) dla repozytorium
AlphaPump na podstawie zgłoszenia użytkownika aplikacji.

Issue czyta agent programistyczny, który ma je naprawić bez dostępu do
zgłaszającego. Pisz konkretnie i po polsku:
- opisz objaw słowami użytkownika, nie własną interpretacją,
- wypisz kroki odtworzenia, jeśli dają się wyprowadzić ze zgłoszenia,
- podaj oczekiwane i rzeczywiste zachowanie,
- jeśli w logach widać wyjątek albo nieudane żądanie, zacytuj tę linię,
- jeśli czegoś nie wiadomo, napisz wprost, że nie wiadomo — nie zmyślaj wersji,
  nazw ekranów ani ścieżek w kodzie, których nie ma w zgłoszeniu.

Treść w Markdownie, bez nagłówka pierwszego poziomu (tytuł jest osobnym polem).

{_JSON_ONLY}
Kształt: {{"title": "tytuł po polsku, maks. 80 znaków", "body": "treść w Markdownie"}}"""

FEATURE_ISSUE_SYSTEM = f"""Piszesz treść zgłoszenia zmiany (GitHub issue) dla repozytorium
AlphaPump na podstawie oryginalnej prośby użytkownika i całej dyskusji, jaka
odbyła się wokół niej na Discordzie.

Dyskusja jest ważniejsza niż pierwotna prośba: to w niej zespół ustalił zakres.
Jeśli ustalenia zmieniły albo zawęziły pierwotny pomysł, obowiązuje ustalenie
z dyskusji. Jeśli ktoś coś wprost odrzucił, wypisz to w sekcji „Poza zakresem".

Struktura treści (Markdown, bez nagłówka pierwszego poziomu):
- **Kontekst** — skąd wziął się pomysł,
- **Zakres** — co ma powstać, punktami,
- **Wymagania szczegółowe** — wszystko, co padło w dyskusji: zachowania
  brzegowe, nazewnictwo, wygląd, ograniczenia,
- **Poza zakresem** — co świadomie odrzucono (pomiń sekcję, jeśli nic nie padło),
- **Otwarte pytania** — jeśli dyskusja czegoś nie rozstrzygnęła.

Nie dopisuj wymagań, których nikt nie zgłosił.

{_JSON_ONLY}
Kształt: {{"title": "tytuł po polsku, maks. 80 znaków", "body": "treść w Markdownie"}}"""


def _format_logs(feedback: Feedback) -> str:
    if not feedback.logs:
        return "(telefon nie dołączył logów)"
    return "\n".join(
        f"[{entry.at}] {entry.level.upper()}: {entry.message}" for entry in feedback.logs
    )


def render_feedback(feedback: Feedback) -> str:
    """Zgłoszenie w postaci podawanej modelowi — jeden kształt dla wszystkich promptów."""

    return (
        f"Zgłaszający: {feedback.nickname}\n"
        f"Data: {feedback.sent_at.isoformat()}\n"
        f"Treść zgłoszenia:\n{feedback.message}\n\n"
        f"Ostatnie wpisy z logu aplikacji:\n{_format_logs(feedback)}"
    )


def classify_user_prompt(feedback: Feedback) -> str:
    return render_feedback(feedback)


def duplicate_user_prompt(feedback: Feedback, candidates: list[ExistingIssue]) -> str:
    """Kandydaci idą przycięci: liczy się temat, nie pełna treść issue.

    Pełne treści issue potrafią mieć po kilka tysięcy znaków każda, a decyzja
    „ten sam problem czy inny" zapada po tytule i pierwszym akapicie.
    """

    listing = "\n\n".join(
        f"#{candidate.number}: {candidate.title}\n{candidate.body.strip()[:600]}"
        for candidate in candidates
    )
    return f"NOWE ZGŁOSZENIE:\n{render_feedback(feedback)}\n\nJUŻ OTWARTE ZGŁOSZENIA:\n{listing}"


def duplicate_thread_prompt(feedback: Feedback, discussions: list[tuple[int, str, str]]) -> str:
    """Wersja dla wątków dyskusyjnych: zamiast numerów issue mamy numery porządkowe."""

    listing = "\n\n".join(
        f"#{index}: {title}\n{source[:600]}" for index, title, source in discussions
    )
    return (
        f"NOWE ZGŁOSZENIE:\n{render_feedback(feedback)}\n\n"
        f"TEMATY, KTÓRE JUŻ SĄ W DYSKUSJI:\n{listing}"
    )


def bug_issue_user_prompt(feedback: Feedback) -> str:
    return render_feedback(feedback)


def feature_issue_user_prompt(
    title: str,
    source_text: str,
    reporter: str,
    messages: list[ChatMessage],
) -> str:
    if messages:
        discussion = "\n".join(
            f"[{message.at.isoformat()}] {message.author}: {message.content}"
            for message in messages
            if message.content.strip()
        )
    else:
        discussion = "(w wątku nie padło nic poza zgłoszeniem)"
    return (
        f"TEMAT: {title}\n\n"
        f"ORYGINALNE ZGŁOSZENIE (od: {reporter}):\n{source_text}\n\n"
        f"DYSKUSJA W WĄTKU, chronologicznie:\n{discussion}"
    )


# ------------------------------------------------------- teksty dla ludzi ---


def feedback_footer(feedback: Feedback) -> str:
    """Stopka doklejana do treści issue — ślad po źródle, przydatny przy audycie."""

    logs = _format_logs(feedback)
    return (
        "\n\n---\n"
        f"_Zgłoszenie od **{feedback.nickname}** z {feedback.sent_at.isoformat()}, "
        f"plik `{feedback.file_name}`. Issue założone automatycznie przez segregację "
        "zgłoszeń zwrotnych._\n\n"
        "<details><summary>Oryginalna treść zgłoszenia</summary>\n\n"
        f"```\n{feedback.message}\n```\n\n</details>\n\n"
        "<details><summary>Log aplikacji z telefonu</summary>\n\n"
        f"```\n{logs}\n```\n\n</details>"
    )


def bug_announcement(issue: IssueRef, title: str, feedback: Feedback) -> str:
    return (
        f"🐛 **Nowy błąd z aplikacji** — [#{issue.number}]({issue.url})\n"
        f"**{title}**\n\n"
        f"> {_quote(feedback.message)}\n\n"
        f"_Zgłosił(a): {feedback.nickname} · {feedback.sent_at:%d.%m.%Y %H:%M}_\n"
        "Link do pull requesta wpadnie w wątek pod tą wiadomością."
    )


def change_request_announcement(title: str, feedback: Feedback, bot_mention: str) -> str:
    return (
        f"💡 **Prośba o zmianę** — do ustalenia\n"
        f"**{title}**\n\n"
        f"> {_quote(feedback.message)}\n\n"
        f"_Zgłosił(a): {feedback.nickname} · {feedback.sent_at:%d.%m.%Y %H:%M}_\n"
        f"Przedyskutujcie zakres w wątku. Gdy dojdziecie do porozumienia, "
        f"oznaczcie {bot_mention} w wątku — przeczytam całą rozmowę i założę issue."
    )


def duplicate_note(feedback: Feedback) -> str:
    return (
        f"Kolejne zgłoszenie tej samej sprawy, od **{feedback.nickname}** "
        f"({feedback.sent_at:%d.%m.%Y %H:%M}):\n\n"
        f"> {_quote(feedback.message)}"
    )


def duplicate_thread_note(feedback: Feedback) -> str:
    return (
        f"➕ Kolejne zgłoszenie w tym temacie, od **{feedback.nickname}** "
        f"({feedback.sent_at:%d.%m.%Y %H:%M}):\n\n"
        f"> {_quote(feedback.message)}"
    )


def issue_created_note(issue: IssueRef, title: str) -> str:
    return (
        f"✅ Założyłem issue na podstawie tej dyskusji: [#{issue.number}]({issue.url})\n"
        f"**{title}**\n\n"
        "Link do pull requesta wrzucę tutaj, gdy tylko powstanie."
    )


def issue_already_exists_note(number: int, url: str) -> str:
    return (
        f"Ta dyskusja ma już swoje issue: [#{number}]({url}). "
        "Jeśli ustalenia się zmieniły, dopiszcie je bezpośrednio w issue."
    )


def pull_request_note(pull_request: PullRequestRef, kind: Kind) -> str:
    czasownik = "naprawia" if kind is Kind.BUG else "realizuje"
    return (
        f"🔧 Powstał pull request, który {czasownik} to zgłoszenie: "
        f"[#{pull_request.number}]({pull_request.url})\n"
        f"**{pull_request.title}**"
    )


def _quote(text: str, limit: int = 900) -> str:
    """Tekst użytkownika w cytacie blokowym Discorda.

    Każda linia musi dostać własny `>` — inaczej cytat urywa się na pierwszym
    złamaniu wiersza i reszta zgłoszenia wygląda jak wypowiedź bota.
    """

    trimmed = text.strip()
    if len(trimmed) > limit:
        trimmed = trimmed[:limit].rstrip() + "…"
    return "\n> ".join(trimmed.splitlines())


def chunk(text: str, limit: int = DISCORD_LIMIT) -> list[str]:
    """Dzieli tekst na kawałki mieszczące się w limicie Discorda.

    Cięcie idzie po pustych liniach, a dopiero w ostateczności w połowie akapitu:
    treść issue jest Markdownem, a przecięcie w środku bloku kodu psuje
    formatowanie w obu połówkach.
    """

    if len(text) <= limit:
        return [text]

    chunks: list[str] = []
    current = ""
    for paragraph in text.split("\n\n"):
        candidate = f"{current}\n\n{paragraph}" if current else paragraph
        if len(candidate) <= limit:
            current = candidate
            continue
        if current:
            chunks.append(current)
        while len(paragraph) > limit:
            chunks.append(paragraph[:limit])
            paragraph = paragraph[limit:]
        current = paragraph
    if current:
        chunks.append(current)
    return chunks


def thread_name(title: str) -> str:
    """Nazwa wątku na Discordzie — twardy limit 100 znaków po stronie API."""

    cleaned = " ".join(title.split())
    return cleaned[:97] + "…" if len(cleaned) > 100 else cleaned
