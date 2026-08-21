# Wdrożenie i eksploatacja

Jak stoi produkcja i co się z nią robi na co dzień: pierwsze uruchomienie stosu,
aktualizacje, serwer wydań, kopie zapasowe, odtworzenie po awarii, wydanie
aplikacji na Androida i sprawdzanie stanu.

Ten dokument jest **opisem**, nie przepisem. Kto stawia to od zera po raz
pierwszy, idzie krok po kroku za [`uruchomienie.md`](uruchomienie.md)
i wraca tutaj po szczegóły. *Dlaczego* akurat tak — a zwłaszcza dlaczego bez
certyfikatu — mówi [`stack_technologiczny.md`](stack_technologiczny.md).

Docelowa infrastruktura to minipc w sieci NetBird: Docker Compose z PostgreSQL 17
(pgvector, `pg_trgm`), API oraz panelem za Caddym, bez TLS.

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
| `update_server.py`, `alphapump-update-server.service` | automatyczne wdrożenie po mergu do `main` i przyjmowanie wydań aplikacji — patrz „Serwer aktualizacji" niżej |
| `apk/` | wydania na Androida: pliki `.apk` i manifest `latest.json`, oddawane pod `/alphapump/download` |
| `ota/` | paczki JavaScriptu i ich pliki, oddawane pod `/alphapump/ota`; opisy wydań czyta z nich API |

Kontenery są trzy, nie cztery: panel to zbiór plików statycznych, a nie proces,
więc jest wpieczony w obraz Caddy'ego. Osobny kontener musiałby albo uruchomić
drugi serwer HTTP, albo podać pliki wolumenem — i wtedy aktualizacja panelu
zależałaby od kolejności startu.

### Zanim zaczniesz

Na minipc: Docker z wtyczką Compose, `git`, `uv` (woła go serwer aktualizacji),
a `age` i `rclone` dopiero wtedy, gdy kopie mają wychodzić poza minipc — kopia do
katalogu lokalnego nie potrzebuje żadnego z nich. Użytkownik, na którym to stoi, musi
należeć do grupy `docker` i być właścicielem katalogu repozytorium. W VPN:
NetBird uruchomiony i minipc widoczny z telefonów. Adres
minipc w sieci NetBird (`ip -4 addr show wt0` albo panel NetBirda) jest tą samą
wartością, która wejdzie do `BETTER_AUTH_URL` i do `EXPO_PUBLIC_API_URL` przy
budowaniu aplikacji — pomyłka tutaj kończy się aplikacją, która wygląda
poprawnie i nie łączy się z niczym.

Dostęp do internetu jest minipc potrzebny (obrazy Dockera, klucze publiczne
Google przy weryfikacji `idToken`, OpenRouter, Dysk Google), ale API na zewnątrz
nie wychodzi: nie ma przekierowania portu na routerze i nie ma go czym dodać.

### Pierwsze uruchomienie

Katalog repozytorium jest dowolny — nic w kodzie nie zna tej ścieżki (Compose
liczy ścieżki względne od `deploy/`, serwer aktualizacji od katalogu
repozytorium). Niżej `~/AlphaPump`, bo klon w katalogu domowym należy do tego
samego użytkownika, na którym stoi serwer aktualizacji. Bezwzględną ścieżkę
trzeba wpisać w trzech miejscach: `WorkingDirectory` w
`deploy/alphapump-update-server.service`, wpisy w `deploy/crontab.example`
i `ALPHAPUMP_EXPORT_CMD`/`ALPHAPUMP_IMPORT_CMD` z `deploy/backup.env.example`.

```
git clone <adres-repozytorium> ~/AlphaPump
cd ~/AlphaPump/deploy
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
- cron kopii zapasowych działa, a odtworzenie zostało wykonane na sucho —
  pamiętając, że kopia w `BACKUP_DIR` na minipc nie przeżyje utraty minipc.

### Aktualizacja

```
cd ~/AlphaPump
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

### Serwer aktualizacji

Powyższe kroki da się też wywołać zdalnie, zamiast wpisywać je ręcznie po SSH.
`deploy/update_server.py` wystawia na porcie 40002 sześć tras:

| Trasa | Co robi |
| ----- | ------- |
| `GET /health` | potwierdza, że serwer żyje, bez wdrażania czegokolwiek |
| `GET /update` | `git pull`, a potem `docker compose -f deploy/docker-compose.yml up -d --build --force-recreate` |
| `POST /apk` | przyjmuje wydanie aplikacji: plik `.apk` i manifest, kładzie oba w katalogu `/alphapump/download` |
| `GET /apk` | oddaje manifest wydania, które telefony widzą w tej chwili |
| `POST /ota` | przyjmuje paczkę JavaScriptu (wynik `expo export`) dla jednej pary platforma/odcisk |
| `GET /ota` | oddaje listę paczek, które telefony dostają w tej chwili |

`POST /apk` woła `android-release.yml` po zbudowaniu pliku. Nazwa pliku
z manifestu jest sprawdzana wzorcem, a nie tylko oczyszczana — staje się
ścieżką w katalogu wydań, więc traktujemy ją jak dane z sieci, którymi jest.
Plik ląduje pod nazwą tymczasową i dopiero gotowy jest przenoszony na miejsce,
a `latest.json` powstaje **po** nim: telefon nie ma jak zobaczyć manifestu
wskazującego na plik, którego jeszcze nie ma, ani pobrać połówki pakietu.
Starsze wydania są usuwane, zostają trzy ostatnie — inaczej dysk minipc
zapchałby się plikami, których nikomu już nie zaproponujemy.

**Publikowanie wymaga tokenu**, czytanie nie. Ta asymetria jest sednem: `POST /apk`
i `POST /ota` sprawdzają `Authorization: Bearer …` przeciwko
`UPDATE_SERVER_PUBLISH_TOKEN`, a telefony czytają manifesty bez niczego.

Powód jest konkretny i pojawił się razem z OTA. Przy plikach `.apk`
autoryzacja nigdy nie była jedyną linią: Android odmawia podmiany pakietu
podpisanego innym kluczem, więc plik podłożony przez kogokolwiek innego niż
workflow po prostu się nie instaluje. Paczka JavaScriptu nie ma odpowiednika
tego sprawdzenia — aplikacja uruchamia to, co serwer poda dla jej odcisku. Bez
tokenu każdy, kto dosięgnie tego portu w VPN, wysłałby dowolny kod na wszystkie
telefony w grupie; przy pakietach było to niemożliwe. Token przywraca własność,
którą wcześniej dawał podpis, za darmo.

Nieustawiony token znaczy **wyłączone publikowanie**, a nie otwarte: obie trasy
oddają 503 i mówią, czego brakuje. Czytanie i `/update` działają dalej, więc
zapomnienie o nim nie odcina kanału wdrożeniowego. Sekret trzyma się w drop-inie
systemd (`sudo systemctl edit alphapump-update-server`), nie w pliku jednostki,
bo ten jest w repozytorium.

Token leży na minipc, więc nie przeżywa przejęcia samego minipc. Zamknięcie
także tego znaczy podpisywanie paczek tam, gdzie jest klucz — w workflow wydania,
nie tutaj — a to pociąga za sobą budowanie manifestu też tam. To zmiana kształtu,
nie flaga, i nie jest tego warta, dopóki całość stoi na jednym minipc, który i
tak trzyma bazę.

`POST /ota` działa podobnie do `POST /apk`, tylko na katalogu `/alphapump/ota`. Archiwum
rozpakowuje się plik po pliku, z limitem liczonym **po** rozpakowaniu i z
odrzuceniem wszystkiego, co nie jest zwykłym plikiem — `extractall` nie jest
użyte nigdzie, bo pisze przez ścieżki bezwzględne, segmenty `..` i dowiązania
wychodzące z drzewa, a archiwum przychodzi siecią. Pliki paczki nazywają się
hashem własnej treści i leżą wspólnie dla wszystkich wydań, więc dwie kolejne
paczki różniące się samym JavaScriptem współdzielą komplet obrazków i czcionek.
Sprzątanie jest „znacz i zamiataj" po wszystkich opublikowanych opisach, a nie
„skasuj to, czego używało poprzednie wydanie": ten sam plik bywa potrzebny
kilku odciskom naraz. Opis, którego nie da się odczytać, wstrzymuje sprzątanie
w całości — pełny dysk jest odwracalny, skasowany plik paczki nie.

Osobno sprzątane są **przerwane wysyłki**. Plik pod nazwą tymczasową zostaje na
dysku, gdy transfer urwie się w połowie — zerwane łącze VPN, restart usługi,
proces ubity bez szansy na posprzątanie po sobie — a liczy się w dziesiątkach
megabajtów tak samo jak gotowe wydanie. Sprzątanie idzie **przed** przyjęciem
kolejnej wysyłki, nie po: na pełnym dysku każda wysyłka kończy się błędem, więc
sprzątanie odpalane po udanej nie odpaliłoby się już nigdy.

Stoi bezpośrednio na gospodarzu, nie w kontenerze, żeby móc wołać `git`
i `docker` bez montowania gniazda Dockera do środka. To samodzielny skrypt
z zależnościami zadeklarowanymi inline (PEP 723 — `fastapi`, `uvicorn`,
`python-multipart`), więc `uv run deploy/update_server.py` instaluje tylko je do
osobnego środowiska, bez dotykania `pnpm`/Turborepo, których nie potrzebuje.

Instalacja jako usługa systemd, żeby przeżyła restart i awarię. We wzorze
jednostki `WorkingDirectory` to `/home/domin/AlphaPump` — podstaw ścieżkę
swojego checkoutu, bezwzględną, bo `~` w systemd się nie rozwija. Właścicielem
repozytorium musi być użytkownik z `User=`: usługa robi w nim `git pull`
i `docker compose`:

```bash
sudo cp deploy/alphapump-update-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alphapump-update-server
```

`systemctl status alphapump-update-server` pokazuje, czy działa, a
`journalctl -u alphapump-update-server -f` śledzi logi. Użytkownik, na którym
stoi usługa, musi należeć do grupy `docker`.

Trasy nie mają własnego uwierzytelnienia — mają być osiągalne wyłącznie przez
prywatną sieć (NetBird), tak jak z `.github/workflows/deploy.yml`, który woła
serwer po każdym mergu do `main`. Ten workflow potrzebuje trzech sekretów
w ustawieniach repozytorium: `NETBIRD_ACCESS_KEY`, `NETBIRD_MANAGEMENT_URL`
(te same wartości, których używa analogiczny mechanizm w LivingBotFramework)
oraz `ALPHAPUMP_UPDATE_SERVER_URL` — adres serwera aktualizacji w sieci
NetBird, z `/update` na końcu, np. `http://100.64.0.1:40002/update`. Wydanie
aplikacji korzysta z tych samych trzech; pozostałe trasy wylicza sobie z adresu.

Przy `POST /apk` brak uwierzytelnienia jest **drugą** linią, a nie jedyną.
Pierwszą jest podpis pakietu: Android odmawia podmiany zainstalowanej aplikacji
na plik podpisany innym kluczem, więc APK wgrany tu przez kogokolwiek poza
wydaniem z CI po prostu się nie zainstaluje. Dlatego własny klucz podpisujący
jest wymagany — patrz niżej.

### Kopie zapasowe

Zestaw jest z etapu 14 — eksport JSON → gzip → (`age`) → katalog lokalny albo
`rclone` na Dysk Google — a wdrożenie dokłada mu tylko jedną rzecz: eksport idzie
**wewnątrz kontenera**, bo baza nie wystawia portu na gospodarza.

```
sudo install -D -m 600 deploy/backup.env.example /etc/alphapump/backup.env
sudo nano /etc/alphapump/backup.env      # BACKUP_DIR (albo remote rclone i klucze age)
crontab -e                               # wpisy z deploy/crontab.example
```

Domyślny `BACKUP_DIR` to katalog na minipc, **poza repozytorium**: w repozytorium
serwer aktualizacji robi `git pull`. Skrypt zakłada go z prawami `700` i daje
plikom `600` — przy kopii nieszyfrowanej to jedyna ochrona.

Przy wariancie zdalnym na minipc trafia **wyłącznie klucz publiczny** `age`.
Klucz prywatny mieszka w menedżerze haseł i na wydruku — nigdy na maszynie,
której kopie dotyczą, i nigdy na Dysku obok nich.

Pierwszą kopię zrób ręcznie i sprawdź, że doszła:

```
set -a; . /etc/alphapump/backup.env; set +a
scripts/backup.sh
ls -l "$BACKUP_DIR"                      # zdalnie: rclone ls "$RCLONE_REMOTE"
```

### Odtworzenie po awarii

Odtworzenie to **ta sama ścieżka**, którą chodzi import danych w aplikacji —
dlatego nie zardzewieje między awariami.

```
# 1. Czysty stos. `down --volumes` kasuje bazę: to jest właśnie ten moment.
cd ~/AlphaPump
docker compose -f deploy/docker-compose.yml down --volumes
docker compose -f deploy/docker-compose.yml up --detach --wait

# 2. Import wewnątrz kontenera; rozpakowanie zostaje na gospodarzu.
export ALPHAPUMP_IMPORT_CMD="docker compose -f $HOME/AlphaPump/deploy/docker-compose.yml exec -T api node /app/apps/api/dist/cli/import.js"
scripts/restore.sh ~/alphapump-backups/alphapump-2026-08-10.json.gz

# 2'. Kopia zaszyfrowana: klucz prywatny — przyniesiony, nie znaleziony na maszynie.
export AGE_IDENTITY=/media/pendrive/klucz-alphapump.txt
scripts/restore.sh gdrive:alphapump-backups/alphapump-2026-08-10.json.gz.age

# 3. Sprawdzenie.
deploy/smoke.sh http://localhost
```

O odszyfrowaniu decyduje **rozszerzenie pliku**, a nie zmienna środowiskowa:
`.age` żąda `AGE_IDENTITY`, zwykły `.json.gz` wchodzi wprost. Dzięki temu jedno
polecenie obsługuje kopie z obu wariantów, także wtedy, gdy w katalogu leżą obok
siebie po przejściu z jednego na drugi.

Import sam uruchamia migracje i seed przed wczytaniem archiwum, więc celuje
w bazę pustą i nie wymaga niczego przygotowanego wcześniej.

Kopia, której nigdy nie odtworzono, nie jest kopią: `backup-restore.yml` przechodzi
cały ten łańcuch raz w miesiącu na danych fikcyjnych i porównuje wynik
z oryginałem. Na sucho, na prawdziwej kopii, przechodzi się przez niego przy
uruchamianiu minipc — do bazy **testowej**, nie do produkcyjnej.

### Aplikacja na Androida

Adres API jest **wkompilowany w wydanie**: zmienne `EXPO_PUBLIC_*` wchodzą do
bundla, a z adresu wyliczają się jeszcze wyjątek ATS (iOS) i
`network_security_config` (Android). Zmiana adresu to więc nowe wydanie, a nie
przestawienie czegoś w aplikacji.

#### Skąd biorą się wydania

Wydanie robi `.github/workflows/android-release.yml` przy każdym mergu do
`main`, **który ruszył cokolwiek wchodzącego do pliku `.apk`** — samą aplikację
(`apps/mobile/`), pakiety współdzielone (`packages/`) albo manifesty decydujące
o wersjach zależności. Zmiana w panelu, w API, w segregacji zgłoszeń czy
w `deploy/` wydania nie wywołuje: nie zmieniłaby ani bajtu w pliku, a kosztuje
kilkanaście minut gradle'a i numer wersji. Rozstrzyga o tym osobne zadanie
`zmiany`, a nie filtr `paths` — ten obejmowałby także pushe z tagiem, więc tag
postawiony na commicie ruszającym wyłącznie `deploy/` przestałby wydawać
cokolwiek. Wydanie z tagu `v*` i uruchomienie ręczne przechodzą przez tę bramkę
bez pytania. Adres API bierze się ze zmiennej
repozytorium `EXPO_PUBLIC_API_URL` (przy uruchomieniu ręcznym — z pola
`api_url`).

Dalej workflow rozdziela się na dwie drogi, a wybiera między nimi zadanie
`plan`:

| | Paczka JavaScriptu (OTA) | Pełny pakiet `.apk` |
| --- | --- | --- |
| Kiedy | warstwa natywna bez zmian — prawie zawsze | podbicie SDK, nowa zależność natywna, zmiana wtyczki konfiguracyjnej |
| Ile waży | ~7 MB | ~35 MB |
| Ile trwa wydanie | kilka minut | kilkanaście minut gradle'a |
| Co robi użytkownik | nic; aplikacja podmienia się sama przy następnym otwarciu | pobiera przeglądarką i instaluje |

O drodze nie decyduje ani człowiek, ani lista ścieżek, tylko **odcisk warstwy
natywnej**: `runtimeVersion` liczony przez `expo-updates` z konfiguracji
i wtyczek. `plan` porównuje odcisk bieżącego commita z odciskiem wydania
stojącego w tej chwili na minipc (`runtimeVersion` w `latest.json`, czytany
przez `GET /apk`). Równe odciski znaczą, że telefony mają odpowiedni pakiet
i wystarczy im paczka. Brak odpowiedzi z minipc znaczy „nie wiem" i wypada na
`.apk`: wydanie pełne jest wolniejsze, ale zawsze poprawne, a paczka wydana pod
nieznany odcisk kończy się aplikacją, która nie wstaje.

Odcisk jest **przypięty** dla obu budów zmienną
`EXPO_UPDATES_FINGERPRINT_OVERRIDE`, i to jest konieczne, nie ostrożnościowe:
`plan` liczy go w projekcie zarządzanym, a w zadaniu `apk` `prebuild` tworzy
katalog `android/` i odcisk zaczyna się liczyć z plików natywnego projektu,
czyli wychodzi inny. Pakiet niósłby wtedy jedną wartość, `latest.json` drugą,
a następne wydanie porównałoby się z drugą i błędnie uznało, że wystarczy
paczka.

Zadanie wchodzi do NetBirda i wysyła wynik na `POST /ota` albo `POST /apk`
serwera aktualizacji. Nic nie trzeba kopiować ręcznie i nikt nie potrzebuje
konta w GitHubie.

Ta sama droga co wdrożenie backendu (`deploy.yml`), więc żaden nowy kanał ani
sekret nie przybywa. Ręcznie, gdyby zaszła potrzeba, wygląda to tak:

```
EXPO_PUBLIC_API_URL=http://domin-server.iron.sq ANDROID_VERSION_CODE=99 \
  pnpm --filter @alphapump/mobile run prebuild
cd apps/mobile/android && ./gradlew assembleRelease
scp .../app-release.apk minipc:AlphaPump/deploy/apk/alphapump-99.apk
```

— przy czym plik dołożony `scp`-em jest do pobrania pod
`/alphapump/download/alphapump-99.apk`, ale **nie zostanie zaproponowany jako
aktualizacja**, dopóki nie opisze go `latest.json`. Manifest liczy się razem
z plikiem właśnie po to, żeby te dwie rzeczy nie mogły się rozjechać.

#### Jak telefon dowiaduje się o aktualizacji

Katalog `/alphapump/download` zawiera, obok plików `.apk`, manifest `latest.json`:

```json
{
  "versionCode": 57,
  "versionName": "0.1.0",
  "file": "alphapump-57.apk",
  "size": 62443008,
  "md5": "…",
  "sha256": "…",
  "runtimeVersion": "8b28169f06ae982e63c7e60fa2817c53a8fb72d7",
  "releasedAt": "2026-08-15T09:12:44Z",
  "notes": "Poprawki synchronizacji"
}
```

(`runtimeVersion` służy tu wyłącznie **następnemu przebiegowi** workflow —
telefony odczytują swój odcisk z własnego pakietu.)

Aplikacja pyta o ten plik przy starcie i przy każdym powrocie na wierzch (nie
częściej niż raz na kwadrans), porównuje `versionCode` z własnym i przy nowszym
pokazuje okno „Version X — Download / Not now". „Nie teraz" wycisza **to jedno**
wydanie; kolejne pyta od nowa. Po zgodzie otwiera się przeglądarka i dalej
prowadzi już system: pobranie, zgoda na nieznane źródła, instalator. Aplikacja
nie bierze w tym udziału i nie ma po temu żadnego uprawnienia. Nieudane
sprawdzenie manifestu nie pokazuje niczego — minipc bywa poza zasięgiem
częściej, niż jest w nim.

#### Jak telefon dostaje paczkę JavaScriptu

Osobną drogą i bez pytania kogokolwiek o cokolwiek. `expo-updates` pyta przy
starcie o `/updates/manifest`, podając w nagłówkach platformę i swój odcisk
warstwy natywnej; API składa odpowiedź z opisu leżącego w `deploy/ota/`
i oddaje ją w formacie protokołu Expo Updates. Paczka pobiera się w tle,
a aplikacja **nie czeka** na to przy starcie (`fallbackToCacheTimeout: 0`) —
ta sama zasada, na której stoi baza lokalna: ekran nigdy nie czeka na sieć.

Pobrana paczka nie uruchamia się natychmiast: podmiana kodu pod palcami kogoś,
kto właśnie zapisuje serię, jest gorsza niż aktualizacja godzinę później.
`expo-updates` uruchomi ją przy następnym otwarciu aplikacji, a kto chce
wcześniej, dostaje okno „Update ready — Restart".

Brak paczki dla danego odcisku **nie jest błędem**: to normalny stan telefonu
z wydaniem natywnym, do którego nikt jeszcze nie wypuścił poprawki. Aplikacja
uruchamia wtedy paczkę wbudowaną w `.apk`. Tak samo kończy się uszkodzony opis
wydania — i to jest celowe, bo alternatywą byłaby aplikacja, która nie wstaje.

#### Dwa sposoby, na które paczka nie dojeżdża po cichu

Oba wyglądają dla użytkownika tak samo — „Update ready, restart to apply",
restart, brak zmian, to samo okno przy następnym otwarciu — i oba biorą się
z opisu wydania, a nie z sieci.

**Data wydania, nie identyfikator.** Klient nie porównuje identyfikatorów,
żeby zdecydować, czy proponować paczkę: porównuje `createdAt` z datą zapamiętaną
przy pobraniu. Wydanie wgrane ponownie z **tą samą treścią** ma ten sam
identyfikator (liczy się z zawartości), więc telefon ma je już na dysku — ale
z nową datą jest dla niego na zawsze „nowsze" od kopii, którą ma. Stąd
`POST /ota` zachowuje `createdAt` wydania bieżącego, gdy identyfikator się nie
zmienił, a telefon dodatkowo nie proponuje restartu do paczki, która już chodzi
(`apps/mobile/src/update/pending.ts`).

**`fileExtension` przy każdym zasobie.** Android czyta je z manifestu przez
`getString`, więc brak kończy się **cichym** wyrzuceniem tego zasobu z wydania
— paczka dojeżdża bez swoich obrazków i czcionek; iOS czyta je przez
`requiredValue` i odrzuca wtedy cały manifest. Wyjątkiem jest sama paczka
JavaScriptu: ta nie ma rozszerzenia i mieć nie powinna, bo telefon trzyma ją pod
samym kluczem. `POST /ota` odmawia przyjęcia eksportu, w którym zasób nie ma
rozszerzenia — nieudane wydanie jest lepsze niż wydanie, które dojeżdża niepełne.

#### Co właściwie chodzi na telefonie

Sekcja **Version** na ekranie konta. Numer pakietu (`versionName` i
`versionCode`) sam z siebie **niczego tu nie rozstrzyga**: wydanie OTA go nie
rusza, bo pakiet zostaje ten sam. Rozstrzyga wiersz niżej — data i godzina
powstania paczki, którą aplikacja w tej chwili wykonuje. Porównuje się ją
z czasem zadania „Wydanie paczki JavaScriptu" w przebiegu wydania i wiadomo,
czy telefon dostał to, co wyszło. Obok stoją skrócony identyfikator paczki
i odcisk warstwy natywnej — ten drugi mówi, **które** paczki w ogóle tu
dojadą.

Osobno wypisany jest start awaryjny: `expo-updates` wraca wtedy do paczki
wbudowanej w pakiet, bo pobrana nie wstała, i więcej jej nie uruchomi. To
jedyny stan, w którym „zrestartowałem po aktualizacji, a zmiany nie widać" jest
awarią, a nie nieporozumieniem — i bez tego wiersza wygląda dokładnie jak
zwykły start. Odkręca go dopiero nowsze wydanie.

Od strony minipc to samo widać bez telefonu: `GET /ota` na serwerze
aktualizacji wypisuje, co jest w tej chwili podawane dla każdego odcisku
(identyfikator, `createdAt`, liczba plików), a `GET /apk` — jaki pakiet stoi
w katalogu wydań.

Z telefonu podpiętego kablem to samo widać w logu systemu — ale **nie** pod
filtrem `ReactNativeJS:E`: `expo-updates` pisze pod własną etykietą i na
poziomie informacyjnym, a nieudany start paczki nie jest wywaleniem procesu.

```bash
adb logcat -c && adb logcat -s expo-updates:V ExpoUpdates:V ReactNative:V \
  ReactNativeJS:V AndroidRuntime:E
```

Kod: `apps/mobile/src/update/` (`manifest.ts` — kształt i porównanie wersji
wydania natywnego, `pending.ts` — czy restart w ogóle coś zmieni, `ota.ts`
i `expo.ts` — jedyne warstwy dotykające systemu, `use-update.ts` — wpięcie
w cykl życia) i `src/ui/update-prompt.tsx`; po stronie
serwera `apps/api/src/updates/` i `apps/api/src/routes/updates.ts`. Trasa
`/alphapump/download/*` nie wymaga zmian w `Caddyfile`: wpada do `file_server`,
tak jak wszystko spoza listy `@api`. `/updates/*` wymaga — jest obsługiwana
przez API, więc jest na liście `@api`, czego pilnuje `apps/api/tests/deploy.test.ts`.

#### Pierwsze uruchomienie, po kolei

1. **Klucz podpisujący do sekretów repozytorium** — bez niego zadanie wydania
   przerywa się celowo (szczegóły niżej).
2. **Zmienna repozytorium `EXPO_PUBLIC_API_URL`** = adres stosu w VPN.
3. **Merge do `main`.** `deploy.yml` woła `/update`, więc stos wstaje z nowym
   `Caddyfile` i nowymi woluminami `/srv/alphapump/download` oraz
   `/srv/alphapump/ota` (ten drugi wchodzi też do kontenera API jako `/data/ota`,
   tylko do odczytu — API składa z niego manifest, ale nigdy w nim nie pisze).
4. **Restart serwera aktualizacji na minipc:**

   ```bash
   sudo systemctl restart alphapump-update-server
   ```

   Tego kroku **nie da się pominąć przy tym jednym wdrożeniu**. `/update` robi
   `git pull` i przestawia kontenery, ale nie przeładowuje samego siebie —
   usługa systemd trzyma w pamięci kod sprzed aktualizacji repozytorium, więc
   tras `POST /apk` i `POST /ota` jeszcze nie zna. Restart wciąga też nową
   zależność (`python-multipart`), bo `uv run` czyta deklarację z nagłówka
   skryptu. Zadanie wydania sprawdza to przed wysłaniem pliku i mówi wprost, co
   zrobić, zamiast zwrócić niejasne 404.
5. **Pierwsza instalacja ręcznie** — z telefonu w VPN wejdź na
   `http://<adres-w-vpn>/alphapump/download/` i pobierz `.apk` z listy.
   Aktualizuje się aplikacja, która już umie się aktualizować; do wersji sprzed
   tej zmiany nie ma się co dobijać.

Od tego momentu każdy merge do `main` daje wydanie. Prawie każde jedzie paczką
JavaScriptu i podmienia się samo przy następnym otwarciu aplikacji — bez pytania
i bez instalatora. Wydanie ruszające warstwę natywną telefony **proponują**,
a instalacja nie jest cicha i nie będzie: użytkownik potwierdza ją w oknie
aplikacji, potem pobiera plik przeglądarką, a system pyta o zgodę na podmianę
pakietu. Androida nie da się o to nie zapytać i nie jest to nasza decyzja.

Pierwsze wydanie po tej zmianie musi iść pełnym pakietem — `plan` nie ma z czym
porównać odcisku, więc wybierze `.apk` sam. Dopiero telefony z tym pakietem
zaczną dostawać paczki.

#### Rzeczy, które trzeba ogarnąć raz

- **Klucz podpisujący jest na zawsze — i jest wymagany.** Bez sekretu
  `ANDROID_KEYSTORE_BASE64` zadanie **przerywa się z błędem**, zamiast po cichu
  podpisać wydanie kluczem deweloperskim z szablonu React Native. Ten klucz ma
  publicznie znaną część prywatną i ten sam odcisk we wszystkich projektach na
  świecie, więc przy aktualizacji pobieranej po HTTP byłby otwartą furtką:
  dowolny plik podpisany tak samo zainstalowałby się *na miejsce* aplikacji.
  Drugi powód jest praktyczny — podpisu nie da się później zmienić bez
  odinstalowania aplikacji na *każdym* telefonie.

  ```
  keytool -genkeypair -v -keystore alphapump.keystore -alias alphapump \
    -keyalg RSA -keysize 4096 -validity 10000
  base64 -w0 alphapump.keystore     # → sekret ANDROID_KEYSTORE_BASE64
  ```

  Do sekretów repozytorium wchodzą jeszcze `ANDROID_KEYSTORE_PASSWORD`,
  `ANDROID_KEY_ALIAS` i `ANDROID_KEY_PASSWORD`. Sam plik `.keystore` trzeba
  zachować poza repozytorium — razem z kluczem `age` od kopii zapasowych.

- **Zgoda na „nieznane źródła" jest jednorazowa i dotyczy przeglądarki.**
  Android pyta o nią dla aplikacji, która plik podaje — a plik `.apk` podaje
  zawsze przeglądarka, także przy aktualizacji warstwy natywnej. AlphaPump
  **nie** deklaruje `REQUEST_INSTALL_PACKAGES` i nie oddaje niczego
  instalatorowi: odkąd zwykłe wydania jadą paczką JavaScriptu, uprawnienie
  obsługiwałoby parę zdarzeń w roku, a jest najgroźniejszym, o jakie ta
  aplikacja mogłaby poprosić.

- **`versionCode` musi rosnąć** (dotyczy wyłącznie wydań `.apk` — paczki
  JavaScriptu rozróżnia identyfikator liczony z ich treści). W CI to numer
  przebiegu; przy budowaniu
  lokalnym ustaw `ANDROID_VERSION_CODE` sam, i to wyżej niż ostatni z CI —
  inaczej telefon odmówi instalacji, a komunikat mówi o niezgodności, nie
  o numerze.

- **Pierwsze wydanie trzeba zainstalować ręcznie.** Aktualizuje się aplikacja,
  która już umie się aktualizować — do wersji sprzed tej zmiany trzeba wejść
  z przeglądarki na `http://domin-server.iron.sq/alphapump/download/` i pobrać plik.

- **Telefon musi rozwiązywać nazwę serwera.** `domin-server.iron.sq` idzie
  z DNS-u NetBirda; jeśli aplikacja łączy się z API, pobieranie też zadziała,
  bo to ten sam host i ten sam wyjątek cleartext (`config/network.js`).

- **iOS tą drogą nie pojedzie.** Sideload z własnego serwera wymaga certyfikatu
  enterprise albo TestFlighta. Aplikacja rozpoznaje to sama i poza Androidem
  nawet nie pyta o manifest. iOS wchodzi w etapie 16, razem z kontem Apple
  Developer.

Konfiguracji EAS repozytorium nie zawiera — wydanie idzie z projektu natywnego
generowanego przez `prebuild`.

### Sprawdzanie stanu

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
