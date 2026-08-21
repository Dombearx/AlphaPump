#!/usr/bin/env bash
#
# `pnpm --filter api regenerate-seed`, uruchamiane bezpiecznie na minipc.
#
# Sam skrypt CLI (`apps/api/src/cli/regenerate-seed.ts`) potrzebuje dwóch
# rzeczy naraz: dostępu do Postgresa i zapisu do `packages/db/src/seed/data.ts`
# w checkoucie repozytorium. Na minipc gospodarz nie ma żadnego z nich osobno —
# baza nie wystawia portu poza sieć Compose (patrz `deploy/docker-compose.yml`
# i sekcja „Kopie zapasowe" w `docs/wdrozenie.md`), a kontener `api` nie ma w sobie źródeł,
# tylko zbudowane `dist/` (patrz `deploy/Dockerfile.api`). Ten skrypt łączy oba:
# buduje ten sam obraz co produkcja, ale zatrzymuje się na etapie `build` (tam
# jeszcze jest TypeScript i `dist/` po kompilacji), podłącza go do sieci
# Compose, żeby widział `db`, i podmienia w nim jeden plik bind-mountem na
# wersję z checkoutu — więc to, co CLI zapisze, ląduje od razu na dysku
# gospodarza, gotowe do `git diff`.
#
# Sekrety (`DATABASE_URL`, `BETTER_AUTH_SECRET`) skrypt bierze z już
# uruchomionego kontenera `api`, zamiast czytać `deploy/.env` samodzielnie —
# to ten sam mechanizm co credentiale do bazy, jedno źródło prawdy.
#
# Wymaga uruchomionego stosu (`docker compose up`) i pnpm zainstalowanego
# **wyłącznie wewnątrz obrazu** — na gospodarzu nie jest potrzebny.
#
# Użycie:
#   scripts/regenerate-seed.sh
#   git diff packages/db/src/seed/data.ts

set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=(docker compose -f deploy/docker-compose.yml)

if ! "${COMPOSE[@]}" exec -T api true 2>/dev/null; then
  echo "Kontener api nie działa — najpierw 'docker compose -f deploy/docker-compose.yml up -d'." >&2
  exit 1
fi

DATABASE_URL=$("${COMPOSE[@]}" exec -T api sh -c 'echo "$DATABASE_URL"')
BETTER_AUTH_SECRET=$("${COMPOSE[@]}" exec -T api sh -c 'echo "$BETTER_AUTH_SECRET"')

NETWORK=$(docker inspect -f '{{range $k, $v := .NetworkSettings.Networks}}{{$k}}{{end}}' \
  "$("${COMPOSE[@]}" ps -q db)")

echo "Buduję etap 'build' obrazu API (ten sam Dockerfile co produkcja)..." >&2
docker build --quiet --target build -t alphapump-api-build -f deploy/Dockerfile.api . >/dev/null

echo "Uruchamiam regenerate-seed w sieci '$NETWORK'..." >&2
docker run --rm \
  --network "$NETWORK" \
  --user "$(id -u):$(id -g)" \
  -e DATABASE_URL="$DATABASE_URL" \
  -e BETTER_AUTH_SECRET="$BETTER_AUTH_SECRET" \
  -v "$PWD/packages/db/src/seed/data.ts:/app/packages/db/src/seed/data.ts" \
  alphapump-api-build \
  pnpm --filter api regenerate-seed

echo "Gotowe. Sprawdź diff: git diff packages/db/src/seed/data.ts" >&2
