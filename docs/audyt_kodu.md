# Audyt kodu AlphaPump

Rejestr znalezisk z przeglądu całego repozytorium — jakość kodu, architektura,
wdrożenie, bezpieczeństwo — z myślą o dołożeniu wersji PWA.

Zakres: 48 127 linii kodu (TypeScript, Python, shell), 74 pliki testów, 8 workflow
GitHub Actions, stos wdrożeniowy z `deploy/`. Weryfikacja: `pnpm lint`,
`pnpm typecheck`, `pnpm build` i `pnpm test` — 8 zadań Turbo, wszystkie zielone,
256 testów w samym API.

Nic w tym repozytorium nie jest wystawione do publicznego internetu, więc żadne
znalezisko nie jest krytyczne w sensie „naprawiaj dziś w nocy". Skala mierzy skutek
**wewnątrz** przyjętego modelu zaufania: **wysoki** znaczy „utrata danych, utrata
dostępu albo cudzy kod na telefonach grupy".

| Waga | Liczba |
| --- | --- |
| Wysoki | 5 |
| Średni | 18 |
| Niski | 17 |
| Blokady PWA | 9 |

Dwa wątki przewijają się przez większość znalezisk. Pierwszy: **kanał wydawniczy
jest słabszy niż kod, który nim jedzie** — wdrożenie i wydanie OTA nie czekają na CI,
nie mają wersji ani drogi powrotu, a jedno wejście do niego stoi bez uwierzytelnienia.
Drugi: **ta sama reguła bywa zapisana w dwóch miejscach** — CRUD i synchronizacja,
stałe w telefonie i w API, schemat w PG i w SQLite. To jest dokładnie ten koszt,
który rośnie przy dokładaniu trzeciego klienta.

---

## BEZ — bezpieczeństwo i dostęp

Model zaufania „osiągalność w VPN *jest* autoryzacją" jest spójnie udokumentowany
i sam w sobie w porządku. Poniżej są miejsca, w których kod od tego modelu odstaje
albo w których pojedynczy błąd kosztuje więcej, niż model zakłada.

### BEZ-1 — Redeploy serwera bez uwierzytelnienia, metodą GET · **wysoki**

`GET /update` w `deploy/update_server.py:198` wykonuje `git pull` i
`docker compose up -d --build --force-recreate`. Trasa nie sprawdza żadnego tokenu,
mimo że `POST /apk` i `POST /ota` obok niej sprawdzają `UPDATE_SERVER_PUBLISH_TOKEN`.
Usługa chodzi z profilu użytkownika należącego do grupy `docker`, czyli w praktyce
z uprawnieniami roota na gospodarzu, a port nasłuchuje na `0.0.0.0`.

Metoda `GET` pogarsza sprawę: żądanie zmieniające stan da się wywołać z dowolnej
strony otwartej przez kogoś w VPN (`<img src="http://minipc:40002/update">`), a także
przez prefetch przeglądarki albo skaner. Nie ma też blokady współbieżności — dwa
równoległe wywołania to dwa `docker compose up` na tym samym stosie.

**Naprawa.** Zmienić na `POST`, objąć tym samym `require_publish_token` co publikacja,
dołożyć `asyncio.Lock` na czas przebiegu. `.github/workflows/deploy.yml` wymaga wtedy
jednej zmiany: `curl -X POST -H "Authorization: Bearer …"`.

### BEZ-2 — Brak limitu rozmiaru ciała żądania w API · **wysoki**

Ani Hono, ani Caddy nie ograniczają rozmiaru ciała. `POST /import`
(`apps/api/src/routes/transfer.ts:97`) i `POST /sync/push` parsują JSON w całości do
pamięci, *zanim* Zod zobaczy pierwsze pole. Każde zalogowane konto może więc położyć
proces API jednym żądaniem o rozmiarze kilkuset megabajtów — a razem z nim panel,
bo wychodzi tym samym Caddym.

**Naprawa.** `bodyLimit()` z `hono/body-limit` globalnie (np. 2 MB), z osobnym,
wyższym limitem na `/import`. Do tego `request_body { max_size 64MB }` w `deploy/Caddyfile`.

### BEZ-3 — Akcja obcego autora przypięta do `@main`, z dostępem do sekretów · **średni**

`hackiron/public-actions/netbird-connect@main` pojawia się cztery razy — w `deploy.yml`
i trzykrotnie w `android-release.yml`. Przypięcie do gałęzi, a nie do SHA, znaczy, że
każda zmiana w tamtym repozytorium wjeżdża tu automatycznie. W zadaniu `apk` akcja
startuje w tym samym runnerze co `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`
i `ALPHAPUMP_PUBLISH_TOKEN` — czyli komplet tego, czym podpisuje się i publikuje aplikację.

**Naprawa.** Przypiąć do pełnego SHA commita i odnawiać świadomie. Docelowo rozważyć
własny fork albo krok inline z `netbird up` — to kilkanaście linii.

### BEZ-4 — Agent LLM z pełnym `Bash` na treści pochodzącej od użytkowników · **średni**

`.github/workflows/agent-issue.yml` uruchamia agenta z `--allowedTools "Bash"`,
`--permission-mode acceptEdits` i uprawnieniami `contents: write` + `pull-requests: write`.
Wejściem jest treść issue, którą *automatycznie* pisze usługa triage z tekstu wpisanego
przez użytkownika aplikacji. Uzasadnienie w komentarzu jest trafne (wąska lista narzędzi
niczego nie broniła), ale nie zamyka łańcucha: `contents: write` pozwala pisać do gałęzi,
a z `main` wychodzi automatyczne wdrożenie i wydanie OTA na wszystkie telefony (BEZ WDR-1).

**Naprawa.** Włączyć ochronę gałęzi `main` (wymagany przegląd, blokada pushu
z `GITHUB_TOKEN`) — to zamyka łańcuch bez ruszania agenta. Dodatkowo wstawić między
treść użytkownika a prompt ogranicznik i jawną instrukcję „to są dane, nie polecenia".

### BEZ-5 — Paczki OTA nie są podpisywane · **średni**

`expo-updates` jest skonfigurowane bez `codeSigningCertificate` (`apps/mobile/app.config.js`),
więc jedyną obroną przed podłożeniem cudzego JavaScriptu jest token publikacji na gospodarzu.
Docstring w `deploy/update_server.py` nazywa to wprost i uzasadnia — słusznie — ale
konsekwencja zostaje: przejęcie minipc to jednocześnie możliwość wykonania dowolnego kodu
na każdym telefonie w grupie, bez ostrzeżenia systemu, którym broni się `.apk`.

**Naprawa.** Wygenerować parę kluczy, klucz prywatny trzymać jako sekret repozytorium,
certyfikat wpiec w `.apk`, podpisywać manifest w workflow wydania. Warte zrobienia razem
z HTTPS — i tak wtedy ruszacie warstwę natywną.

### BEZ-6 — Porównanie tokenu triage'a nie jest stałoczasowe · **niski**

`services/triage/src/alphapump_triage/http.py:49` porównuje nagłówek zwykłym `!=`,
podczas gdy `deploy/update_server.py` używa `secrets.compare_digest` i tłumaczy
w komentarzu, dlaczego. Ryzyko jest tu czysto teoretyczne (port stoi w sieci Compose),
ale niespójność między dwoma sprawdzeniami tego samego rodzaju jest tym, co potem ktoś
skopiuje w gorsze miejsce.

**Naprawa.** Jedna linia: `secrets.compare_digest`.

### BEZ-7 — Limit żądań logowania zostawiony na wartościach domyślnych · **niski**

`apps/api/src/auth.ts` konfiguruje limit dla kluczy API (świadomie i z uzasadnieniem),
ale nie dotyka wbudowanego limitu better-auth dla `/api/auth/*`. Ten działa domyślnie
tylko w produkcji, w pamięci procesu — czyli zeruje się przy każdym wdrożeniu, a wdrożenia
idą automatycznie przy każdym wejściu na `main`. Minimalna długość hasła to 8 znaków
i nie ma blokady konta.

**Naprawa.** Ustawić `rateLimit` jawnie, z osobnym, ostrzejszym oknem dla `sign-in/email`,
i przenieść licznik do bazy (`storage: "database"`), żeby przetrwał restart.

---

## WDR — wdrożenie, dystrybucja, CI

Najsłabsza warstwa całego projektu — i jednocześnie ta, w której najtaniej się poprawia.
Kod jest sprawdzany rzetelnie; to, co go wypuszcza, nie jest sprawdzane prawie wcale.

### WDR-1 — Wdrożenie i wydanie nie czekają na CI · **wysoki**

`deploy.yml` i `android-release.yml` wystrzeliwują na `push` do `main`, równolegle
z `ci.yml` i całkowicie niezależnie od jego wyniku. Merge z zepsutym testem jedzie
więc na minipc i — jeśli warstwa natywna się nie zmieniła — natychmiast paczką OTA
na każdy telefon w grupie. Jest zabezpieczenie po stronie klienta (`expo-updates` wraca
do paczki wbudowanej w `.apk`, gdy nowa nie wstanie), ale ono łapie wyłącznie awarię
startu, a nie zepsutą regułę zapisu serii.

Nie ma też **drogi powrotu dla OTA**: żeby cofnąć złe wydanie, trzeba ręcznie ponownie
wypchnąć starszy eksport, którego nikt nie trzyma (artefakt CI ma 30 dni retencji
i nie da się go opublikować bez ręcznej pracy).

**Naprawa.** Dodać zależność `workflow_run` od CI albo — prościej — zadanie `needs: verify`
w obu workflowach wydania. Do tego trasa `POST /ota/rollback` na serwerze aktualizacji,
przestawiająca wskaźnik `<platforma>/<runtimeVersion>.json` na poprzedni opis; pliki i tak
leżą adresowane treścią, więc wystarczy trzymać dwa ostatnie wskaźniki zamiast jednego.

### WDR-2 — Obrazy bez wersji, wdrożenie przez `git pull` na produkcji · **średni**

`deploy/docker-compose.yml` taguje obrazy jako `alphapump/api:local` i `alphapump/web:local`,
a budowa odbywa się na minipc z aktualnie wymeldowanej gałęzi. Nie ma więc czegoś takiego
jak „wersja, która stoi" ani „poprzednia wersja, do której wracam" — powrót to `git checkout`
plus kilkunastominutowa przebudowa, na żywym stosie. Nie ma też rejestru obrazów, więc każde
wdrożenie to kompilacja na maszynie docelowej.

Osobna pułapka jest już udokumentowana w workflow: `/update` robi `git pull`, ale **nie
przeładowuje samego serwera aktualizacji**, bo ten chodzi jako osobna usługa systemd.
Workflow wydania obchodzi to, odpytując `/openapi.json` o istnienie trasy — czyli obejście
zamiast rozwiązania.

**Naprawa.** Tagować obrazy SHA commita i trzymać `docker-compose` na zmiennej `IMAGE_TAG` —
powrót staje się wtedy zmianą jednej zmiennej i `up -d`. Serwer aktualizacji powinien po
udanym `git pull` wołać `systemctl restart alphapump-update-server` w tle.

### WDR-3 — Obraz triage'a ma zależności wpisane z ręki, obok `pyproject.toml` · **średni**

`deploy/Dockerfile.triage` instaluje `discord.py`, `httpx`, `apscheduler` i `aiohttp`
jawnym `pip install` z własnymi zakresami wersji, a dopiero potem robi `pip install --no-deps .`.
Czyli: `pyproject.toml` nie jest źródłem prawdy dla obrazu, a `uv.lock` — wersjonowany
właśnie „bo od niego zależy powtarzalność CI" — do obrazu nie wchodzi wcale. Dodanie
zależności w kodzie i zapomnienie o Dockerfile daje kontener, który wstaje w CI, a wywraca
się na minipc.

**Naprawa.** `COPY pyproject.toml uv.lock ./` i `uv sync --frozen --no-dev` w obrazie.
Warstwa nadal cache'uje się na manifeście, a lista zależności zostaje w jednym miejscu.

### WDR-4 — Brak monitoringu, limitów zasobów i rotacji logów · **średni**

Jedynym czujnikiem jest `smoke.sh` odpalany cronem raz w tygodniu, do pliku. Kontenery
nie mają `deploy.resources.limits` ani `logging.options.max-size`, więc rozgadany kontener
zapełnia dysk sterownikiem `json-file`, a proces z wyciekiem pamięci zabiera ją całej
maszynie. Zadanie porządkowe tombstone'ów (`POST /sync/tombstones/prune`) istnieje, ale
nic go nie woła — trzeba pamiętać, żeby kliknąć.

**Naprawa.** `logging: { driver: json-file, options: { max-size: 10m, max-file: 3 } }`
i skromne `mem_limit` na każdą usługę. Cotygodniowy smoke przenieść na codzienny i dopisać
do `deploy/crontab.example` wywołanie prune'a raz w miesiącu.

### WDR-5 — Lista ścieżek w Caddyfile jako ręcznie utrzymywany kontrakt · **średni**

Rozdział ruchu opiera się na jednej, bardzo długiej linii `@api path …` w `deploy/Caddyfile`.
Test `apps/api/tests/deploy.test.ts` pilnuje jej zgodności z OpenAPI i to jest dobre
rozwiązanie — ale konsekwencja zostaje: **każda nowa trasa API to zmiana w konfiguracji
wdrożenia**, a linia jest nierozwijalna „bo `caddy fmt` przestawia wcięcia". Przy dokładaniu
PWA dojdą do niej co najmniej `/manifest.webmanifest`, `/sw.js` i katalog zasobów.

**Naprawa.** Odwrócić regułę: dać API jeden prefiks (`/api/*`) i przenieść pod niego wszystkie
trasy poza `/health`. Wtedy Caddyfile ma dwie linie, test staje się zbędny, a panel i PWA
dostają całą resztę przestrzeni ścieżek. Zmiana jednorazowa, najtańsza teraz — przed drugim
klientem.

### WDR-6 — `versionCode` wyprowadzony z numeru przebiegu workflow · **niski**

`ANDROID_VERSION_CODE: ${{ github.run_number }}` w `android-release.yml`. Licznik jest
przypisany do *nazwy* workflow: zmiana nazwy pliku albo odtworzenie workflow zeruje go,
a Android odmawia instalacji pakietu o niższym numerze niż zainstalowany. Objaw pojawia
się dopiero na cudzym telefonie i jest nieodwracalny bez odinstalowania aplikacji.

**Naprawa.** Liczyć `versionCode` z liczby commitów (`git rev-list --count HEAD`) — rośnie
monotonicznie, nie zależy od infrastruktury CI i da się odtworzyć z samego repozytorium.

### WDR-7 — Jednostka systemd z wpisanym na sztywno użytkownikiem i ścieżką · **niski**

`deploy/alphapump-update-server.service` ma `User=domin` i
`WorkingDirectory=/home/domin/AlphaPump`. To samo dotyczy `deploy/crontab.example`
i `deploy/backup.env.example`. Plik w repozytorium opisuje więc jedną konkretną maszynę —
postawienie drugiego środowiska (choćby do próby odtworzenia kopii) wymaga edycji
w czterech miejscach.

**Naprawa.** Zostawić wariant z `%i` albo z komentarzem „podstaw swoje", tak jak jest
zrobione w `crontab.example`, i konsekwentnie w każdym pliku.

### WDR-8 — Kopie zapasowe zależą od ręcznie zainstalowanego crona · **niski**

`deploy/crontab.example` to przykład, który ktoś ma skopiować. Nic nie sprawdza, czy to
zrobił, i nic nie alarmuje, gdy `backup.sh` przestanie przechodzić — wynik ląduje
w `/var/log/alphapump-backup.log`, do którego nikt nie zagląda. Sam skrypt jest napisany
dobrze (staging, próg rozmiaru, `pipefail`, wymuszone szyfrowanie przy celu zdalnym).

**Naprawa.** Wystawić w `GET /health` albo w `/admin/stats` wiek najnowszej kopii (odczyt
`mtime` z zamontowanego katalogu) i pokazać go w panelu.

---

## DAN — dane, kopie zapasowe, odtwarzanie

Schemat, migracje i protokół synchronizacji są tu najmocniejszą częścią projektu: indeksy
są kompletne, tombstone'y przemyślane, a comiesięczna próba odtworzenia w CI to rzecz,
której większość projektów tej wielkości nie ma. Jedno założenie w tej próbie jest jednak
nietestowane.

### DAN-1 — Po odtworzeniu z kopii nikt się nie zaloguje · **wysoki**

Archiwum świadomie nie niesie haszy haseł, sesji ani kluczy API
(`packages/core/src/transfer.ts`), a import *wstawia wiersze użytkowników* z ich adresami
e-mail (`apps/api/src/transfer/import.ts:269`). Efekt na czystej bazie: konto istnieje,
ma unikalny e-mail i rolę — ale nie ma powiązanego wiersza w tabeli `accounts`, więc
**nie da się na nie zalogować**. Nie da się też założyć go ponownie, bo `users_email_unique`
odrzuci rejestrację. Resetu hasła przez e-mail nie ma (serwer nie ma czym wysyłać wiadomości).

README opisuje kolejność „ludzie logują się ponownie i dostają nowe identyfikatory",
czyli rejestracja *przed* importem — ale nigdzie tego nie wymusza, a `backup-restore.yml`
tego nie sprawdza: porównuje dane po odtworzeniu z oryginałem i kończy. Awaria wychodzi
więc dokładnie w dniu, w którym kopia jest potrzebna.

**Naprawa.** Najprostsza: dołożyć do zakresu `system` wiersze `accounts` typu `credential`
(to hasze, a kopia zdalna jest i tak wymuszenie szyfrowana przez `age`). Alternatywa bez
ruszania formatu: CLI `set-password` obok `import`, plus krok w `backup-restore.yml`, który
po odtworzeniu *próbuje się zalogować* — dopiero to jest dowód, że kopia jest kopią.

### DAN-2 — Skrzynka zgłoszeń bez limitu tempa i bez sprzątania · **średni**

`POST /feedback` (`apps/api/src/routes/feedback.ts`) zapisuje jeden plik na zgłoszenie,
do ~62 KB (2000 znaków treści + 30 wpisów logu po 2000 znaków). Nie ma limitu tempa ani
retencji, a katalog jest zamontowany do dwóch kontenerów. Jedno konto w pętli zapełnia
dysk minipc, na którym leży też baza. Osobno: pliki zawierają adresy e-mail i przechwycone
logi konsoli, więc rosną jako zbiór danych osobowych, którego nic nie kasuje.

**Naprawa.** Limit „N zgłoszeń na konto na godzinę" w handlerze i retencja w `triage`
(usługa i tak czyta katalog codziennie). Alternatywnie przenieść zgłoszenia do bazy,
gdzie retencja jest jednym `DELETE`.

---

## POP — poprawność i szybkość

Silnik synchronizacji ma nietypowo dobrze przemyślaną warstwę bezpieczników (kwarantanna
odrzuceń, `reconcile`, domykanie referencyjne paczki). Poniżej jest jedna dziura w tej
siatce i cztery miejsca, w których żądanie trwa dłużej, niż ktokolwiek na nie czeka.

### POP-1 — Push synchronizacji czeka na dostawcę modeli, dłużej niż telefon czeka na push · **wysoki**

`apps/api/src/routes/sync.ts:125` woła `refreshEmbeddings` wewnątrz obsługi `POST /sync/push`,
*sekwencyjnie* dla każdego nowego ćwiczenia, z limitem `LLM_TIMEOUT_MS` = 8 s na wywołanie.
Telefon przerywa żądanie po 15 s (`apps/mobile/src/sync/transport.ts:80`). Dwa ćwiczenia
utworzone offline przy wolnym OpenRouterze wystarczą, żeby przekroczyć ten budżet.

Skutek jest gorszy niż samo czekanie: telefon dostaje `SyncOfflineError`, pokazuje „offline"
mimo działającego VPN-a, zaczyna wycofywanie i ponawia push — a serwer w tym czasie dokańcza
zapis i liczy embeddingi po raz drugi. Górna granica jest absurdalna: paczka może nieść
do 500 ćwiczeń.

**Naprawa.** Odpiąć liczenie wektorów od żądania: odpowiedzieć telefonowi, a embeddingi
policzyć w tle, albo — czyściej — oznaczyć ćwiczenia jako „bez wektora" i przeliczać je
zadaniem okresowym, którego szkielet już istnieje (`POST /admin/library/embeddings/refresh`).
Brak wektora jest przecież stanem w pełni obsłużonym.

### POP-2 — Kolejka wysyłki kasuje wpisy wierszy, które nie pojechały · **średni**

`apps/mobile/src/sync/run.ts:118` woła `clearThrough(db, batch.highWater)` bezwarunkowo
po odpowiedzi serwera. Tymczasem paczka mogła zostać po drodze przycięta: przez
`withoutIncompleteRows` (cykl bez pozycji celu) albo przez `withDependencies`, które odsiewa
serie i cykle, gdy ich zależność nie zmieściła się w limicie. Wpis takiego wiersza znika
z outboxu mimo to.

Bezpiecznik `reconcile` tego nie łapie, bo szuka wyłącznie wierszy z `server_seq IS NULL` —
czyli takich, o których serwer nigdy nie słyszał. **Edycja wiersza już potwierdzonego**,
odsiana przy składaniu paczki, przepada po cichu i na zawsze. Ścieżka jest wąska, ale to
jest dokładnie ta klasa błędu, przed którą reszta tego modułu broni bardzo starannie.

**Naprawa.** `buildPushRequest` powinno zwracać, *które* wiersze weszły do paczki;
`clearThrough` kasuje wtedy tylko ich wpisy, a odsiane zostają w kolejce na następną wymianę.

### POP-3 — Push: zapytanie na wiersz, brak jednej transakcji, asercje `row!` · **średni**

`apps/api/src/sync/push.ts` przetwarza paczkę wiersz po wierszu i dla każdego robi osobny
`SELECT`, a przy seriach jeszcze drugi (po ćwiczeniu). Paczka 500 serii to ponad tysiąc rund
do bazy, jedna po drugiej. Całość nie jest objęta transakcją, więc przerwany push zostawia
stan częściowy — rozstrzyganie per wiersz tego nie wymaga, bo odrzucenie wiersza nie potrzebuje
wycofania.

Osobno: w kilkunastu miejscach stoi `row!.serverSeq` po `UPDATE … RETURNING`. Skoro `SELECT`
i `UPDATE` nie są w jednej transakcji, wyścig (np. z `pruneTombstones`) daje `undefined`
i `TypeError` — czyli 500 na *całą* paczkę, w handlerze, którego głównym założeniem jest
„jeden wiersz nie wywraca paczki".

**Naprawa.** Wczytać istniejące wiersze hurtem (`inArray`) przed pętlą i objąć całość jednym
`db.transaction`. Zamienić `row!` na jawne sprawdzenie kończące się `record(..., 'rejected', ...)`.

### POP-4 — Przeliczenie wektorów całej biblioteki jako jedno żądanie HTTP · **średni**

`POST /admin/library/embeddings/refresh` (`apps/api/src/routes/admin-library.ts:817`) iteruje
po wszystkich ćwiczeniach sekwencyjnie, do 8 s na każde, i odpowiada dopiero na końcu. Caddy
ma `response_header_timeout 120s`, więc przy większej bibliotece panel dostanie błąd bramy,
podczas gdy zadanie po cichu leci dalej. Nie ma postępu, nie ma anulowania, ponowne kliknięcie
startuje drugi przebieg.

**Naprawa.** Zwracać `202` od razu i wykonywać zadanie w tle, z blokadą „jeden przebieg naraz"
i licznikiem odczytywanym z `/admin/stats` — panel ma już to pole (`duplicates.embeddings`).

### POP-5 — `takeBatch` wczytuje całą kolejkę do pamięci · **niski**

`apps/mobile/src/sync/outbox.ts:336` — `SELECT` bez `LIMIT`, a dopiero pętla w JavaScripcie
przerywa po wyczerpaniu limitu encji. Telefon offline przez miesiąc może mieć w outboxie
dziesiątki tysięcy wpisów; wszystkie lądują w pamięci przy każdej próbie wymiany, także tej
nieudanej.

**Naprawa.** `.limit(SYNC_PUSH_LIMIT * 4)` wystarczy.

### POP-6 — `/admin/stats` wykonuje kilkanaście zapytań szeregowo · **niski**

`apps/api/src/routes/admin.ts` — każdy licznik to osobne `await`, jeden po drugim,
siedemnaście razy. Bezpłatne do poprawienia; jedyny ekran panelu, który zauważalnie się ładuje.

**Naprawa.** Jedno `Promise.all`.

### POP-7 — Wskrzeszony tag zachowuje stary slug i kolor · **niski**

`POST /tags` (`apps/api/src/routes/tags.ts:216`) w gałęzi `onConflictDoUpdate` ustawia `name`
i `deletedAt: null`, ale nie `slug` ani `color` — w odróżnieniu od gałęzi wstawiania obok,
która liczy oba. Odtworzenie tagu pod inną pisownią nazwy zostawia więc kolor policzony
ze starej.

**Naprawa.** Wstawić `slug` i `color` do obiektu `set`.

### POP-8 — Baza na telefonie bez trybu WAL · **niski**

`apps/mobile/src/db/client.ts:45` ustawia `PRAGMA foreign_keys = ON` i nic więcej. Domyślny
dziennik SQLite (`delete`) blokuje odczyty na czas zapisu — a aplikacja zapisuje serię
dokładnie wtedy, gdy `useLiveQuery` odczytuje historię, żeby przeliczyć rekordy. Przy zapisie
paczki pullu (do 500 wierszy w jednej transakcji) to jest widoczne zacięcie interfejsu.

**Naprawa.** `PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;` obok istniejącej pragmy.

### POP-9 — Ekran zapisu serii wczytuje całą historię ćwiczenia · **niski**

`exerciseHistory` (`apps/mobile/src/db/queries.ts:166`) nie ma ograniczenia — `LogScreen`
pobiera wszystkie serie danego ćwiczenia, żeby policzyć front Pareto i odfiltrować serie dnia.
Dla ćwiczenia trenowanego przez kilka lat to rosnąca liczba wierszy przy każdym wejściu
na ekran, który ma być „możliwie najszybszy".

**Naprawa.** Rozdzielić na dwa zapytania: serie dnia (`WHERE performed_on = ?`) i osobno
wejście do `computeRecords`.

---

## KOD — jakość kodu, martwy kod, obejścia

Kod jest wyjątkowo czysty: brak `any`, brak `TODO`, jeden `@ts-expect-error` z uzasadnieniem,
komentarze tłumaczące decyzje, a nie powtarzające kod. Obejść jest mało — ale te, które są,
warto usunąć, bo każde z nich to reguła do zapamiętania przy następnej zmianie.

### KOD-1 — Tablica wyjątków od koloru tagu, utrzymywana pod test · **średni**

`packages/core/src/tag-color.ts:31` zawiera `GOLDEN_COLOR_OVERRIDES` — osiem sztywno wpisanych
par slug → hex, wprowadzonych po to, żeby zmiana formuły koloru nie złamała pliku
`tests/golden/identifiers.ts`. To jest obejście, i to podwójne:

- **Kolor nie jest identyfikatorem.** Złoty plik nazywa się „kontraktem danych" i słusznie
  zamraża slugi oraz UUID-y — ale kolor jest trzymany w kolumnie `tags.color`, więc istniejące
  tagi i tak mają swój, niezależnie od formuły. Zamrożenie go w kontrakcie było pomyłką,
  a tablica wyjątków jest jej konsekwencją.
- **Siedem z ośmiu wpisów dotyczy tagów, których produkt już nie ma.** `klatka-piersiowa`,
  `nogi-przod`, `lydki`, `grzbiet`, `barki`, `cwiczenia-zlozone`, `triceps-ramie` — seed został
  przepisany na angielski (`chest`, `quads`, `calves`…), więc te slugi nie powstają nigdzie
  poza testem.

**Naprawa.** Usunąć tablicę i asercje `color` ze złotego pliku, zostawiając w nim slugi
i identyfikatory — to jest ta część, która naprawdę jest kontraktem.

### KOD-2 — Wyłączona funkcja przeciągania serii, z zostawionym kodem · **średni**

`apps/mobile/src/screens/log.tsx:80` — `const REORDER_ENABLED: boolean = false`, z komentarzem
„kod zostaje cały, gdyby ktoś chciał to z powrotem włączyć". Przy fladze zostaje około stu linii,
które nigdy się nie wykonują: `PanResponder`, pięć elementów stanu (`rowHeight`, `dragging`,
`dropIndex`, `dragScrollLocked`), `commitReorder`, `releaseDrag`, `getPanResponder`. Do tego
`moveSet` w `db/sets.ts:261`, którą trzyma przy życiu już tylko własny test.

To największy pojedynczy blok martwego kodu w repozytorium i jednocześnie największa część
najbardziej złożonego ekranu w aplikacji.

**Naprawa.** Usunąć — git pamięta. `position` i `moveSet` warto zostawić: kolejność serii dnia
i tak jest częścią protokołu.

### KOD-3 — Dwie ścieżki zapisu dla tych samych encji · **średni**

Każda encja domenowa ma pełny CRUD REST-owy *i* gałąź w `applyPush`. Reguły są w obu miejscach
napisane od nowa: kto może edytować ćwiczenie, czy tag jest używany, czy typ logowania wolno
zmienić, czy slug koliduje, jak wygląda deterministyczne id. Komentarze pilnują zgodności
(„synchronizacja nie jest tylnym wejściem") — ale pilnuje ich tekst, nie typ.

Dla przypomnienia: aplikacja mobilna nie używa CRUD-u *w ogóle* — pisze do bazy lokalnej
i synchronizuje. Z REST-u korzysta tylko panel i (planowany) bot Discord. To najdroższy dług
w projekcie z punktu widzenia „łatwości rozbudowywania": każda nowa reguła to dwie implementacje
i dwa zestawy testów, a rozjazd między nimi jest niewidoczny do momentu, w którym telefon
i panel zaczną się nie zgadzać.

**Naprawa.** Wyciągnąć reguły do warstwy przypadków użycia w `apps/api/src` (np.
`domain/exercises.ts` z `assertMayModify`, `assertNameFree`, `assertLoggingTypeStable`),
z której korzystają oba wejścia.

### KOD-4 — Pięć niewykorzystanych zależności natywnych w aplikacji · **średni**

`expo-build-properties`, `expo-network`, `expo-splash-screen`, `expo-system-ui`
i `react-native-reanimated` figurują w `apps/mobile/package.json`, ale nie importuje ich żaden
plik w `src/` ani `app/`. `expo-build-properties` pojawia się wyłącznie w komentarzu tłumaczącym,
dlaczego *nie* jest używane.

Kosztem nie jest tylko rozmiar `.apk`. Każda z nich wchodzi do **odcisku warstwy natywnej**,
którym `android-release.yml` rozstrzyga, czy wystarczy paczka OTA. Zależności, których nikt
nie używa, podbijają wersję odcisku przy każdej aktualizacji Expo i wymuszają pełne wydanie
`.apk` tam, gdzie wystarczyłyby dwa megabajty.

**Naprawa.** Usunąć, przejść `prebuild` i porównać odcisk przed i po. Uwaga na
`react-native-reanimated`: wtyczka `react-native-worklets` siedzi w `babel.config.js`.

### KOD-5 — Pusty pakiet `@alphapump/api-client` nadal w drzewie · **średni**

`packages/api-client/src/index.ts` eksportuje jedną stałą z własną nazwą i komentarz
wyjaśniający, że pakiet nie ma konsumenta. Mimo to jest w workspace, jest budowany przez Turbo
przy każdym `pnpm build`, ma `tsconfig.build.json` i jest kopiowany do kontekstu obu obrazów
Dockera.

**Naprawa.** Usunąć. Wróci wtedy z konsumentem, a nie jako zaślepka, którą trzeba wymieniać
w dwóch Dockerfile'ach.

### KOD-6 — Te same stałe zapisane pięć razy, spięte komentarzami · **niski**

Limit długości zgłoszenia (2000) stoi w `apps/mobile/src/feedback.ts:18`,
`apps/mobile/src/app-log.ts:28` i dwukrotnie w `apps/api/src/schemas.ts`; limit liczby wpisów
logu (30) — w `app-log.ts:25` i `schemas.ts:122`. Zgodność utrzymują komentarze. Cały
`packages/core` istnieje po to, żeby takich par nie było.

**Naprawa.** `packages/core/src/feedback.ts` ze schematem zgłoszenia i obiema stałymi.

### KOD-7 — Komentarze wskazujące na nieistniejące ścieżki i pliki · **niski**

- `deploy/alphapump-update-server.service:10` mówi o `/srv/pobierz` — katalog nazywa się dziś
  `/srv/alphapump/download`.
- `apps/mobile/src/config/index.ts:4` i `config/schema.ts:2` odsyłają do `app.config.ts`;
  plik jest w JavaScripcie i sam tłumaczy, dlaczego nie może być w TypeScripcie.
- Manifest wydania niesie `md5` i `size`, których serwer wymaga (`_validated_manifest`),
  ale aplikacja już nie sprawdza — pole zostało po usuniętym kodzie pobierania `.apk`.

### KOD-8 — Sześćdziesiąt jeden odwołań do „etapu N" w komentarzach produkcyjnych · **niski**

„warstwa semantyczna (etap 12)", „zachowanie z etapu 8", „to jest kryterium ukończenia etapu 12".
Numeracja pochodzi z `docs/plan_implementacji.md` i miała sens w trakcie budowy. Dziś odsyła
czytelnika do dokumentu planistycznego zamiast wyjaśnić rzecz na miejscu — a plan, gdy zostanie
zamknięty, przestanie być aktualizowany.

**Naprawa.** Zamienić „(etap 12)" na to, co numer miał znaczyć — zwykle jedno zdanie o powodzie.

### KOD-9 — Kilka plików nosi po kilka odpowiedzialności naraz · **niski**

`routes/admin-library.ts` — 855 linii, `screens/log.tsx` — 646, `sync/push.ts` — 614,
`db/queries.ts` — 517. Nie są to pliki źle napisane, ale sekcja oddzielona komentarzem to moduł,
który czeka na wydzielenie.

**Naprawa.** `push.ts` na cztery funkcje `applyTags/applyExercises/applyCycles/applySets`
(wychodzi też naprzeciw POP-3), `admin-library.ts` na `library/exercises.ts`, `library/tags.ts`,
`library/embeddings.ts`.

### KOD-10 — README na 1484 linie, powielający treść z `docs/` · **niski**

81 KB przy trzech nagłówkach drugiego poziomu. Tabele zmiennych środowiskowych, instrukcja
wdrożenia i opis kopii zapasowych żyją równolegle w README i w `docs/uruchomienie.md`. Rozjazd
już się zaczął: trzy nieaktualne odwołania z KOD-7 to dokładnie ten objaw.

**Naprawa.** Zostawić w README to, czego nie ma nigdzie indziej, i przenieść resztę tam, gdzie
już stoi jej kopia.

### KOD-11 — Logi informacyjne wypisywane jako ostrzeżenia · **niski**

`apps/api/src/index.ts` wypisuje „API słucha na…" i podsumowanie seeda przez `console.warn`,
bo reguła ESLint `no-console` dopuszcza tylko `warn` i `error`. Reguła narzuciła więc poziom logu.
Poza tym API nie ma logowania strukturalnego ani identyfikatora żądania.

**Naprawa.** Cienki `logger.ts` z poziomami, wypisujący JSON-a na stdout, i wyjątek od reguły
ESLint w tym jednym module. Do tego identyfikator żądania w middleware Hono i w komunikacie błędu.

### KOD-12 — Schemat opisany dwa razy — koszt przyjęty świadomie · **niski**

`packages/db/src/pg/schema.ts` (479 linii) i `sqlite/schema.ts` (359) opisują ten sam model,
bo buildery Drizzle są osobne; pilnuje ich `tests/schema-parity.test.ts`. Rozwiązanie jest
właściwe — warto natomiast *widzieć* pełny koszt dołożenia jednej kolumny: dwa schematy, dwa
zestawy migracji, `dto.ts`, `rows.ts`, `push.ts`, `pull.ts`, `apply.ts`, `payload.ts`, schemat
w rdzeniu i test parzystości. Dziewięć miejsc na jedno pole.

**Do rozważenia.** Wygenerować schemat SQLite z PG skryptem (precedens:
`scripts/build-sqlite-bundle.ts`) albo dopisać listę kontrolną „dodaję kolumnę". Drobna uwaga:
SQLite nie ma odpowiednika `users_server_seq_idx` z PG.

---

## UX — użytkowanie

### UX-1 — Trzy języki w jednym produkcie, mieszane w jednym zdaniu · **średni**

Interfejs aplikacji jest po angielsku („New record!", „Sync now"), panel administracyjny po
polsku, a komunikaty błędów API — po polsku i *pokazywane w aplikacji wprost*. W pigułce
synchronizacji wychodzi z tego jedno zdanie w dwóch językach:

> „The server would not accept 1 change(s). They are kept on this device and retried
> automatically — Ćwiczenie może zmieniać wyłącznie jego autor albo administrator."

Do tego ekran logowania ma tytuł `'Logowanie'` (`apps/mobile/app/_layout.tsx:70`), ukryty tylko
dlatego, że nagłówek jest wyłączony. Nie ma warstwy tłumaczeń — napisy są wpisane w komponentach.

**Naprawa.** Wybrać jeden język interfejsu. Komunikaty odrzuceń z `SyncResult.reason` zamienić
na **kody** (`exercise_forbidden`, `exercise_in_use`…) tłumaczone po stronie klienta —
`ErrorCode` w `apps/api/src/errors.ts` jest już zrobiony dokładnie tak.

### UX-2 — Ani jednego testu interfejsu · **średni**

`apps/mobile/vitest.config.mts` i `apps/admin/vitest.config.ts` świadomie wykluczają renderowanie
komponentów, z dobrym uzasadnieniem. Skutek jest jednak taki, że 646-liniowy `log.tsx`,
481-liniowy `cycle-form.tsx` i cały panel nie mają *żadnego* pokrycia — a to w nich siedzi logika,
którą użytkownik widzi. CI sprawdza tylko, że projekt na iOS się kompiluje.

**Naprawa.** Nie renderowanie komponentów, tylko **dwa testy end-to-end** na emulatorze (Maestro
albo Detox): zaloguj się → zapisz serię → zobacz ją po restarcie, oraz zapisz serię offline →
włącz sieć → sprawdź, że dojechała.

---

## PWA — droga na iOS

Warstwa domenowa (`packages/core`) jest w pełni przenośna — bez I/O, bez zależności od platformy,
z testami. Cała warstwa *danych* i *uwierzytelnienia* jest natomiast przywiązana do React Native
i dziś nie ma żadnego szwu, w który dałoby się wpiąć przeglądarkę.

| Obszar | Waga | Stan i co z tym zrobić |
| --- | --- | --- |
| Baza lokalna | **blokada** | `expo-sqlite` + `drizzle-orm/expo-sqlite` + `useLiveQuery` nie mają implementacji w przeglądarce. Gorzej: `src/db/client.ts` eksportuje singleton `db`, który **16 plików importuje wprost** — nie ma gdzie podstawić innego sterownika. Kolejność: najpierw odwrócić zależność (provider zamiast importu modułu), potem adapter `wa-sqlite` na OPFS z tym samym interfejsem i własną implementacją „live query". |
| Sesja i token | **blokada** | `expo-secure-store` i wtyczka `@better-auth/expo` są natywne. Web musi używać zwykłego klienta better-auth z ciasteczkiem — tak jak robi to już panel (`apps/admin/src/lib/auth.ts`). Wzorzec jest w repozytorium, trzeba go wydzielić. |
| Transport HTTP | **blokada** | `sync/transport.ts`, `remote/read-only.ts` i `feedback.ts` ustawiają nagłówek `cookie:` z ręki. Przeglądarka tego zabrania. Zamienić na `credentials: 'include'` przy wspólnym pochodzeniu albo na `Authorization: Bearer` — wtyczka `bearer()` jest już włączona po stronie serwera. |
| HTTPS i ciasteczka | **blokada** | Service worker wymaga bezpiecznego kontekstu. Po włączeniu HTTPS `apps/api/src/auth.ts` musi przestawić `useSecureCookies` i `defaultCookieAttributes.secure` na `true`, a `deploy/Caddyfile` zdjąć `auto_https off`. Dwie drogi dla nazwy w VPN: `tls internal` (własny CA — na iOS trzeba zainstalować i *zaufać* certyfikatowi) albo prawdziwa domena z ACME przez DNS-01. Druga jest wyraźnie mniej kłopotliwa. |
| Cel budowania | **blokada** | Nie ma celu `web`: skrypt `build` to `expo export --platform android`, brakuje `react-native-web` i `react-dom`, `metro.config.js` nie jest pod to skonfigurowany. NativeWind i `expo-router` działają na webie, więc praca jest głównie konfiguracyjna. |
| Aktualizacje | praca | `expo-updates`, `latest.json` i `UpdatePrompt` nie mają na webie sensu — tam aktualizuje service worker. Potrzebna gałąź per platforma i osobna ścieżka wydania publikująca statyczny build do Caddy'ego. |
| Import/eksport FitNotes | praca | `expo-document-picker`, `expo-file-system`, `expo-sharing` → `<input type="file">` i pobranie bloba. Parsowanie siedzi w `packages/core/src/fitnotes.ts` i jest przenośne; ruszyć trzeba `src/fitnotes/expo.ts` i `src/transfer/*`. |
| Logowanie Google | drobne | `@react-native-google-signin` nie ma implementacji webowej, ale na webie wraca zwykły przepływ OAuth better-autha — który i tak wymagał HTTPS-a. Metoda jest dziś domyślnie wyłączona. |
| Trwałość danych na iOS | praca | Safari kasuje magazyn PWA po **7 dniach bez użycia**, jeśli aplikacja nie została dodana do ekranu głównego; budżet OPFS jest ograniczony. Model „baza lokalna jest źródłem prawdy" to przeżyje, bo serwer ma komplet — ale trzeba zaplanować odbudowę (pierwszy pull ciągnie całą bibliotekę i historię paczkami po 500 wierszy) i poprosić użytkownika o dodanie do ekranu głównego. |

**Co do decyzji „tylko PWA czy PWA + natywna":** koszt utrzymania obu wersji sprowadza się prawie
w całości do tabeli powyżej — warstwa domenowa i protokół synchronizacji są wspólne i już się nie
rozjadą, bo są w `packages/core`. Prawdziwa różnica jest po stronie danych: przy dwóch klientach
macie *dwa* sterowniki bazy lokalnej do utrzymania. Dlatego wydzielenie `packages/local-db`
z jednym interfejsem i dwiema implementacjami warto zrobić **przed** napisaniem pierwszej linii
wersji webowej — nie po.

---

## Kolejność prac

Ułożona tak, żeby każdy krok zmniejszał ryzyko następnego, a nie według samych wag.

1. **Zamknąć kanał wydawniczy** — BEZ-1, BEZ-2, WDR-1. Trzy zmiany po kilkanaście linii,
   po których nic już nie jedzie na telefony bez sprawdzenia.
2. **Udowodnić, że kopia jest kopią** — DAN-1. Bez tego wszystko inne jest budowaniem na kopii,
   która nie działa.
3. **Odkleić dostawcę modeli od ścieżki zapisu** — POP-1 i POP-4. Jedyne znalezisko, które
   użytkownicy widzą dziś jako „aplikacja mówi offline, choć jestem w VPN".
4. **Posprzątać martwy kod i obejścia** — KOD-1, KOD-2, KOD-4, KOD-5. Cztery usunięcia, zero
   nowego kodu — a odcisk warstwy natywnej po KOD-4 może się uprościć na tyle, że kolejne wydania
   pójdą OTA zamiast pełnym pakietem.
5. **Włączyć HTTPS** — warunek wstępny PWA, domyka BEZ-5 i pozwala włączyć logowanie Google
   w przeglądarce. Zrobić razem z WDR-5, bo i tak ruszacie wtedy Caddyfile.
6. **Wydzielić warstwę danych** — `packages/local-db` z interfejsem zamiast singletonu
   `db/client.ts`, plus KOD-3. Właściwy moment: refaktor na kliencie natywnym, zanim istnieje
   drugi klient.
7. **Dopiero teraz PWA** — adapter web dla bazy, transport na `credentials: 'include'`, service
   worker, manifest. Po poprzednich krokach to praca konfiguracyjna i jeden nowy sterownik,
   a nie przepisywanie aplikacji.

Wag nie należy czytać jako oceny kodu: przy tej jakości bazy większość znalezisk to zmiany
kilkunastolinijkowe.
