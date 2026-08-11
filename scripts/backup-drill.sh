#!/usr/bin/env bash
#
# Próba odtworzenia kopii zapasowej — pełny łańcuch, na dwóch bazach.
#
# Kopia, której nigdy nie odtworzono, nie jest kopią. Ten skrypt przechodzi
# **dokładnie tę samą** drogę, którą chodzi cron i człowiek w sytuacji awaryjnej:
#
#   eksport → gzip → age → (age -d) → gunzip → import → eksport → porównanie
#
# Ostatni krok jest tu najważniejszy: nie sprawdzamy, czy import „się wykonał",
# ale czy dane po odtworzeniu **zgadzają się z oryginałem** — łącznie
# z powiązaniami autorów ćwiczeń i właścicieli serii. Porównanie idzie po postaci
# kanonicznej z `@alphapump/core`, więc pomija to, co po odtworzeniu musi się
# różnić: moment eksportu i kolejność wierszy.
#
# Wymagane w środowisku:
#   DATABASE_URL          baza źródłowa (zostanie wypełniona danymi próby)
#   RESTORE_DATABASE_URL  baza docelowa (czysta; tu wchodzi odtworzenie)
# Opcjonalne:
#   AGE_IDENTITY          plik z kluczem prywatnym age. Bez niego skrypt generuje
#                         parę jednorazową — łańcuch jest wtedy sprawdzany
#                         w całości, bez potrzeby wystawiania automatyce
#                         jakiegokolwiek trwałego klucza.
#
# Dane próby są **fikcyjne**. Prawdziwy eksport nigdy nie trafia do CI: zawiera
# adresy e-mail i pełną historię treningową całej grupy.

set -euo pipefail

: "${DATABASE_URL:?Ustaw DATABASE_URL — bazę źródłową próby}"
: "${RESTORE_DATABASE_URL:?Ustaw RESTORE_DATABASE_URL — czystą bazę docelową}"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Dwie flagi, obie konieczne:
#
# - `run`, bo `pnpm import` jest **wbudowanym** poleceniem pnpm (konwersja plików
#   lock) i bez `run` uruchomiłoby się coś zupełnie innego,
# - `--silent`, bo pnpm wypisuje nagłówek uruchamianego skryptu na **stdout**,
#   a tym samym strumieniem jedzie archiwum. Bez tego pierwszy bajt kopii jest
#   nagłówkiem pnpm i plik przestaje być JSON-em.
api="pnpm --silent --filter @alphapump/api run"

if [ -n "${AGE_IDENTITY:-}" ]; then
  identity="$AGE_IDENTITY"
  recipient="$(age-keygen -y "$identity")"
  echo "Używam klucza z ${identity}" >&2
else
  identity="${workdir}/klucz-proby.txt"
  age-keygen -o "$identity" 2>/dev/null
  recipient="$(age-keygen -y "$identity")"
  echo "Wygenerowałem parę kluczy jednorazową na czas próby" >&2
fi

echo "1/5 Wypełniam bazę źródłową danymi próby…" >&2
$api drill sample

echo "2/5 Kopia: eksport → gzip → age…" >&2
$api export | gzip | age -r "$recipient" > "${workdir}/kopia.json.gz.age"
$api export > "${workdir}/przed.json"

echo "3/5 Odtworzenie: age -d → gunzip → import do czystej bazy…" >&2
# Schemat na bazie docelowej stawia sam import: CLI importu uruchamia migracje
# i seed przed wczytaniem archiwum, dokładnie po to, żeby odtwarzanie po awarii
# celowało w bazę pustą.
age -d -i "$identity" "${workdir}/kopia.json.gz.age" \
  | gunzip \
  | env DATABASE_URL="$RESTORE_DATABASE_URL" $api import

echo "4/5 Eksport z bazy odtworzonej…" >&2
env DATABASE_URL="$RESTORE_DATABASE_URL" $api export > "${workdir}/po.json"

echo "5/5 Porównanie postaci kanonicznych…" >&2
$api drill compare "${workdir}/przed.json" "${workdir}/po.json"

echo "Próba odtworzenia zakończona powodzeniem." >&2
