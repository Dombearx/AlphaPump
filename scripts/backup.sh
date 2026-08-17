#!/usr/bin/env bash
#
# Kopia zapasowa AlphaPump: eksport → gzip → (age) → katalog lokalny albo rclone.
#
# Skrypt jest przeznaczony do crona na minipc. Cały łańcuch jedzie **potokiem**,
# bez pliku pośredniego w drodze.
#
# ## Dwa cele, jeden wybierasz
#
# `BACKUP_DIR`     katalog na tej maszynie — nic do konfigurowania poza ścieżką,
# `RCLONE_REMOTE`  zdalny katalog rclone, np. `gdrive:alphapump-backups`.
#
# Ustaw **jedno** z nich. Katalog lokalny jest wariantem na start: broni przed
# złą migracją, pomyłkowym `DELETE` i przewróconym kontenerem, czyli przed tym,
# co zdarza się najczęściej. **Nie broni przed padem dysku ani utratą maszyny** —
# kopia leży wtedy razem z oryginałem. Wariant zdalny jest w tym mocniejszy
# i dlatego zostaje tu opisany: przejście na niego to podmiana jednej zmiennej.
#
# ## Szyfrowanie jest opcjonalne, ale nie bez powodu
#
# `AGE_RECIPIENTS` puste → kopia leży jako zwykły `.json.gz`. Ma to sens **tylko**
# przy `BACKUP_DIR`: kto ma dostęp do dysku serwera, ma i tak dostęp do bazy,
# więc szyfrowanie kopii leżącej obok niej niczego nie dokłada, a kosztuje klucz,
# który trzeba gdzieś bezpiecznie trzymać. Skrypt zakłada więc katalog z prawami
# `700` i pliki `600`, i tyle.
#
# Przy wysyłce na zewnątrz (`RCLONE_REMOTE`) jest odwrotnie i skrypt tego
# pilnuje: kopia u obcego dostawcy **musi** być zaszyfrowana, więc bez
# `AGE_RECIPIENTS` przerywa zamiast po cichu wysłać historię treningową grupy
# otwartym tekstem.
#
# Na minipc trafia wyłącznie klucz **publiczny** age. Kluczem publicznym można
# jedynie zaszyfrować, więc włamanie na serwer nie daje dostępu do kopii
# leżących na Dysku. Przy szyfrowaniu hasłem hasło musiałoby siedzieć w cronie
# i przejęcie serwera oznaczałoby przejęcie wszystkich kopii.
#
# Wymagane w środowisku:
#   BACKUP_DIR lub RCLONE_REMOTE   cel kopii — dokładnie jedno z dwóch
#   DATABASE_URL         adres bazy — tylko przy domyślnym poleceniu eksportu
# Opcjonalne:
#   AGE_RECIPIENTS       klucze publiczne odbiorców, po przecinku (`age1...`).
#                        Wymagane przy `RCLONE_REMOTE`, dobrowolne przy `BACKUP_DIR`
#   ALPHAPUMP_EXPORT_CMD polecenie wypisujące archiwum na stdout (patrz niżej)
#   RETENTION_DAYS       ile dni trzymamy kopie (domyślnie 90)
#   BACKUP_PREFIX        przedrostek nazwy pliku (domyślnie `alphapump`)
#
# `ALPHAPUMP_EXPORT_CMD` istnieje dlatego, że na minipc **nie ma dostępu do bazy
# z gospodarza**: Postgres nie wystawia portu, jest widoczny wyłącznie w sieci
# Compose. Eksport musi więc pójść wewnątrz kontenera API, a szyfrowanie i zapis
# zostają na gospodarzu — bo to tam leżą klucz publiczny `age` i konfiguracja
# rclone. Wartość dla wdrożenia dockerowego jest w `deploy/backup.env.example`.
#
# Uwaga na dwie flagi w wywołaniach pnpm. `run` jest konieczne, bo `pnpm import`
# to **wbudowane** polecenie pnpm (konwersja plików lock). `--silent` jest
# konieczne, bo pnpm wypisuje nagłówek skryptu na **stdout** — czyli tym samym
# strumieniem, którym jedzie archiwum. Bez niego pierwszy bajt kopii jest
# nagłówkiem pnpm i plik przestaje być JSON-em.
#
# Szyfrować można do **dwóch** odbiorców naraz: klucza głównego i klucza CI.
# Dzięki temu comiesięczna próba odtworzenia nie wymaga wystawiania klucza
# głównego automatyce — `age` przyjmuje wiele flag `-r`.

set -euo pipefail

# Kopia bywa nieszyfrowana (wariant lokalny), więc prawa pliku są tu jedyną
# ochroną. Umask ustawiamy raz, przed utworzeniem czegokolwiek: `age` i `gzip`
# tworzą plik przez przekierowanie powłoki i same o prawa nie zadbają.
umask 077

BACKUP_DIR="${BACKUP_DIR:-}"
RCLONE_REMOTE="${RCLONE_REMOTE:-}"

if [ -n "$BACKUP_DIR" ] && [ -n "$RCLONE_REMOTE" ]; then
  echo "Ustaw BACKUP_DIR albo RCLONE_REMOTE, nie oba naraz" >&2
  exit 1
fi
if [ -z "$BACKUP_DIR" ] && [ -z "$RCLONE_REMOTE" ]; then
  echo "Ustaw BACKUP_DIR (katalog na tej maszynie) albo RCLONE_REMOTE (np. gdrive:alphapump-backups)" >&2
  exit 1
fi

# Wysyłka na zewnątrz bez szyfrowania to nie jest wybór, który wolno zrobić przez
# przeoczenie pustej zmiennej — stąd twarde przerwanie zamiast ostrzeżenia.
if [ -n "$RCLONE_REMOTE" ] && [ -z "${AGE_RECIPIENTS:-}" ]; then
  echo "RCLONE_REMOTE bez AGE_RECIPIENTS — kopia u zewnętrznego dostawcy musi być zaszyfrowana" >&2
  exit 1
fi

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
age_args=()
if [ -n "${AGE_RECIPIENTS:-}" ]; then
  IFS=',' read -r -a recipients <<< "$AGE_RECIPIENTS"
  for recipient in "${recipients[@]}"; do
    trimmed="$(echo "$recipient" | tr -d '[:space:]')"
    [ -n "$trimmed" ] && age_args+=("-r" "$trimmed")
  done
  [ "${#age_args[@]}" -gt 0 ] || { echo "AGE_RECIPIENTS nie zawiera żadnego klucza" >&2; exit 1; }
fi

day="$(date +%F)"
if [ "${#age_args[@]}" -gt 0 ]; then
  archive="${BACKUP_PREFIX}-${day}.json.gz.age"
else
  archive="${BACKUP_PREFIX}-${day}.json.gz"
fi

# Plik powstaje pod nazwą roboczą i dostaje docelową dopiero po sprawdzeniu
# rozmiaru. Bez tego przerwana kopia zostawałaby w katalogu jako pełnoprawna
# i przy odtwarzaniu wyglądała na najświeższą.
workdir=''
staging=''
cleanup() {
  [ -n "$staging" ] && rm -f "$staging"
  [ -n "$workdir" ] && rm -rf "$workdir"
  return 0
}
trap cleanup EXIT

if [ -n "$BACKUP_DIR" ]; then
  # Kopia idzie od razu do katalogu docelowego, a nie przez `/tmp`: przy wariancie
  # bez szyfrowania to jedyny katalog, o którego prawa skrypt zadbał.
  mkdir -p "$BACKUP_DIR"
  chmod 700 "$BACKUP_DIR"
  destination="${BACKUP_DIR}/${archive}"
  staging="${destination}.part"
else
  workdir="$(mktemp -d)"
  destination="${RCLONE_REMOTE}/${archive}"
  staging="${workdir}/${archive}"
fi

echo "Tworzę kopię ${archive}…" >&2

# `pipefail` jest tu istotny: bez niego awaria eksportu zostałaby przesłonięta
# sukcesem `age` i w kopiach wylądowałaby zaszyfrowana pustka.
if [ "${#age_args[@]}" -gt 0 ]; then
  "${export_command[@]}" | gzip | age "${age_args[@]}" > "$staging"
else
  "${export_command[@]}" | gzip > "$staging"
fi

size="$(wc -c < "$staging")"
# Kopia mniejsza niż setka bajtów nie jest kopią — to spakowana pustka.
# Lepiej, żeby cron krzyknął dzisiaj, niż żeby odkryło się to przy odtwarzaniu.
[ "$size" -gt 100 ] || { echo "Kopia ma tylko ${size} bajtów — przerywam" >&2; exit 1; }

if [ -n "$BACKUP_DIR" ]; then
  mv "$staging" "${BACKUP_DIR}/${archive}"
  staging=''

  echo "Retencja: usuwam kopie starsze niż ${RETENTION_DAYS} dni…" >&2
  # `-maxdepth 1`, bo katalog kopii może być punktem montowania czegoś większego,
  # a kasowanie w głąb cudzych katalogów nie jest zadaniem tego skryptu.
  find "$BACKUP_DIR" -maxdepth 1 -type f -name "${BACKUP_PREFIX}-*.json.gz*" \
    -mtime "+${RETENTION_DAYS}" -delete
else
  rclone copy "$staging" "${RCLONE_REMOTE}/"

  echo "Retencja: usuwam kopie starsze niż ${RETENTION_DAYS} dni…" >&2
  rclone delete --min-age "${RETENTION_DAYS}d" "${RCLONE_REMOTE}/"
fi

echo "Gotowe: ${destination} (${size} B)" >&2
