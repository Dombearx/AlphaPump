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
  mobile/       Expo (Android + iOS)          — etap 5 ✔, ekrany od etapu 6
  api/          Hono (REST + sync + LLM)      — etapy 3 ✔ i 4 ✔
  admin/        Vite + React (panel)          — etap 13
packages/
  core/         logika domenowa, bez I/O      — etapy 1 ✔ i 4 ✔
  db/           schematy Drizzle: PG + SQLite — etap 2 ✔
  api-client/   typowany klient (Hono RPC)    — etap 7
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

### Baza danych

`packages/db` opisuje jeden schemat w dwóch dialektach: PostgreSQL po stronie
serwera i SQLite po stronie telefonu. Migracje generuje drizzle-kit — SQL-a nie
piszemy ręcznie.

| Polecenie                                     | Co robi                          |
| --------------------------------------------- | -------------------------------- |
| `pnpm --filter @alphapump/db generate`         | migracje dla obu dialektów       |
| `pnpm --filter @alphapump/db generate:pg`      | migracje PostgreSQL              |
| `pnpm --filter @alphapump/db generate:sqlite`  | migracje SQLite                  |

Testy paczki uruchamiają komplet migracji na czystym Postgresie (PGlite
w procesie) i na czystym pliku SQLite, a potem sprawdzają, że seed po obu
stronach daje **identyczne identyfikatory** ćwiczeń wbudowanych. Rozjazd
znaczyłby, że pierwsza synchronizacja zrobi z jednego ćwiczenia dwa.

### API

```
cp apps/api/.env.example apps/api/.env    # uzupełnij BETTER_AUTH_SECRET
pnpm --filter @alphapump/api build && pnpm --filter @alphapump/api start
```

Serwer sam uruchamia migracje przed przyjęciem pierwszego żądania.

| Ścieżka           | Co daje                                                     |
| ----------------- | ----------------------------------------------------------- |
| `/health`         | stan serwera i bazy, bez uwierzytelnienia                    |
| `/api/auth/*`     | rejestracja, logowanie (e-mail i Google), sesje, klucze API  |
| `/openapi.json`   | dokumentacja generowana z tych samych schematów Zod          |
| `/me`             | konto powiązane z sesją albo kluczem API                     |
| `/tags`, `/exercises`, `/sets`, `/cycles` | CRUD danych                          |
| `/sync/push`, `/sync/pull` | wymiana danych z urządzeniem                      |

Uwierzytelnienie idzie dwiema drogami: nagłówkiem `Authorization: Bearer …`
(sesja, tak korzysta aplikacja) albo `x-api-key` (token API, tak korzysta bot
Discord). Serie są prywatne — także administrator nie widzi cudzej historii.

### Synchronizacja

`POST /sync/push` przyjmuje paczkę mutacji z outboxu telefonu, `GET /sync/pull?since=`
oddaje wszystko, co pojawiło się za kursorem. Kursorem jest `server_seq` — jeden
dla wszystkich tabel, bo pochodzi z jednej sekwencji.

Reguły rozstrzygania konfliktów mieszkają w `packages/core/src/sync.ts`, żeby
telefon liczył je tym samym kodem co serwer:

| Sytuacja                              | Rozstrzygnięcie                             |
| ------------------------------------- | ------------------------------------------- |
| dwa urządzenia dodają różne wiersze   | suma — brak konfliktu z definicji           |
| dwa urządzenia edytują ten sam wiersz | LWW po `updated_at`, remis po `device_id`   |
| jedno usuwa, drugie edytuje           | usunięcie wygrywa, niezależnie od czasu     |

Serwer przycina znaczniki czasu z przyszłości do własnego „teraz", bo LWW opiera
się na zegarze telefonu. Każdy wiersz paczki jest rozstrzygany osobno i wraca
w odpowiedzi ze stanem serwerowym — jedna odrzucona mutacja nie zatrzymuje
outboxu, a wiersz, który przegrał, nie zostaje na urządzeniu w przegranej wersji.

`POST /sync/tombstones/prune` (administrator) zdejmuje stare tombstone'y. Okno
retencji musi być dłuższe niż najdłuższa realna przerwa w synchronizacji —
urządzenie, które przespało tombstone, przywiozłoby usuniętą serię z powrotem.

### Aplikacja mobilna

```
cp apps/mobile/.env.example apps/mobile/.env    # wskaż adres API
pnpm --filter @alphapump/mobile start
```

| Polecenie                                          | Co robi                              |
| -------------------------------------------------- | ------------------------------------ |
| `pnpm --filter @alphapump/mobile start`             | serwer deweloperski Expo             |
| `pnpm --filter @alphapump/mobile android`           | build i uruchomienie na Androidzie   |
| `pnpm --filter @alphapump/mobile prebuild`          | generowanie projektów natywnych      |
| `pnpm --filter @alphapump/mobile build`             | eksport bundla (ten sam krok co CI)  |

Adres API wchodzi zmienną `EXPO_PUBLIC_API_URL` i to z niego wyliczają się oba
wyjątki od szyfrowania ruchu: `NSAppTransportSecurity` po stronie iOS oraz
`res/xml/network_security_config.xml` po stronie Androida. Oba są **zawężone do
tego jednego hosta** — API działa po HTTP wewnątrz VPN, ale plaintext nie jest
otwierany globalnie. Wyliczenie jest w `apps/mobile/config/network.js` i ma testy,
bo ta konfiguracja psuje się cicho: aplikacja buduje się i uruchamia, a dopiero
pierwsze żądanie kończy się niejasnym błędem sieci.

Baza lokalna to SQLite otwarty z `enableChangeListener: true` — bez tego
`useLiveQuery` nie dostaje powiadomień o zapisie i ekran nie przerysowuje się sam.
Migracje jadą do aplikacji jako moduł (`@alphapump/db/sqlite-migrations`), bo na
telefonie nie ma katalogu, z którego migrator mógłby je przeczytać; generuje go
`pnpm --filter @alphapump/db generate:bundle`, a test pilnuje, że jest aktualny.

Osobny workflow (`.github/workflows/ios-simulator.yml`) kompiluje aplikację na
symulator iOS. Buildy na symulator jako jedyne nie wymagają płatnego konta Apple
i wyłapują to, co przy pracy wyłącznie na Androidzie psuje się niezauważenie.

### Kontrakt identyfikatorów

`slug()` oraz deterministyczne identyfikatory ćwiczeń i tagów są objęte testami
golden (`packages/core/tests/golden/identifiers.ts`). Ich zmiana przepisuje
identyfikatory istniejących wierszy, więc czerwony test golden nie jest testem
do poprawienia — to sygnał, że zmiana wymaga świadomej decyzji i migracji.
