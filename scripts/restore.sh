#!/usr/bin/env bash
#
# Odtworzenie danych z kopii zapasowej: age → gunzip → import.
#
# Ostatni krok to **ten sam import**, którego używa funkcja importu danych
# w aplikacji. Dzięki temu ścieżka odtwarzania jest sprawdzana przy normalnym
# korzystaniu z produktu, a nie dopiero w sytuacji awaryjnej.
#
# Użycie:
#   scripts/restore.sh alphapump-2026-08-10.json.gz.age          # plik lokalny
#   scripts/restore.sh gdrive:alphapump-backups/alphapump-....age # wprost z Dysku
#
# Wymagane w środowisku:
#   DATABASE_URL      baza docelowa
#   AGE_IDENTITY      ścieżka do pliku z kluczem prywatnym age
#
# Klucz prywatny **nigdy** nie leży na minipc ani na Dysku obok kopii. Do
# odtworzenia przynosi się go z menedżera haseł albo z wydruku — dokładnie
# dlatego, że najczęstszą przyczyną bezużytecznych kopii jest klucz trzymany na
# maszynie, której te kopie dotyczyły.

set -euo pipefail

source="${1:-}"
[ -n "$source" ] || { echo "Podaj plik kopii (lokalny albo zdalny rclone)" >&2; exit 1; }

: "${DATABASE_URL:?Ustaw DATABASE_URL — bazę docelową}"
: "${AGE_IDENTITY:?Ustaw AGE_IDENTITY — ścieżkę do klucza prywatnego age}"
[ -f "$AGE_IDENTITY" ] || { echo "Nie ma pliku klucza: $AGE_IDENTITY" >&2; exit 1; }

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

echo "Odszyfrowuję i importuję ${local_file}…" >&2

# Potokiem, bez pliku pośredniego: odszyfrowana kopia nie musi nigdzie leżeć.
age -d -i "$AGE_IDENTITY" "$local_file" \
  | gunzip \
  | pnpm --silent --filter @alphapump/api run import

echo "Odtworzono z ${local_file}" >&2
