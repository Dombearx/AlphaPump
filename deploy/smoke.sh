#!/usr/bin/env bash
#
# Sprawdzenie stosu po wdrożeniu — z zewnątrz, przez Caddy'ego, jak telefon.
#
# Nie jest to test jednostkowy ani integracyjny; te jadą w CI na kodzie. To jest
# sprawdzenie **złożenia**: czy Caddy rozdziela ruch tak, jak zakłada
# `deploy/Caddyfile`, czy API dogadało się z bazą i czy panel w ogóle wyszedł
# z obrazu. Wszystkie trzy rzeczy da się zepsuć bez naruszenia jednej linijki
# kodu aplikacji, więc żaden test w repozytorium ich nie złapie.
#
# Użycie:
#   deploy/smoke.sh                      # domyślnie http://localhost
#   deploy/smoke.sh http://100.64.0.1    # adres w VPN
#
# Kod wyjścia 0 znaczy „stos odpowiada poprawnie".

set -uo pipefail

base="${1:-http://localhost}"
base="${base%/}"

failures=0

# Jedno wywołanie curla na sprawdzenie: interesuje nas status i typ treści,
# a nie sama treść. `--max-time` jest po to, żeby zawieszony backend dał wynik
# negatywny zamiast wisieć w cronie albo w CI.
probe() {
  local name="$1" path="$2" expected_status="$3" expected_type="$4"
  local response status type

  response="$(curl --silent --show-error --max-time 20 \
    --output /dev/null \
    --write-out '%{http_code} %{content_type}' \
    "${base}${path}" 2>&1)" || {
    printf '  ✗ %-38s %s\n' "$name" "curl: $response"
    failures=$((failures + 1))
    return
  }

  status="${response%% *}"
  type="${response#* }"

  if [ "$status" != "$expected_status" ]; then
    printf '  ✗ %-38s status %s, oczekiwano %s\n' "$name" "$status" "$expected_status"
    failures=$((failures + 1))
    return
  fi

  case "$type" in
    *"$expected_type"*) printf '  ✓ %-38s %s %s\n' "$name" "$status" "$type" ;;
    *)
      printf '  ✗ %-38s typ %s, oczekiwano %s\n' "$name" "$type" "$expected_type"
      failures=$((failures + 1))
      ;;
  esac
}

echo "Sprawdzam ${base}"

# 1. API żyje **razem z bazą**. `/health` odpytuje bazę i oddaje 503, gdy proces
#    żyje, a baza nie — czyli dokładnie tę awarię, której nie widać z zewnątrz.
probe 'API i baza (/health)' '/health' 200 'application/json'

# 2. Dokument OpenAPI. Kontrakt dla bota Discord i dla panelu; jego brak znaczy,
#    że API wstało, ale w wersji, o którą nikt nie prosił.
probe 'OpenAPI (/openapi.json)' '/openapi.json' 200 'application/json'

# 3. Trasa chroniona. 401 z JSON-em jest tu **dowodem trafienia w API**: gdyby
#    Caddy oddał tę ścieżkę panelowi, przyszłoby 200 z `text/html` i klient
#    zamiast błędu autoryzacji dostałby stronę.
probe 'Trasa chroniona (/sets)' '/sets' 401 'application/json'

# 4. Panel wyszedł z obrazu i jest serwowany.
probe 'Panel (/)' '/' 200 'text/html'

# 5. Ścieżka routera panelu. SPA obsługuje ją w przeglądarce, więc serwer musi
#    oddać `index.html`, a nie 404 — inaczej odświeżenie strony w panelu psuje
#    nawigację.
probe 'Trasa panelu (/users)' '/users' 200 'text/html'

# 6. Katalog wydań aplikacji. Brakujący plik ma dać **404**, a nie `index.html`
#    ze statusem 200 — inaczej telefon pobrałby stronę panelu zamiast pakietu.
#    Ta sama pomyłka co przy trasach API, tylko po drugiej stronie rozdziału.
probe 'Nieznane wydanie (/pobierz/…)' '/pobierz/nie-ma-takiego.apk' 404 ''

# 7. Manifest wydania — to z niego telefony dowiadują się o aktualizacji.
#    Zanim wyjdzie pierwsze wydanie, 404 jest poprawnym stanem, więc brak pliku
#    nie jest tu błędem; błędem jest 200 z `text/html`, czyli manifest oddany
#    przez panel.
manifest_status="$(curl --silent --show-error --max-time 20 --output /dev/null \
  --write-out '%{http_code} %{content_type}' "${base}/pobierz/latest.json" 2>&1)"
case "$manifest_status" in
  200*application/json*)
    printf '  ✓ %-38s %s\n' 'Manifest wydania (/pobierz/latest.json)' "$manifest_status"
    ;;
  404*)
    printf '  ✓ %-38s brak wydania (to normalne przed pierwszym)\n' 'Manifest wydania'
    ;;
  *)
    printf '  ✗ %-38s %s\n' 'Manifest wydania' "$manifest_status"
    failures=$((failures + 1))
    ;;
esac

echo
if [ "$failures" -eq 0 ]; then
  echo "Stos odpowiada poprawnie."
  exit 0
fi

echo "Nieudanych sprawdzeń: ${failures}" >&2
exit 1
