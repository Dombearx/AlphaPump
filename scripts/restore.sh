#!/usr/bin/env bash
#
# Odtworzenie danych z kopii zapasowej: (age) → gunzip → import.
#
# Ostatni krok to **ten sam import**, którego używa funkcja importu danych
# w aplikacji. Dzięki temu ścieżka odtwarzania jest sprawdzana przy normalnym
# korzystaniu z produktu, a nie dopiero w sytuacji awaryjnej.
#
# Użycie:
#   scripts/restore.sh ~/alphapump-backups/alphapump-2026-08-10.json.gz  # lokalna
#   scripts/restore.sh alphapump-2026-08-10.json.gz.age                  # zaszyfrowana
#   scripts/restore.sh gdrive:alphapump-backups/alphapump-....age        # z Dysku
#
# O tym, czy odszyfrowywać, decyduje **rozszerzenie pliku**, a nie zmienna
# środowiskowa: jedno i drugie źródło kopii bywa w użyciu naraz (lokalna z crona,
# zaszyfrowana ze starego zestawu), a plik sam wie, czym jest.
#
# Wymagane w środowisku:
#   AGE_IDENTITY      ścieżka do pliku z kluczem prywatnym age — tylko dla `.age`
#   DATABASE_URL      baza docelowa — tylko przy domyślnym poleceniu importu
# Opcjonalne:
#   ALPHAPUMP_IMPORT_CMD  polecenie czytające archiwum ze stdin (patrz niżej)
#
# `ALPHAPUMP_IMPORT_CMD` odpowiada `ALPHAPUMP_EXPORT_CMD` z `backup.sh` i istnieje
# z tego samego powodu: na minipc baza jest widoczna wyłącznie w sieci Compose,
# więc import musi pójść wewnątrz kontenera API, a odszyfrowanie zostaje na
# gospodarzu, bo to tam przynosi się klucz prywatny.
#
# Klucz prywatny **nigdy** nie leży na minipc ani na Dysku obok kopii. Do
# odtworzenia przynosi się go z menedżera haseł albo z wydruku — dokładnie
# dlatego, że najczęstszą przyczyną bezużytecznych kopii jest klucz trzymany na
# maszynie, której te kopie dotyczyły.

set -euo pipefail

source="${1:-}"
[ -n "$source" ] || { echo "Podaj plik kopii (lokalny albo zdalny rclone)" >&2; exit 1; }

# Klucza żądamy dopiero wtedy, gdy kopia jest zaszyfrowana. Wymaganie go zawsze
# blokowałoby odtworzenie z kopii lokalnej, przy której klucz nigdy nie powstał.
if [[ "$source" == *.age ]]; then
  : "${AGE_IDENTITY:?Ustaw AGE_IDENTITY — ścieżkę do klucza prywatnego age}"
  [ -f "$AGE_IDENTITY" ] || { echo "Nie ma pliku klucza: $AGE_IDENTITY" >&2; exit 1; }
fi

# Tablica, nie napis do `eval` — tak samo jak w `backup.sh`.
read -r -a import_command <<< "${ALPHAPUMP_IMPORT_CMD:-pnpm --silent --filter @alphapump/api run import}"

if [ -z "${ALPHAPUMP_IMPORT_CMD:-}" ]; then
  : "${DATABASE_URL:?Ustaw DATABASE_URL — bazę docelową}"
fi

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

# Adres zdalny rozpoznajemy po dwukropku przed ścieżką — tak zapisuje je rclone.
if [[ "$source" == *:* && ! -f "$source" ]]; then
  echo "Pobieram ${source}…" >&2
  rclone copy "$source" "$workdir/"
  local_file="${workdir}/$(basename "$source")"
else
  local_file="$source"
fi

# Potokiem, bez pliku pośredniego: odszyfrowana kopia nie musi nigdzie leżeć.
if [[ "$local_file" == *.age ]]; then
  echo "Odszyfrowuję i importuję ${local_file}…" >&2
  age -d -i "$AGE_IDENTITY" "$local_file" \
    | gunzip \
    | "${import_command[@]}"
else
  echo "Importuję ${local_file}…" >&2
  gunzip -c "$local_file" \
    | "${import_command[@]}"
fi

echo "Odtworzono z ${local_file}" >&2
