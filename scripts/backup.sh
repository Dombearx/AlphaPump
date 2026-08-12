#!/usr/bin/env bash
#
# Kopia zapasowa AlphaPump: eksport → gzip → age → rclone na Dysk Google.
#
# Skrypt jest przeznaczony do crona na minipc. Cały łańcuch jedzie **potokiem**,
# bez pliku pośredniego: plik z niezaszyfrowaną historią treningową wszystkich
# osób nie ma powodu ani chwili leżeć na dysku serwera.
#
# Na minipc trafia **wyłącznie klucz publiczny** age. Kluczem publicznym można
# jedynie zaszyfrować, więc włamanie na serwer nie daje dostępu do kopii leżących
# na Dysku. Przy szyfrowaniu hasłem hasło musiałoby siedzieć w cronie i przejęcie
# serwera oznaczałoby przejęcie wszystkich kopii.
#
# Wymagane w środowisku:
#   AGE_RECIPIENTS       klucze publiczne odbiorców, po przecinku (`age1...`)
#   RCLONE_REMOTE        zdalny katalog rclone, np. `gdrive:alphapump-backups`
#   DATABASE_URL         adres bazy — tylko przy domyślnym poleceniu eksportu
# Opcjonalne:
#   ALPHAPUMP_EXPORT_CMD polecenie wypisujące archiwum na stdout (patrz niżej)
#   RETENTION_DAYS       ile dni trzymamy kopie (domyślnie 90)
#   BACKUP_PREFIX        przedrostek nazwy pliku (domyślnie `alphapump`)
#
# `ALPHAPUMP_EXPORT_CMD` istnieje dlatego, że na minipc **nie ma dostępu do bazy
# z gospodarza**: Postgres nie wystawia portu, jest widoczny wyłącznie w sieci
# Compose. Eksport musi więc pójść wewnątrz kontenera API, a szyfrowanie i wysyłka
# zostają na gospodarzu — bo to tam leżą klucz publiczny `age` i konfiguracja
# rclone. Wartość dla wdrożenia dockerowego jest w `deploy/backup.env.example`.
#
# Uwaga na dwie flagi w wywołaniach pnpm. `run` jest konieczne, bo `pnpm import`
# to **wbudowane** polecenie pnpm (konwersja plików lock). `--silent` jest
# konieczne, bo pnpm wypisuje nagłówek skryptu na **stdout** — czyli tym samym
# strumieniem, którym jedzie archiwum. Bez niego pierwszy bajt kopii jest
# nagłówkiem pnpm i plik przestaje być JSON-em.
#
# Szyfrujemy do **dwóch** odbiorców naraz: klucza głównego i klucza CI. Dzięki
# temu comiesięczna próba odtworzenia nie wymaga wystawiania klucza głównego
# automatyce — `age` przyjmuje wiele flag `-r`.

set -euo pipefail

: "${AGE_RECIPIENTS:?Ustaw AGE_RECIPIENTS — klucze publiczne age po przecinku}"
: "${RCLONE_REMOTE:?Ustaw RCLONE_REMOTE, np. gdrive:alphapump-backups}"

# Polecenie eksportu jako **tablica**, a nie napis do `eval`: podstawiona wartość
# jest dzielona po białych znakach i tyle. Do zapisu w rodzaju
# `docker compose -f … exec -T api node …` to wystarcza, a `eval` na zmiennej
# środowiskowej byłby zaproszeniem, którego nikt tu nie potrzebuje.
read -r -a export_command <<< "${ALPHAPUMP_EXPORT_CMD:-pnpm --silent --filter @alphapump/api run export}"

# Adresu bazy pilnujemy tylko wtedy, gdy eksport uruchamiamy z tego repozytorium.
# Przy poleceniu podstawionym baza jest sprawą tego polecenia — na minipc siedzi
# w kontenerze i gospodarz nie ma jak jej dosięgnąć.
if [ -z "${ALPHAPUMP_EXPORT_CMD:-}" ]; then
  : "${DATABASE_URL:?Ustaw DATABASE_URL}"
fi

RETENTION_DAYS="${RETENTION_DAYS:-90}"
BACKUP_PREFIX="${BACKUP_PREFIX:-alphapump}"

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repository_root"

# `age` chce każdego odbiorcę w osobnej fladze; ze zmiennej po przecinku robimy
# tablicę argumentów, zamiast składać polecenie w napisie.
IFS=',' read -r -a recipients <<< "$AGE_RECIPIENTS"
age_args=()
for recipient in "${recipients[@]}"; do
  trimmed="$(echo "$recipient" | tr -d '[:space:]')"
  [ -n "$trimmed" ] && age_args+=("-r" "$trimmed")
done
[ "${#age_args[@]}" -gt 0 ] || { echo "AGE_RECIPIENTS nie zawiera żadnego klucza" >&2; exit 1; }

day="$(date +%F)"
archive="${BACKUP_PREFIX}-${day}.json.gz.age"
workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

echo "Tworzę kopię ${archive}…" >&2

# `pipefail` jest tu istotny: bez niego awaria eksportu zostałaby przesłonięta
# sukcesem `age` i na Dysk poleciałby zaszyfrowany pusty plik.
"${export_command[@]}" \
  | gzip \
  | age "${age_args[@]}" \
  > "${workdir}/${archive}"

size="$(wc -c < "${workdir}/${archive}")"
# Kopia mniejsza niż setka bajtów nie jest kopią — to zaszyfrowana pustka.
# Lepiej, żeby cron krzyknął dzisiaj, niż żeby odkryło się to przy odtwarzaniu.
[ "$size" -gt 100 ] || { echo "Kopia ma tylko ${size} bajtów — przerywam" >&2; exit 1; }

rclone copy "${workdir}/${archive}" "${RCLONE_REMOTE}/"

echo "Retencja: usuwam kopie starsze niż ${RETENTION_DAYS} dni…" >&2
rclone delete --min-age "${RETENTION_DAYS}d" "${RCLONE_REMOTE}/"

echo "Gotowe: ${archive} (${size} B)" >&2
