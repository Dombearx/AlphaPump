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
  mobile/       Expo (Android + iOS)          — etapy 5 ✔ … 12 ✔ i 14 ✔
  api/          Hono (REST + sync + LLM)      — etapy 3 ✔, 4 ✔, 11 ✔, 12 ✔, 13 ✔ i 14 ✔
  admin/        Vite + React (panel)          — etap 13 ✔
packages/
  core/         logika domenowa, bez I/O      — etapy 1 ✔, 4 ✔, 8 ✔, 9 ✔, 11 ✔, 12 ✔, 13 ✔ i 14 ✔
  db/           schematy Drizzle: PG + SQLite — etapy 2 ✔, 11 ✔ i 12 ✔
  api-client/   typowany klient (Hono RPC)    — nieużywany: patrz „Panel administracyjny"
services/
  triage/       segregacja zgłoszeń zwrotnych (Python) — patrz sekcja niżej
deploy/         obrazy, Compose, Caddy        — etap 15 ✔
scripts/        kopie zapasowe i próba odtworzenia — etap 14 ✔
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

Te same cztery kroki wykonuje CI (`.github/workflows/ci.yml`) na każdym pull
requeście, tymi samymi poleceniami. Kolejność tam jest odwrotna do tabeli —
`lint`, `typecheck`, `build`, `test` — bo najtańsze sprawdzenie ma odbić
zepsuty PR jako pierwsze, zanim runner zdąży cokolwiek zbudować.

Obok niego chodzą cztery zadania, każde pilnujące czegoś, czego `pnpm test`
złapać nie może:

| Zadanie | Kiedy | Czego pilnuje |
| ------- | ----- | ------------- |
| `ios-simulator.yml` | PR dotykający aplikacji | że projekt na iOS wciąż się buduje, mimo że wydanie idzie na Androida |
| `backup-restore.yml` | co miesiąc i przy zmianie kodu kopii | że kopia daje się odtworzyć, a dane po odtworzeniu zgadzają się z oryginałem |
| `deploy-stack.yml` | PR dotykający wdrożenia, backendu lub panelu | że stos z `deploy/` wstaje na czystej bazie i odpowiada przez Caddy'ego |
| `android-release.yml` | ręcznie i przy tagu `v*` | wydanie pliku `.apk` dla grupy |

### Konfiguracja: pliki `.env` i klucze API

Trzy aplikacje, trzy pliki `.env`, każdy obok swojej aplikacji. Wzorce leżą
w repozytorium (`apps/*/.env.example`) i to one są kompletną listą zmiennych —
poniższe tabele mówią, **skąd wziąć wartości** i co się stanie, gdy ich nie ma.

Zasada jest jedna: brakuje czegoś, bez czego serwer nie ma jak działać — proces
kończy się przy starcie. Brakuje klucza do funkcji dodatkowej — funkcja jest
wyłączona, a serwer wstaje i mówi o tym w logu.

#### `apps/api/.env` — backend

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `DATABASE_URL` | **tak** | adres PostgreSQL 17 **z pgvectorem** (patrz niżej) |
| `BETTER_AUTH_SECRET` | **tak** | własny sekret, min. 32 znaki: `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | nie (`http://localhost:3000`) | publiczny adres API — wchodzi do adresów zwrotnych OAuth i do OpenAPI |
| `TRUSTED_ORIGINS` | nie | lista po przecinku: schemat aplikacji (`alphapump://`) i adres panelu |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | nie | Google Cloud Console → *APIs & Services* → *Credentials* → OAuth client ID typu **Web application** |
| `OPENROUTER_API_KEY` | nie | [openrouter.ai](https://openrouter.ai) → *Keys* |
| `LLM_ENABLED`, `RERANKER_ENABLED` | nie (`true`) | wyłączniki warstw wykrywania duplikatów |
| `EMBEDDING_MODEL`, `RERANKER_MODEL`, `LLM_TIMEOUT_MS` | nie | wartości domyślne z `.env.example` |
| `HOST`, `PORT` | nie (`0.0.0.0:3000`) | nasłuch |

Wymagane są dokładnie dwie zmienne. `loadConfig` wypisuje **komplet** braków
naraz i przerywa start — literówka w adresie bazy ma wywalić proces od razu,
a nie przy pierwszym logowaniu.

Brak kompletu obu wartości Google wyłącza logowanie Google; e-mail z hasłem
działa dalej. Brak `OPENROUTER_API_KEY` (albo `LLM_ENABLED=false`) sprowadza
wykrywanie duplikatów do warstwy leksykalnej — tworzenie ćwiczeń nie zmienia się
w żaden sposób. Żadne z tych dwóch nie jest błędem konfiguracji.

> **Node nie czyta `.env` sam.** `node dist/index.js` zobaczy tylko zmienne ze
> środowiska procesu, więc do uruchomienia z pliku trzeba flagi:
> `node --env-file=apps/api/.env dist/index.js` — albo wczytania zmiennych do
> powłoki (`set -a; . apps/api/.env; set +a`). Dotyczy to również CLI eksportu
> i importu: czytają tę samą konfigurację, więc cron potrzebuje także
> `BETTER_AUTH_SECRET`, choć kopia zapasowa nie ma z sesjami nic wspólnego.
> Panel (Vite) i aplikacja mobilna (Expo) ładują swoje pliki `.env` same.

#### `apps/admin/.env` — panel administracyjny

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `VITE_API_URL` | nie (`http://localhost:3000`) | cel proxy Vite (`/api-proxy`) w trybie deweloperskim |
| `VITE_API_BASE` | nie (puste) | adres, pod który panel woła API w przeglądarce; puste = proxy w dev, to samo pochodzenie w buildzie |

Zmienne `VITE_*` są **wkompilowane w build**, więc zmiana adresu API na
produkcji wymaga ponownego `vite build`, a nie restartu.

#### `apps/mobile/.env` — aplikacja mobilna

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `EXPO_PUBLIC_API_URL` | nie (`http://localhost:3000`) | adres API **widoczny z telefonu**: IP w LAN lub w NetBirdzie; emulator Androida widzi hosta pod `10.0.2.2` |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | nie | ten sam projekt Google Cloud, client ID typu **Web** — także na Androidzie, bo to on jest odbiorcą `idToken`, który weryfikuje serwer |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | nie | client ID typu **iOS** |

Natywne logowanie na Androidzie wymaga dodatkowo klienta OAuth typu **Android**
w tym samym projekcie Google Cloud (pakiet `app.alphapump.mobile` i odcisk SHA-1
klucza podpisującego). Do `.env` on nie wchodzi, ale bez niego Sign-In kończy się
błędem po stronie Google.

Adres API jest wkompilowany w bundle i **z niego wyliczają się** wyjątki od
szyfrowania ruchu (ATS na iOS, `network_security_config` na Androidzie), więc po
jego zmianie trzeba przejść przez `prebuild`, a nie tylko przeładować aplikację.

#### Kopie zapasowe — zmienne dla crona i CI

Skrypty z `scripts/` nie czytają `.env`; zmienne biorą ze środowiska.

| Zmienna | Gdzie | Skąd wziąć |
| ------- | ----- | ---------- |
| `DATABASE_URL`, `BETTER_AUTH_SECRET` | skrypty wołające CLI z repozytorium | jak w konfiguracji API |
| `AGE_RECIPIENTS` | `backup.sh` | klucze **publiczne** `age` po przecinku (`age-keygen`): główny i CI |
| `RCLONE_REMOTE` | `backup.sh` | zdalny katalog po `rclone config`, np. `gdrive:alphapump-backups` |
| `RETENTION_DAYS`, `BACKUP_PREFIX` | `backup.sh` | domyślnie `90` i `alphapump` |
| `ALPHAPUMP_EXPORT_CMD` | `backup.sh` | polecenie wypisujące archiwum na stdout — wzór w `deploy/backup.env.example` |
| `AGE_IDENTITY` | `restore.sh` | plik z kluczem **prywatnym** — z menedżera haseł, nigdy z minipc |
| `ALPHAPUMP_IMPORT_CMD` | `restore.sh` | polecenie czytające archiwum ze stdin |
| `RESTORE_DATABASE_URL` | `backup-drill.sh` | czysta baza docelowa próby |

Dwie ostatnie zmienne istnieją dlatego, że **na minipc gospodarz nie ma dostępu
do bazy**: Postgres nie wystawia portu, jest widoczny wyłącznie w sieci Compose.
Eksport i import idą więc wewnątrz kontenera API (`docker compose exec`),
a szyfrowanie i wysyłka zostają na gospodarzu, bo to tam leżą klucz `age`
i konfiguracja rclone. Gdy zmiennych nie ma, skrypty wołają CLI z repozytorium
tak jak dotąd — i wtedy potrzebują `DATABASE_URL`.

Po stronie repozytorium jest jeden sekret: `AGE_CI_IDENTITY` (comiesięczna próba
odtworzenia). Bez niego próba nadal przechodzi — na kluczu jednorazowym.

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

**5. Dane startowe.** Start serwera wykonuje migracje, ale **nie** seed — świeża
baza nie ma ani konta systemowego, ani ćwiczeń wbudowanych. Do testów manualnych
najkrócej jest wypełnić ją danymi próby (idempotentnie: konto systemowe,
ćwiczenia wbudowane, dwie osoby, serie w dwóch dniach i cykl z celem):

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

### Wdrożenie

Docelowa infrastruktura to minipc w sieci NetBird: Docker Compose z PostgreSQL 17
(pgvector, `pg_trgm`), API oraz panelem za Caddym, bez TLS. *Dlaczego* akurat tak
— a zwłaszcza dlaczego bez certyfikatu — mówi
[`docs/stack_technologiczny.md`](docs/stack_technologiczny.md). Tutaj jest samo
*jak*.

Wszystko, co potrzebne, leży w `deploy/`:

| Plik | Rola |
| ---- | ---- |
| `docker-compose.yml` | trzy usługi: `db`, `api`, `web` |
| `Dockerfile.api` | obraz API — instalacja produkcyjna plus zbudowane `dist/` |
| `Dockerfile.web` | Caddy z wpieczonym panelem |
| `Caddyfile` | rozdział ruchu między API a panel |
| `.env.example` | wzór konfiguracji stosu |
| `backup.env.example`, `crontab.example` | wzory dla crona kopii zapasowych |
| `smoke.sh` | sprawdzenie działającego stosu z zewnątrz |
| `update_server.py`, `alphapump-update-server.service` | automatyczne wdrożenie po mergu do `main` — patrz „Serwer aktualizacji" niżej |

Kontenery są trzy, nie cztery: panel to zbiór plików statycznych, a nie proces,
więc jest wpieczony w obraz Caddy'ego. Osobny kontener musiałby albo uruchomić
drugi serwer HTTP, albo podać pliki wolumenem — i wtedy aktualizacja panelu
zależałaby od kolejności startu.

#### Zanim zaczniesz

Na minipc: Docker z wtyczką Compose, `git`, a do kopii zapasowych `age`
i `rclone`. W VPN: NetBird uruchomiony i minipc widoczny z telefonów. Adres
minipc w sieci NetBird (`ip -4 addr show wt0` albo panel NetBirda) jest tą samą
wartością, która wejdzie do `BETTER_AUTH_URL` i do `EXPO_PUBLIC_API_URL` przy
budowaniu aplikacji — pomyłka tutaj kończy się aplikacją, która wygląda
poprawnie i nie łączy się z niczym.

Dostęp do internetu jest minipc potrzebny (obrazy Dockera, klucze publiczne
Google przy weryfikacji `idToken`, OpenRouter, Dysk Google), ale API na zewnątrz
nie wychodzi: nie ma przekierowania portu na routerze i nie ma go czym dodać.

#### Pierwsze uruchomienie

```
git clone <adres-repozytorium> /opt/alphapump
cd /opt/alphapump/deploy
cp .env.example .env
```

Uzupełnij `.env` — minimum to `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`
(`openssl rand -base64 48`) i `BETTER_AUTH_URL` równy adresowi minipc w VPN.
Rozważ ustawienie `BIND_ADDRESS` na adres interfejsu NetBird: domyślne `0.0.0.0`
odpowiada decyzji z dokumentu stacku (sieć lokalna minipc jest traktowana jako
zaufana), ale wpisanie adresu VPN zawęża dostęp do samego VPN-u.

```
docker compose up --detach --build --wait
../deploy/smoke.sh http://localhost
```

`--wait` czeka na healthchecki, a nie na start kontenerów: „gotowe" znaczy tu
„API odpowiada i widzi bazę", czyli po wykonaniu migracji. Migracje uruchamia sam
serwer, przed przyjęciem pierwszego żądania — nie ma osobnego kroku migracyjnego
do zapomnienia.

Świeża baza jest **pusta**: nie ma w niej konta systemowego ani ćwiczeń
wbudowanych. Wnosi je pierwszy import, bo to ta sama ścieżka, którą idzie
odtworzenie po awarii:

```
docker compose exec -T api node /app/apps/api/dist/cli/import.js < archiwum.json
```

Pierwszemu koncu trzeba jeszcze nadać rolę administratora — panel bez niej nie
wpuści:

```
docker compose exec db psql -U alphapump -d alphapump \
  -c "UPDATE users SET role = 'admin' WHERE email = 'ja@example.com';"
```

**Lista kontrolna przed wypuszczeniem grupie:**

- `BETTER_AUTH_SECRET` losowy, nie z `.env.example` (jego zmiana wylogowuje
  wszystkich, więc niech od razu będzie docelowy),
- `BETTER_AUTH_URL` równy rzeczywistemu adresowi w VPN — wchodzi do OpenAPI
  i do adresów zwrotnych logowania,
- `TRUSTED_ORIGINS` zawiera `alphapump://`; panel jest pod tym samym
  pochodzeniem co API, więc wpisu nie potrzebuje,
- `OPENROUTER_API_KEY` ustawiony albo **świadomie** pusty — log przy starcie
  mówi wprost, że warstwa semantyczna jest wyłączona,
- `deploy/smoke.sh` przechodzi w całości,
- cron kopii zapasowych działa, a odtworzenie zostało wykonane na sucho.

#### Aktualizacja

```
cd /opt/alphapump
git pull
docker compose -f deploy/docker-compose.yml up --detach --build --wait
deploy/smoke.sh http://localhost
```

Migracje wykonuje wstający kontener API, więc aktualizacja to podmiana obrazu
i restart. Kolejność w Compose jest wymuszona warunkami zdrowia: `web` czeka na
zdrowe `api`, a `api` na zdrową bazę — panel nie wystartuje przed backendem,
którego jeszcze nie ma.

Wycofanie zmiany to `git checkout <poprzedni-tag>` i to samo polecenie. **Migracje
bazy nie cofają się same** — wycofanie wersji, która dołożyła kolumnę, jest
bezpieczne (starszy kod jej nie używa), ale wycofanie za taką, która coś usunęła,
wymaga odtworzenia z kopii. Przed aktualizacją zmieniającą schemat warto
uruchomić `scripts/backup.sh` ręcznie.

Warto też robić wydania z tagiem (`git tag -a v0.2.0`): tag jest jedyną rzeczą,
która później pozwala powiedzieć, *co* dokładnie stoi na minipc.

#### Serwer aktualizacji

Powyższe kroki da się też wywołać zdalnie, zamiast wpisywać je ręcznie po SSH.
`deploy/update_server.py` wystawia `GET /update` na porcie 40002, który robi
`git pull`, a potem
`docker compose -f deploy/docker-compose.yml up -d --build --force-recreate`,
oraz `GET /health`, które tylko potwierdza, że serwer żyje, bez wdrażania
niczego.

Stoi bezpośrednio na gospodarzu, nie w kontenerze, żeby móc wołać `git`
i `docker` bez montowania gniazda Dockera do środka. To samodzielny skrypt
z zależnościami zadeklarowanymi inline (PEP 723 — `fastapi`, `uvicorn`), więc
`uv run deploy/update_server.py` instaluje tylko te dwie paczki do osobnego
środowiska, bez dotykania `pnpm`/Turborepo, których nie potrzebuje.

Instalacja jako usługa systemd, żeby przeżyła restart i awarię. Jednostka
zakłada checkout w `/opt/alphapump` — inna ścieżka wymaga zmiany
`WorkingDirectory`:

```bash
sudo cp deploy/alphapump-update-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alphapump-update-server
```

`systemctl status alphapump-update-server` pokazuje, czy działa, a
`journalctl -u alphapump-update-server -f` śledzi logi. Użytkownik, na którym
stoi usługa, musi należeć do grupy `docker`.

Endpoint nie ma własnego uwierzytelnienia — ma być osiągalny wyłącznie przez
prywatną sieć (NetBird), tak jak z `.github/workflows/deploy.yml`, który woła
go po każdym mergu do `main`. Ten workflow potrzebuje trzech sekretów
w ustawieniach repozytorium: `NETBIRD_ACCESS_KEY`, `NETBIRD_MANAGEMENT_URL`
(te same wartości, których używa analogiczny mechanizm w LivingBotFramework)
oraz `ALPHAPUMP_UPDATE_SERVER_URL` — adres serwera aktualizacji w sieci
NetBird, z `/update` na końcu, np. `http://100.64.0.1:40002/update`.

#### Kopie zapasowe

Zestaw jest z etapu 14 — eksport JSON → gzip → `age` → `rclone` na Dysk Google —
a wdrożenie dokłada mu tylko jedną rzecz: eksport idzie **wewnątrz kontenera**,
bo baza nie wystawia portu na gospodarza.

```
sudo install -D -m 600 deploy/backup.env.example /etc/alphapump/backup.env
sudo nano /etc/alphapump/backup.env      # klucze age, remote rclone
crontab -e                               # wpisy z deploy/crontab.example
```

Na minipc trafia **wyłącznie klucz publiczny** `age`. Klucz prywatny mieszka
w menedżerze haseł i na wydruku — nigdy na maszynie, której kopie dotyczą, i nigdy
na Dysku obok nich.

Pierwszą kopię zrób ręcznie i sprawdź, że doszła:

```
set -a; . /etc/alphapump/backup.env; set +a
scripts/backup.sh
rclone ls "$RCLONE_REMOTE"
```

#### Odtworzenie po awarii

Odtworzenie to **ta sama ścieżka**, którą chodzi import danych w aplikacji —
dlatego nie zardzewieje między awariami.

```
# 1. Czysty stos. `down --volumes` kasuje bazę: to jest właśnie ten moment.
cd /opt/alphapump
docker compose -f deploy/docker-compose.yml down --volumes
docker compose -f deploy/docker-compose.yml up --detach --wait

# 2. Klucz prywatny — przyniesiony, nie znaleziony na maszynie.
export AGE_IDENTITY=/media/pendrive/klucz-alphapump.txt

# 3. Import wewnątrz kontenera; odszyfrowanie zostaje na gospodarzu.
export ALPHAPUMP_IMPORT_CMD="docker compose -f /opt/alphapump/deploy/docker-compose.yml exec -T api node /app/apps/api/dist/cli/import.js"
scripts/restore.sh gdrive:alphapump-backups/alphapump-2026-08-10.json.gz.age

# 4. Sprawdzenie.
deploy/smoke.sh http://localhost
```

Import sam uruchamia migracje i seed przed wczytaniem archiwum, więc celuje
w bazę pustą i nie wymaga niczego przygotowanego wcześniej.

Kopia, której nigdy nie odtworzono, nie jest kopią: `backup-restore.yml` przechodzi
cały ten łańcuch raz w miesiącu na danych fikcyjnych i porównuje wynik
z oryginałem. Na sucho, na prawdziwej kopii, przechodzi się przez niego przy
uruchamianiu minipc — do bazy **testowej**, nie do produkcyjnej.

#### Aplikacja na Androida

Adres API jest **wkompilowany w wydanie**: zmienne `EXPO_PUBLIC_*` wchodzą do
bundla, a z adresu wyliczają się jeszcze wyjątek ATS (iOS) i
`network_security_config` (Android). Zmiana adresu to więc nowe wydanie, a nie
przestawienie czegoś w aplikacji.

Wydanie z CI (`.github/workflows/android-release.yml`) — ręcznie z polem
`api_url` albo tagiem `v*`, wtedy adres bierze się ze zmiennej repozytorium
`EXPO_PUBLIC_API_URL`. Zadanie oddaje plik `.apk` razem z sumą kontrolną.
Lokalnie to samo robi:

```
EXPO_PUBLIC_API_URL=http://100.64.0.1 pnpm --filter @alphapump/mobile run prebuild
cd apps/mobile/android && ./gradlew assembleRelease
```

Rozdanie grupie idzie przez minipc, a nie przez GitHuba — nikt nie musi mieć
konta ani dostępu do repozytorium:

```
scp alphapump-12.apk minipc:/opt/alphapump/deploy/apk/alphapump.apk
```

i telefony pobierają go pod `http://<adres-w-vpn>/pobierz/alphapump.apk`. Caddy
serwuje ten katalog zwykłym `file_server`, więc nie ma tu żadnej dodatkowej
usługi do utrzymania. Instalacja wymaga zgody na „nieznane źródła" — normalna
przy dystrybucji poza sklepem.

Dwie rzeczy, które łatwo przeoczyć, a boli obie dopiero później:

- **`versionCode` musi rosnąć** między wydaniami, bo Android odmawia instalacji
  pakietu o niższym numerze. W CI podstawia się numer przebiegu; przy budowaniu
  lokalnym ustaw `ANDROID_VERSION_CODE` sam.
- **Klucz podpisujący jest na zawsze.** Bez sekretu `ANDROID_KEYSTORE_BASE64`
  gradle podpisuje wydanie kluczem deweloperskim z szablonu. To działa, ale późniejsze
  przejście na własny klucz wymaga odinstalowania aplikacji na *każdym* telefonie
  — system nie pozwala podmienić pakietu podpisanego innym kluczem. Własny klucz
  (`keytool -genkeypair`, potem `base64` do sekretów repozytorium) warto wstawić
  przed pierwszym rozdaniem, a nie po nim.

Konfiguracji EAS repozytorium nie zawiera — wydanie idzie z projektu natywnego
generowanego przez `prebuild`. iOS wchodzi w etapie 16, razem z kontem Apple
Developer.

#### Sprawdzanie stanu

```
docker compose -f deploy/docker-compose.yml ps        # stan i zdrowie usług
docker compose -f deploy/docker-compose.yml logs -f api
deploy/smoke.sh http://localhost
curl -s http://localhost/health | jq
```

`/health` odpytuje bazę, więc 503 znaczy „proces żyje, baza nie" — dokładnie ta
awaria, której nie widać z zewnątrz. `deploy/smoke.sh` idzie krok dalej
i sprawdza też rozdział ruchu w Caddym: czy trasa API rzeczywiście trafia do API,
a nie do panelu, który na nieznaną ścieżkę oddaje `index.html` ze statusem 200.

Ten sam stos, z tych samych plików, stawia w CI `deploy-stack.yml` przy każdej
zmianie dotykającej wdrożenia, backendu albo panelu — razem z przepływem
założenia konta, który jako jedyny dowodzi, że migracje się wykonały, a sesja
przechodzi przez proxy. Wdrożenie psuje się bez tknięcia kodu aplikacji, więc nie
ma sensu odkrywać tego na minipc.

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
pnpm --filter @alphapump/api build
node --env-file=apps/api/.env apps/api/dist/index.js
```

Serwer sam uruchamia migracje przed przyjęciem pierwszego żądania. Flaga
`--env-file` jest konieczna, bo Node nie ładuje `.env` sam — na produkcji
zmienne wchodzą ze środowiska procesu i flagi nie ma (patrz „Konfiguracja:
pliki `.env` i klucze API").

| Ścieżka           | Co daje                                                     |
| ----------------- | ----------------------------------------------------------- |
| `/health`         | stan serwera i bazy, bez uwierzytelnienia                    |
| `/api/auth/*`     | rejestracja, logowanie (e-mail i Google), sesje, klucze API  |
| `/openapi.json`   | dokumentacja generowana z tych samych schematów Zod          |
| `/me`             | konto powiązane z sesją albo kluczem API                     |
| `/tags`, `/exercises`, `/sets`, `/cycles` | CRUD danych                          |
| `/exercises/similar?name=` | podobne ćwiczenia: leksykalnie, semantycznie i przez model |
| `/exercises/:id/records` | rekordy globalne ćwiczenia                          |
| `/rankings?metric=`      | ranking objętości, dystansu albo liczby rekordów    |
| `/sync/push`, `/sync/pull` | wymiana danych z urządzeniem                      |
| `/export`, `/import`     | eksport i import danych w JSON-ie                   |
| `/admin/users`, `/admin/stats` | konta i dane systemowe (rola administratora)   |

Uwierzytelnienie idzie dwiema drogami: nagłówkiem `Authorization: Bearer …`
(sesja, tak korzysta aplikacja) albo `x-api-key` (token API, tak korzysta bot
Discord). Serie są prywatne — także administrator nie widzi cudzej historii.

#### Tokeny API

Każdy użytkownik może mieć ich wiele. Wydaje je plugin `apiKey` better-autha,
a w aplikacji obsługuje ekran **Konto → Tokeny API**: nazwa, lista wydanych
tokenów z datą ostatniego użycia i unieważnianie. Pełny token pokazuje się
**tylko raz**, w odpowiedzi na utworzenie — potem serwer zna już wyłącznie jego
skrót i kilka pierwszych znaków, więc zgubiony token się unieważnia i wydaje
nowy, a nie odzyskuje.

Ten sam mechanizm bez aplikacji, na przykład przy stawianiu bota:

```
curl -s localhost:3000/api/auth/api-key/create \
  -H 'Content-Type: application/json' -H "Authorization: Bearer <token-sesji>" \
  -d '{"name":"bot Discord"}'

curl -s localhost:3000/sets -H "x-api-key: <token>"
```

Ekran tokenów jest — obok rekordów globalnych i rankingów — jednym z nielicznych
miejsc czekających na sieć, i z tego samego powodu: token weryfikuje serwer,
więc tylko on wie, czy jeszcze żyje. Lista trzymana lokalnie kłamałaby po
unieważnieniu z innego urządzenia.

### Rekordy globalne i rankingi

Rekord globalny to front Pareto po seriach **wszystkich** użytkowników, liczony
tym samym `computeRecords` z `@alphapump/core`, którym telefon liczy rekordy
indywidualne. Wyniki leżą w `exercise_records` — to jedyne dane pochodne trzymane
na serwerze i jedyny cache, jaki tu istnieje. Przeliczenie jest wpięte w listę
`apps/api/src/derived/` i wołane po każdej zmianie serii: po `POST /sync/push`
oraz po CRUD-zie serii, żeby bot Discord też podbijał rekordy, a nie zostawiał
ich nieaktualnymi. Ćwiczenie przelicza się **od zera**, bo usunięcie serii
potrafi wskrzesić rekord, który wcześniej został zdominowany.

Rankingi objętości i dystansu są zwykłymi sumami po seriach, liczonymi w chwili
pytania — nie mają cache'u i nie mają jak rozjechać się z surowymi danymi.
Ranking „liczba rekordów" jest zliczeniem po `exercise_records`.

Granica prywatności jest twarda: na zewnątrz wychodzi wyłącznie wartość, nick,
data i notatka serii. Kształt `globalRecordSchema` w rdzeniu jest tej reguły
zapisem — nie ma w nim identyfikatora serii ani konta, więc żaden endpoint nie
odda przypadkiem punktu zaczepienia do cudzej historii.

### Wykrywanie duplikatów ćwiczeń

Trzy warstwy, różniące się **dostępnością**, nie tylko trafnością:

| Warstwa | Gdzie                                    | Kiedy działa               |
| ------- | ---------------------------------------- | -------------------------- |
| 1       | telefon (`findSimilarExercises` w rdzeniu) | zawsze, także offline    |
| 2       | serwer: `pg_trgm` + `tsvector` + `pgvector` | gdy jest łączność       |
| 3       | serwer: re-ranker przez OpenRouter          | gdy warstwa jest włączona |

Warstwy 2 i 3 stoją za `GET /exercises/similar?name=`. Leksykalna i semantyczna
lista są scalane przez **RRF** (`packages/core/src/rrf.ts`) — po miejscach, nie po
wynikach, bo `similarity()` z trigramów i odległość kosinusowa z pgvectora
mieszkają w nieporównywalnych skalach. Embedding liczy się **raz, przy zapisie
ćwiczenia** (`POST /exercises`, `PATCH /exercises/:id` i push), nie przy każdym
zapytaniu; odpowiedzi modelu są cache'owane po parze slug + odcisk listy
kandydatów, bo werdykt zależy od obojga.

Cała warstwa jest wyłączalna jedną zmienną (`LLM_ENABLED=false`), a brak
`OPENROUTER_API_KEY` daje ten sam skutek — serwer wstaje i mówi o tym w logu.
Odpowiedź niesie wtedy `layer: "lexical"`, aplikacja pokazuje ostrzeżenie liczone
lokalnie, a **tworzenie ćwiczeń nie zmienia się w żaden sposób**: `POST /exercises`
nigdy nie pyta o duplikaty i nie ma jak zostać przez nie zablokowane. Re-ranker
wyłącza się osobno (`RERANKER_ENABLED=false`): do znalezienia podobnych wystarczą
embeddingi, model generatywny dokłada ocenę i uzasadnienie.

Wywołania modeli wychodzą **wyłącznie z backendu** — klucz OpenRoutera nie może
trafić do binarki aplikacji, bo ta jest w praktyce publiczna. Testy integracyjne
podstawiają atrapy warstw (`apps/api/tests/duplicates.test.ts`), więc CI nie
zależy ani od cudzego serwisu, ani od klucza w sekretach.

### Eksport, import i kopie zapasowe

Jeden format i jeden zestaw reguł (`packages/core/src/transfer.ts`), trzy miejsca
użycia: `GET /export` i `POST /import`, ekran „Eksport i import" w aplikacji oraz
skrypty kopii. To nie oszczędność linijek — to jedyny sposób, żeby ścieżka
odtwarzania nie zardzewiała: drogę „eksport → plik → import" przechodzą zwykli
użytkownicy przy normalnym korzystaniu z aplikacji.

**W archiwum:** serie, ćwiczenia, tagi, cykle i minimalne dane kont (`id`, e-mail,
nick, rola). **Poza archiwum:** hashe haseł i sesje (wrażliwe, a do odtworzenia
zbędne), klucze API (użytkownik wygeneruje nowe), embeddingi (przeliczalne z nazw)
oraz rekordy i rankingi (pochodne z serii). Tombstone'ów też nie ma — archiwum
odtwarza **stan**, nie historię usunięć.

Dwie reguły decydują o tym, że odtworzenie nie osieroca danych, i obie są w rdzeniu
(`planArchiveIdentity`), bo wykonuje je i serwer, i telefon:

- konta z archiwum są dopasowywane **po adresie e-mail** — po odtworzeniu na czystą
  bazę ludzie logują się ponownie i dostają nowe identyfikatory,
- gdy identyfikator autora się zmienił, przeliczane są identyfikatory jego ćwiczeń
  (`uuidv5(autor + slug nazwy)`) i przepisywane odwołania w seriach oraz pozycjach
  celów. Bez tego kroku odtworzone ćwiczenia byłyby poprawne w bazie i odrzucane
  przy pierwszej synchronizacji.

Konflikty rozstrzyga LWW po `updated_at`, tak jak przy synchronizacji, a każdy
zapisany wiersz dostaje nowy `server_seq` — inaczej restore byłby niewidoczny dla
urządzeń, których kursor stoi już powyżej.

| Polecenie                                            | Co robi                                  |
| ---------------------------------------------------- | ---------------------------------------- |
| `pnpm --silent --filter @alphapump/api run export`     | archiwum systemowe na stdout             |
| `pnpm --silent --filter @alphapump/api run import [plik]` | import z pliku albo ze stdin          |
| `scripts/backup.sh`                                   | eksport → gzip → age → rclone + retencja |
| `scripts/restore.sh <plik\|zdalny>`                    | age -d → gunzip → import                 |
| `scripts/backup-drill.sh`                             | pełna próba odtworzenia z porównaniem    |

`--silent` nie jest ozdobą: pnpm wypisuje nagłówek skryptu na **stdout**, czyli
tym samym strumieniem, którym jedzie archiwum. `run` też nie — `pnpm import` jest
wbudowanym poleceniem pnpm.

Kopia idzie potokiem, bez pliku pośredniego, i jest szyfrowana **kluczem
publicznym** `age` do dwóch odbiorców: głównego i CI. Na minipc trafia wyłącznie
klucz publiczny, więc włamanie na serwer nie daje dostępu do kopii na Dysku.
Klucz prywatny nie leży ani na minipc, ani na Dysku obok kopii — menedżer haseł
i wydruk.

Comiesięczna próba odtworzenia (`.github/workflows/backup-restore.yml`) przechodzi
cały łańcuch na dwóch bazach i na końcu **porównuje dane z oryginałem** w postaci
kanonicznej: nie sprawdzamy, czy import się wykonał, ale czy powiązania autorów
ćwiczeń i właścicieli serii są po odtworzeniu takie same. Dane próby są fikcyjne
i powstają na miejscu; prawdziwy eksport nigdy nie trafia do CI.

### Panel administracyjny

```
cp apps/admin/.env.example apps/admin/.env    # wskaż adres API
pnpm --filter @alphapump/admin dev
```

Vite + React + TanStack Router + TanStack Query, komponenty w konwencji shadcn/ui.
Cztery ekrany: przegląd danych systemowych, konta, biblioteka i transfer danych.

Panel loguje się **tym samym** better-authem co aplikacja: rola administratora jest
polem konta, nie osobnym hasłem do narzędzia. Uprawnienia sprawdza przez `GET /me`
przy każdym wejściu, a nie z sesji — rolę można odebrać w trakcie jej trwania.
Sprawdzenie po stronie panelu nie jest zabezpieczeniem (pilnuje ich API przy
każdym żądaniu), lecz komunikatem: „brak uprawnień" zamiast pięciu ekranów z 403.

Ćwiczeniami i tagami panel zarządza **istniejącymi** endpointami CRUD — osobna
ścieżka zapisu byłaby drugim miejscem, w którym trzeba pamiętać o tombstonie,
`server_seq` i o regule „tag używany przez ćwiczenia nie znika". Własne endpointy
`/admin/*` dostały tylko te trzy rzeczy, których nigdzie indziej nie ma: lista
i edycja kont, liczby systemowe i porządkowanie cache'u re-rankera.

Kont panel nie usuwa i nie będzie: konto jest autorem ćwiczeń i właścicielem serii,
więc jego usunięcie albo osieroca cudze dane, albo wymaga kaskady niszczącej
historię grupy. Właściwą operacją jest blokada — dane zostają, człowiek nie wchodzi.
Nie da się też zablokować ani zdegradować **własnego** konta (panel jest jedynym
narzędziem do nadawania roli) ani ruszyć konta systemowego, które jest autorem
ćwiczeń wbudowanych.

`@alphapump/api-client` pozostaje nieużywany. Panel czyta odpowiedzi schematami
Zod z `@alphapump/core` — tymi samymi, którymi API je opisuje — więc kontrakt jest
już wspólny, a klient RPC dołożyłby zależność panelu od typów serwera bez nowej
gwarancji.

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

#### Logowanie serii

Ekran dnia (`src/screens/day.tsx`) obsługuje dzień bieżący i historyczny — to ten
sam komponent, wołany z dwóch tras. Zapis idzie przez `src/db/sets.ts`, gdzie
w jednej transakcji dzieją się trzy rzeczy: wiersz trafia do bazy, jego
identyfikator do outboxu, a pomiary przez front Pareto z `@alphapump/core`.
Dlatego informacja o rekordzie pojawia się natychmiast i **bez sieci**.

Rekordy indywidualne nie są nigdzie trzymane — liczy je `@alphapump/core` przy
rysowaniu ekranu, z serii leżących w bazie lokalnej. Tabela pochodna byłaby
drugim źródłem prawdy o czymś, co i tak liczy się w milisekundach, i wymagałaby
przeliczania po każdej edycji, każdym usunięciu i każdym pullu.

#### Kalendarz i wykresy

Kalendarz (`src/screens/calendar.tsx`) pokazuje miesiąc albo tydzień z liczbą
serii w kafelku dnia; wejście w dzień prowadzi do **tego samego** widoku, co dzień
bieżący. Osobnej osi czasu nie ma, bo pokazywałaby to samo drugi raz.

Ekran analityczny ćwiczenia przełącza metryki chipsami, a ich zestaw wynika
z typu logowania — przy biegu nie ma czego pokazywać na osi ciężaru. Wykres jest
narysowany zwykłymi `View` (`src/ui/chart.tsx`): biblioteka wykresów dołożyłaby
moduł natywny do budowania na obu platformach, a specyfikacja mówi o „prostych,
minimalistycznych wykresach". Siatka kalendarza i punkty wykresu powstają
w czystych modułach (`src/calendar.ts`, `src/chart-data.ts`), więc jedno i drugie
ma testy bez renderowania ekranu.

#### Ekrany, które czekają na sieć

Są trzy i każdy z tego samego powodu: pokazują **stan serwera**, którego nie da
się policzyć ani przechować lokalnie.

| Ekran                       | Dlaczego nie działa offline                                    |
| --------------------------- | -------------------------------------------------------------- |
| Rekordy globalne, rankingi  | liczą się z serii wszystkich, a cudze serie nigdy nie zjadą na telefon |
| Tokeny API                  | token weryfikuje serwer i tylko on wie, czy jeszcze żyje         |

Rekordy i rankingi czyta `src/remote/` — warstwa **wyłącznie do odczytu**, bez
cache'u i bez outboxu. Tokeny mają własną ścieżkę (`src/screens/api-keys.tsx`),
bo są jedynym zapisem sieciowym poza synchronizacją, a ich lista trzymana
lokalnie kłamałaby po unieważnieniu tokenu z innego urządzenia.

Wszystkie trzy pokazują brak łączności jako spokojne „offline" z przyciskiem
ponowienia — tymi samymi klasami błędów co synchronizacja. Reszta aplikacji,
łącznie z rekordami indywidualnymi, dalej działa w trybie samolotowym.

#### Ostrzeżenie o duplikacie i transfer danych

Formularz ćwiczenia scala ostrzeżenie z dwóch warstw (`src/duplicate-hint.ts`):
lokalnej, liczonej z pisowni i działającej offline, oraz serwerowej, która dokłada
dopasowanie po znaczeniu i uzasadnienie od modelu. Pytanie do serwera jest
opóźnione po ostatnim naciśnięciu klawisza i **cicho pomijane** przy braku
łączności — brak dodatku nie jest awarią, a ostrzeżenie i tak nigdy nie blokuje
zapisu.

Ekran „Eksport i import" (`src/screens/transfer.tsx`) działa bez sieci, bo telefon
ma u siebie całą historię właściciela. Import wchodzi do bazy lokalnej od razu,
a każdy zapisany wiersz ląduje w outboxie — bez tego odtworzone dane zniknęłyby
przy pierwszym pullu, bo serwer nigdy by o nich nie usłyszał.

#### Wymiana danych

Kolejka wysyłki (`outbox`) i kursor (`sync_state`) to tabele istniejące wyłącznie
po stronie telefonu. Wpis w outboxie nie niesie treści mutacji, tylko wskazuje
zmieniony wiersz — treść czytamy dopiero przy składaniu paczki, żeby na serwer
pojechało to, co użytkownik widzi na ekranie, a nie stan sprzed trzech edycji
zrobionych w tunelu.

Paczka pullu zapisuje się razem z kursorem, w jednej transakcji z
`PRAGMA defer_foreign_keys = ON`: wiersze jadą w kolejności `server_seq`, więc
seria potrafi wyprzedzić własne ćwiczenie, ale niespójność, której nie domyka
żaden wiersz z tej samej paczki, dalej nie przechodzi.

Wiersz przychodzący nie wygrywa automatycznie — przechodzi przez
`resolveSyncConflict` z `@alphapump/core`, czyli tę samą funkcję, którą serwer
rozstrzyga pushe. Bez tego odpowiedź na push cofałaby edycję zrobioną w trakcie
wysyłki.

Brak łączności jest stanem pracy, a nie awarią: serwer stoi za NetBirdem, więc
telefon z pełnym zasięgiem bywa poza VPN-em, a systemowy stan sieci i tak mówi
wtedy „połączony". Jedynym uczciwym testem jest próba dobicia się do API, więc
nieudane żądanie pokazujemy jako spokojne „offline", a ponawianie wycofuje się
dwukrotnie, do godzinnego sufitu.

Telefon rozmawia z API zwykłym `fetch`em (`src/sync/transport.ts`), a odpowiedzi
sprawdza schematami Zod z `@alphapump/core` — tymi samymi, którymi serwer
waliduje własne wyjście. Z `@alphapump/api-client` nie korzysta i nie skorzysta:
kontrakt jest już opisany schematami, a klient RPC dołożyłby zależność telefonu
od typów serwera, nie dając nowej gwarancji — dokładnie ten sam wniosek, do
którego doszedł panel administracyjny (patrz „Panel administracyjny").

Osobny workflow (`.github/workflows/ios-simulator.yml`) kompiluje aplikację na
symulator iOS. Buildy na symulator jako jedyne nie wymagają płatnego konta Apple
i wyłapują to, co przy pracy wyłącznie na Androidzie psuje się niezauważenie.

### Kontrakt identyfikatorów

`slug()` oraz deterministyczne identyfikatory ćwiczeń i tagów są objęte testami
golden (`packages/core/tests/golden/identifiers.ts`). Ich zmiana przepisuje
identyfikatory istniejących wierszy, więc czerwony test golden nie jest testem
do poprawienia — to sygnał, że zmiana wymaga świadomej decyzji i migracji.

### Segregacja zgłoszeń zwrotnych

Osobna usługa w Pythonie (`services/triage`), poza workspace pnpm i poza logiką
produktu. Raz na dobę czyta zgłoszenia zapisane przez `POST /feedback`,
klasyfikuje je modelem językowym i prowadzi dalej dwiema różnymi ścieżkami:

```
zgłoszenie z aplikacji  →  klasyfikacja (OpenRouter)
                              │
        ┌─────────────────────┴─────────────────────┐
      błąd                                    prośba o zmianę
        │                                            │
  issue na GitHubie                        wiadomość + wątek na Discordzie
  (ai-triage + bug)                                  │
        │                                    dyskusja o zakresie
  wiadomość + wątek                                  │
  na Discordzie                            ktoś oznacza bota w wątku
        │                                            │
        │                                  issue na GitHubie
        │                                  (ai-triage + enhancement)
        └──────────────┬─────────────────────────────┘
                       │
        etykieta `ai-triage` uruchamia Claude Code w Akcjach
                       │
                  pull request
                       │
        bot dokleja link do PR-ki w wątku tego zgłoszenia
```

Podział na dwie ścieżki jest sednem: błąd ma jedno poprawne rozwiązanie i nie
wymaga niczyjej decyzji, więc idzie prosto do naprawy. Prośba o zmianę wymaga
ustalenia zakresu — a zakres ustala zespół w wątku, nie model na podstawie
jednego zdania od użytkownika.

**Wykrywanie duplikatów.** Przed założeniem issue usługa pokazuje modelowi
otwarte zgłoszenia z etykietą `ai-triage` i pyta, czy to ta sama sprawa. Duplikat
błędu ląduje jako komentarz do istniejącego issue, duplikat prośby o zmianę —
jako wpis w trwającym wątku. Przy wątpliwości model ma odpowiadać „nie":
dwa issue scala się jednym kliknięciem, a zgubione zgłoszenie nie wraca.

**Skąd bot wie o pull requeście.** Odpytuje GitHuba co dwie minuty, zamiast
czekać na webhooka. Minipc stoi za VPN-em i GitHub nie ma jak się do niego dobić.
Skutek uboczny wychodzi na plus: PR-ka otwarta ręcznie zostanie zauważona tak
samo jak ta z Akcji, bo liczy się powiązanie po stronie GitHuba (`Fixes #N`),
a nie to, kto ją otworzył.

**Modele.** Klasyfikacja idzie na `openai/gpt-5.6-terra` (decyzja binarna na
krótkim tekście), pisanie treści issue na `anthropic/claude-sonnet-5` — bo tę
treść czyta potem agent, który ma zgłoszenie naprawić. W Akcjach model zależy od
etykiety: `bug` → Sonnet 5, `enhancement` → Opus 5.

#### Konfiguracja

Sekrety wchodzą przez `deploy/.env` (wzór w `deploy/.env.example`):

| Zmienna               | Skąd wziąć                                                                                   |
| --------------------- | -------------------------------------------------------------------------------------------- |
| `DISCORD_BOT_TOKEN`   | https://discord.com/developers/applications → Bot → Reset Token                                |
| `DISCORD_CHANNEL_ID`  | tryb dewelopera w Discordzie → PPM na kanale → Kopiuj ID kanału                                |
| `TRIAGE_GITHUB_TOKEN` | token fine-grained do tego repozytorium: Issues R/W, Pull requests R, Contents R              |
| `OPENROUTER_API_KEY`  | ten sam klucz, którego używa API                                                               |

Bot na Discordzie musi mieć **włączoną intencję „MESSAGE CONTENT"** (Bot →
Privileged Gateway Intents). Bez niej treść wiadomości przychodzi pusta i issue
z dyskusji powstałoby na podstawie samych pustych wypowiedzi. Uprawnienia na
kanale: wysyłanie wiadomości, tworzenie wątków publicznych, wysyłanie w wątkach,
czytanie historii wiadomości.

Po stronie GitHuba potrzebne są jeszcze dwie rzeczy:

```bash
# 1. Etykiety — GitHub odrzuca żądanie z nieznaną etykietą, więc bez tego
#    pierwszy przebieg wywala się na każdym zgłoszeniu.
scripts/triage-labels.sh Dombearx/AlphaPump

# 2. Token subskrypcji Claude Code dla Akcji — generowany lokalnie, nie jest
#    kluczem API i nie obciąża rachunku za API.
claude setup-token
gh secret set CLAUDE_CODE_OAUTH_TOKEN --repo Dombearx/AlphaPump
```

#### Uruchomienie

Usługa wstaje razem z resztą stosu (`docker compose up -d --build`) jako czwarty
kontener. Katalog ze zgłoszeniami montuje **tylko do odczytu** — stan „co już
przejrzane" trzyma we własnej bazie SQLite na osobnym woluminie, więc pomyłka
w kodzie nie może zabrać jedynej kopii tego, co napisali użytkownicy.

Brak sekretu nie zatrzymuje tu całego wdrożenia, inaczej niż przy haśle bazy czy
`BETTER_AUTH_SECRET`. Powód jest techniczny: Compose interpoluje cały plik przy
wczytaniu, więc zapis `${X:?…}` blokowałby także polecenia dotyczące pozostałych
usług i przebieg CI, który stawia stos bez Discorda. Sprawdzenie siedzi zamiast
tego w samej usłudze — przy starcie kończy proces i wypisuje nazwę brakującej
zmiennej. Objawem jest kontener `triage` w pętli restartów, z powodem
w `docker compose logs triage`.

```bash
# Podgląd pracy
docker compose logs -f triage

# Przegląd na żądanie, bez czekania na 3:17. Na czas tego polecenia do Discorda
# zalogowane są dwie sesje tego samego bota (usługa i to wywołanie), więc nie
# oznaczaj go w wątku, dopóki polecenie nie skończy pracy.
docker compose exec triage python -m alphapump_triage once

# Próba na sucho: klasyfikacja i duplikaty liczą się naprawdę, ale nic nie
# powstaje — stan idzie do pamięci, więc zgłoszenia nie zostaną odhaczone.
TRIAGE_DRY_RUN=true docker compose up triage
```

Zgłoszenie, którego nie udało się przetworzyć (awaria OpenRoutera, GitHuba),
wraca w kolejnym przebiegu — do trzech podejść, potem zostaje odłożone na bok
z powodem zapisanym w bazie stanu. Uszkodzony plik JSON odpada od razu: jutro
nie będzie bardziej poprawny.

#### Rozwój

```bash
cd services/triage
uv sync --extra dev
uv run pytest
uv run ruff check . && uv run ruff format .
```

Logika siedzi w `service.py` i nie wie nic o HTTP, SQL-u ani o Discordzie —
dostaje trzy porty (`Llm`, `IssueTracker`, `Chat`) w konstruktorze. Dlatego testy
podstawiają atrapy zamiast udawać serwer, a wymiana Discorda na cokolwiek innego
jest jednym plikiem.
