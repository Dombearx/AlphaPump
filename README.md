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
| [`docs/uruchomienie.md`](docs/uruchomienie.md) | Od zera do działającej aplikacji na telefonie — sama kolejność kroków, bez uzasadnień |
| [`docs/konfiguracja.md`](docs/konfiguracja.md) | Wszystkie zmienne środowiskowe, po jednej tabeli na plik `.env` |
| [`docs/wdrozenie.md`](docs/wdrozenie.md) | Jak stoi produkcja i co się z nią robi: stos, wydania, kopie, odtworzenie po awarii |
| [`docs/podsystemy.md`](docs/podsystemy.md) | Po jednej sekcji na część systemu — jak ją uruchomić osobno i co w niej nieoczywiste |
| [`docs/audyt_kodu.md`](docs/audyt_kodu.md) | Rejestr znalezisk z audytu kodu wraz z ich wagą |

Przy rozbieżności między dokumentami rozstrzyga specyfikacja biznesowa dla
wymagań i dokument stacku dla rozwiązań technicznych.

To README jest **spisem treści i skrótem do pracy nad kodem**: co gdzie leży,
czym się to buduje i jak postawić stos u siebie. Wszystko dłuższe niż akapit
mieszka w `docs/` — do jednego rozdziału po jednym pliku, bo README z tabelą
zmiennych środowiskowych i instrukcją wdrożenia obok siebie rozjeżdżało się
z tymi dokumentami po cichu, a pierwszy raz było to widać dopiero wtedy, gdy
ktoś zrobił coś według nieaktualnej połowy.

## Struktura repozytorium

Monorepo na pnpm workspaces i Turborepo.

```
apps/
  mobile/       Expo — aplikacja na Androida
  api/          Hono — REST, synchronizacja i warstwy wykrywania duplikatów
  admin/        Vite + React — panel administracyjny
packages/
  core/         logika domenowa, bez I/O — wspólna dla telefonu i serwera
  db/           jeden schemat w dwóch dialektach: PostgreSQL i SQLite
services/
  triage/       segregacja zgłoszeń zwrotnych (Python)
deploy/         obrazy, Compose, Caddy, serwer wydań
scripts/        kopie zapasowe i próba odtworzenia
```

`services/` stoi celowo poza `apps/`: to, co tam leży, nie jest częścią produktu
i nie wchodzi do workspace pnpm — ma własny język, własne zależności i własne
zadanie w CI.

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

Te same cztery kroki wykonuje CI, tymi samymi poleceniami. Mieszkają
w `.github/workflows/verify.yml` — osobnym pliku, bo wołają je **trzy** przepływy:
CI przy każdym pull requeście oraz wdrożenie i wydanie aplikacji **przed**
wypuszczeniem czegokolwiek. Kolejność tam jest odwrotna do tabeli — `lint`,
`typecheck`, `build`, `test` — bo najtańsze sprawdzenie ma odbić zepsutą zmianę
jako pierwsze, zanim runner zdąży cokolwiek zbudować.

Obok nich chodzą zadania, z których każde pilnuje czegoś, czego `pnpm test`
złapać nie może:

| Zadanie | Kiedy | Czego pilnuje |
| ------- | ----- | ------------- |
| `ci.yml` | każdy pull request | `verify.yml` plus testy Pythona: serwera wydań i usługi segregacji zgłoszeń |
| `backup-restore.yml` | co miesiąc i przy zmianie kodu kopii | że kopia daje się odtworzyć, a dane po odtworzeniu zgadzają się z oryginałem |
| `deploy-stack.yml` | PR dotykający wdrożenia, backendu lub panelu | że stos z `deploy/` wstaje na czystej bazie i odpowiada przez Caddy'ego |
| `deploy.yml` | merge do `main` | wdrożenie na minipc — dopiero po `verify.yml` |
| `android-release.yml` | merge do `main` ruszający aplikację, tag `v*` i ręcznie | wydanie aplikacji na minipc: paczka JavaScriptu, a gdy ruszyła warstwa natywna — pełny `.apk` |
| `agent-issue.yml` | zgłoszenie z etykietą agenta | poprawka przygotowana automatycznie z treści zgłoszenia |

Zmienne środowiskowe każdej z aplikacji opisuje
[`docs/konfiguracja.md`](docs/konfiguracja.md) — jedna tabela na plik `.env`.

### Uruchomienie lokalne (testy manualne)

**1. Zależności.** Node 22+ (`.nvmrc`), pnpm 10+ (`corepack enable`).

```
pnpm install
```

**2. Baza.** Obraz musi mieć pgvectora — migracja `0005` włącza rozszerzenia
`pg_trgm` i `vector`, więc na zwykłym `postgres:17` start odbije się o pierwszą
migrację, która ich potrzebuje.

```
docker run -d --name alphapump-pg -p 5432:5432 \
  -e POSTGRES_USER=alphapump -e POSTGRES_PASSWORD=alphapump -e POSTGRES_DB=alphapump \
  pgvector/pgvector:pg17
```

**3. Konfiguracja API.**

```
cp apps/api/.env.example apps/api/.env
openssl rand -base64 48        # wynik do BETTER_AUTH_SECRET
```

**4. API.** Uruchamiamy zbudowane wyjście — dokładnie to, które pojedzie na
serwer. Migracje wykonują się przy starcie, osobnego kroku nie ma.

```
pnpm --filter @alphapump/api build
node --env-file=apps/api/.env apps/api/dist/index.js
```

Pętla deweloperska to przebudowa i restart, a skryptu `dev` **nie ma świadomie**.
Wariant `node --watch --experimental-strip-types src/index.ts` na Node 22 nie
wstaje: importy w źródłach mają rozszerzenia `.js`, a stripowanie typów nie
odwzorowuje ich na pliki `.ts` — kończy się `ERR_MODULE_NOT_FOUND` na pierwszym
imporcie. Dotyczyło to tak samo CLI eksportu i importu, więc ich warianty `:dev`
też zniknęły; `pnpm --filter @alphapump/api build` trwa sekundy i nie kłamie
o tym, co pojedzie na serwer.

**5. Dane startowe.** Start serwera wykonuje migracje **i seed**, więc konto
systemowe, tagi startowe i ćwiczenia wbudowane są w bazie od pierwszego
uruchomienia — tak samo jak na telefonie, który seeduje swoją bazę sam. Seed
wstawia wyłącznie brakujące wiersze, więc nie cofa zmian zrobionych w panelu
i nie wskrzesza tego, co administrator usunął. Do testów manualnych przydają się
jeszcze dane próby (idempotentnie: dwie osoby, serie w dwóch dniach i cykl
z celem):

```
pnpm --filter @alphapump/api build
node --env-file=apps/api/.env apps/api/dist/cli/drill.js sample
```

**6. Panel.** Żądania idą przez proxy Vite, więc przeglądarka widzi jedno
pochodzenie i nie wchodzi w CORS.

```
cp apps/admin/.env.example apps/admin/.env
pnpm --filter @alphapump/admin dev        # http://localhost:5173
```

**7. Aplikacja mobilna.** Na fizycznym telefonie `localhost` wskazuje sam
telefon — w `EXPO_PUBLIC_API_URL` musi być adres, pod którym telefon widzi
maszynę dewelopera.

```
cp apps/mobile/.env.example apps/mobile/.env
pnpm --filter @alphapump/mobile start
```

**8. Sprawdzenie z konsoli.** Sesja wraca nagłówkiem `set-auth-token`, nie
ciasteczkiem — tą samą drogą, którą chodzi aplikacja.

```
curl -s localhost:3000/health

curl -sD- -o/dev/null -X POST localhost:3000/api/auth/sign-up/email \
  -H 'Content-Type: application/json' \
  -d '{"email":"ja@example.com","password":"haslo-testowe-123","name":"Ja"}'

curl -s localhost:3000/me -H "Authorization: Bearer <token>"
```

**9. Pierwszy administrator.** Rolę nadaje panel, ale pierwszemu administratorowi
nie ma jej kto nadać — więc SQL-em, raz:

```
psql "postgres://alphapump:alphapump@localhost:5432/alphapump" \
  -c "UPDATE users SET role = 'admin' WHERE email = 'ja@example.com';"
```

**10. Testy.** Ani bazy, ani kluczy nie wymagają: API jedzie na PGlite
w procesie, a warstwy modelowe są w testach podstawione atrapami. `pnpm test`
działa na czystej maszynie i dokładnie to robi CI.
