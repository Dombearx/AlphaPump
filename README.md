# AlphaPump

Aplikacja mobilna do bardzo szybkiego zapisywania serii treningowych, śledzenia
postępu i porównywania wyników w gronie znajomych. Działa w pełni offline,
lokalna baza jest źródłem prawdy dla interfejsu, a synchronizacja odbywa się
w tle.

## Dokumentacja

| Dokument | Zawartość |
| --- | --- |
| [`docs/specyfikacja_biznesowa.md`](docs/specyfikacja_biznesowa.md) | Co budujemy — zakres, model domenowy, reguły biznesowe, kryteria akceptacyjne |
| [`docs/stack_technologiczny.md`](docs/stack_technologiczny.md) | Czym i jak — stack, architektura, decyzje projektowe i ich uzasadnienia |
| [`docs/plan_implementacji.md`](docs/plan_implementacji.md) | W jakiej kolejności — etapy realizacji wraz z kryteriami ukończenia |

Przy rozbieżności między dokumentami rozstrzyga specyfikacja biznesowa dla
wymagań i dokument stacku dla rozwiązań technicznych.

## Struktura repozytorium

Monorepo na pnpm workspaces i Turborepo.

```
apps/
  mobile/       Expo (Android + iOS)          — etap 5 i dalsze
  api/          Hono (REST + sync + LLM)      — etap 3 i dalsze
  admin/        Vite + React (panel)          — etap 13
packages/
  core/         logika domenowa, bez I/O      — etap 1 ✔
  db/           schematy Drizzle: PG + SQLite — etap 2
  api-client/   typowany klient (Hono RPC)    — etap 3
```

`packages/core` jest sercem projektu: front Pareto, cykle, podpowiedzi,
identyfikatory i schematy Zod. Nie ma tam żadnego I/O, bo dokładnie ten sam kod
liczy rekordy na telefonie (offline) i na serwerze — rozjazd między nimi byłby
niewidoczny w kodzie i bardzo widoczny dla użytkownika.

## Uruchamianie

Wymagania: Node 22+ i pnpm 10+ (`corepack enable`).

```
pnpm install
```

| Polecenie        | Co robi                                             |
| ---------------- | --------------------------------------------------- |
| `pnpm build`     | buduje wszystkie pakiety (Turborepo, z cache)        |
| `pnpm test`      | uruchamia testy jednostkowe (Vitest)                 |
| `pnpm typecheck` | sprawdza typy w każdym pakiecie                      |
| `pnpm lint`      | ESLint + sprawdzenie formatowania Prettierem         |
| `pnpm lint:fix`  | to samo, z automatyczną poprawą                      |

Te same cztery kroki wykonuje CI (`.github/workflows/ci.yml`) na każdym pull
requeście, w tej samej kolejności i tymi samymi poleceniami.

### Kontrakt identyfikatorów

`slug()` oraz deterministyczne identyfikatory ćwiczeń i tagów są objęte testami
golden (`packages/core/tests/golden/identifiers.ts`). Ich zmiana przepisuje
identyfikatory istniejących wierszy, więc czerwony test golden nie jest testem
do poprawienia — to sygnał, że zmiana wymaga świadomej decyzji i migracji.
