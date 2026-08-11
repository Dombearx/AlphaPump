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
| `/exercises/similar?name=` | podobne ćwiczenia: leksykalnie, semantycznie i przez model |
| `/exercises/:id/records` | rekordy globalne ćwiczenia                          |
| `/rankings?metric=`      | ranking objętości, dystansu albo liczby rekordów    |
| `/sync/push`, `/sync/pull` | wymiana danych z urządzeniem                      |
| `/export`, `/import`     | eksport i import danych w JSON-ie                   |
| `/admin/users`, `/admin/stats` | konta i dane systemowe (rola administratora)   |

Uwierzytelnienie idzie dwiema drogami: nagłówkiem `Authorization: Bearer …`
(sesja, tak korzysta aplikacja) albo `x-api-key` (token API, tak korzysta bot
Discord). Serie są prywatne — także administrator nie widzi cudzej historii.

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

#### Rekordy globalne i rankingi na telefonie

To jedyne dwa miejsca w aplikacji, które czekają na sieć — i jedyne, które mogą:
liczą się z serii wszystkich użytkowników, a cudze serie są prywatne i nigdy nie
zjadą na telefon. Odczyt idzie przez `src/remote/`, bez cache'u i bez outboxu,
a brak łączności pokazujemy jako spokojne „offline" z przyciskiem ponowienia —
tymi samymi klasami błędów co synchronizacja. Reszta aplikacji, łącznie
z rekordami indywidualnymi, dalej działa w trybie samolotowym.

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
waliduje własne wyjście. Klient RPC z `@alphapump/api-client` czeka na panel
administracyjny: wciągnięcie typów serwera do aplikacji dołożyłoby zależność
między telefonem a backendem, a kontrakt i tak jest już opisany schematami.

Osobny workflow (`.github/workflows/ios-simulator.yml`) kompiluje aplikację na
symulator iOS. Buildy na symulator jako jedyne nie wymagają płatnego konta Apple
i wyłapują to, co przy pracy wyłącznie na Androidzie psuje się niezauważenie.

### Kontrakt identyfikatorów

`slug()` oraz deterministyczne identyfikatory ćwiczeń i tagów są objęte testami
golden (`packages/core/tests/golden/identifiers.ts`). Ich zmiana przepisuje
identyfikatory istniejących wierszy, więc czerwony test golden nie jest testem
do poprawienia — to sygnał, że zmiana wymaga świadomej decyzji i migracji.
