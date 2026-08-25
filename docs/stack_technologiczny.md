# Stack technologiczny

Dokument opisuje wybrany stack, architekturę i decyzje projektowe dla AlphaPump.
Uzupełnia `specyfikacja_biznesowa.md` — tam jest *co*, tutaj *czym* i *jak*.
Kolejność realizacji opisuje `plan_implementacji.md`.

## Zasada naczelna

Specyfikacja zawiera jeden wymóg, który determinuje architekturę bardziej niż
wszystkie pozostałe razem wzięte:

> „po dodaniu serii rekordowej użytkownik dostaje informację o rekordzie"
> oraz „aplikacja działa bez internetu"

Front Pareto musi więc być liczony **na telefonie, offline**, a rekordy globalne
i rankingi **na serwerze, tym samym algorytmem**. To samo dotyczy dopasowywania
serii do cykli i podpowiadania wartości kolejnej serii.

Napisanie tych reguł dwa razy w dwóch językach gwarantuje ciche rozjazdy —
użytkownik zobaczyłby inny rekord w aplikacji niż w rankingu. Stąd decyzja:
**jeden język w całym projekcie, logika domenowa w jednym współdzielonym
pakiecie.** TypeScript jest jedynym wyborem obsługującym wszystkie trzy warstwy
(mobile, API, panel admina).

## Struktura repozytorium

Monorepo oparte na pnpm workspaces + Turborepo.

```
apps/
  mobile/       Expo (Android + iOS)
  api/          Hono (REST + sync + LLM)
  admin/        Vite + React (panel administracyjny)
packages/
  core/         logika domenowa — bez I/O, w 100% testowalna
  db/           schematy Drizzle: Postgres (serwer) + SQLite (telefon)
```

`packages/core` jest sercem projektu. Zawiera:

- wyznaczanie frontu Pareto (rekordy indywidualne i globalne),
- dopasowywanie serii do cykli,
- logikę podpowiadania wartości kolejnej serii,
- normalizację nazw (`slug()`) — patrz sekcja o identyfikatorach,
- konwersje jednostek,
- schematy Zod współdzielone przez API, klienta i formularze.

Zero zależności od I/O, pełne pokrycie testami jednostkowymi. Front Pareto to
ok. 40 linii — ale to te 40 linii, które muszą być bezbłędne.

## Aplikacja mobilna

Expo SDK 57 (React Native 0.86, React 19.2).

| Warstwa      | Wybór                             | Uzasadnienie                                             |
| ------------ | --------------------------------- | -------------------------------------------------------- |
| Nawigacja    | Expo Router                       | file-based, deep linking bez konfiguracji                |
| Baza lokalna | expo-sqlite + Drizzle             | `useLiveQuery` — zapis do bazy sam przerysowuje UI       |
| Styling      | NativeWind + własne prymitywy     | dark theme; wspólne komponenty w `src/ui/primitives.tsx`  |
| Listy        | `ScrollView`                      | dzień to kilkanaście serii, biblioteka kilkaset ćwiczeń   |
| Wykresy      | własny wykres słupkowy na `View`  | „proste, minimalistyczne wykresy" bez modułu natywnego    |
| Gesty        | Gesture Handler                   | wymagany przez Expo Router                                |
| Auth         | better-auth + `@better-auth/expo` | wspólny mechanizm z backendem                             |
| Mikrofon     | expo-audio                        | dyktowanie serii; jedyne uprawnienie, o które pytamy w trakcie działania — a i tak opcjonalne, bo to samo da się wpisać |
| Buildy       | `expo prebuild` + projekt natywny | wydanie z projektu natywnego; EAS niekonfigurowane        |

> **Trzy wybory z tej tabeli zmieniły się przy realizacji** i tabela pokazuje
> stan faktyczny, nie pierwotny zamiar. Planowane były react-native-reusables,
> FlashList i victory-native XL; nie wszedł żaden z nich. Powód jest wspólny:
> **każdy dokładał moduł natywny albo warstwę komponentów do utrzymania na obu
> platformach, nie odpowiadając na potrzebę, która faktycznie istnieje w tym
> produkcie.** Ekran dnia ma kilkanaście wierszy, więc wirtualizacja FlashListy
> nie ma czego przyspieszyć; specyfikacja mówi o „prostych, minimalistycznych
> wykresach", a słupek o wysokości proporcjonalnej do wartości rysuje się zwykłym
> `View`; własne prymitywy okazały się krótsze niż dopasowywanie cudzego zestawu
> do jednego, ciemnego motywu. Wraca to na stół, gdy pojawi się ekran, którego
> tak się nie da zrobić.
>
> **Konfiguracji EAS repozytorium nie zawiera.** `expo prebuild` generuje projekt
> natywny i to z niego idzie wydanie na Androida. EAS Build i EAS Update wchodzą
> razem z etapem 15, bo dopiero tam pojawia się dystrybucja; do tego czasu byłyby
> konfiguracją bez odbiorcy.

### Dlaczego `useLiveQuery` ma znaczenie

Zapis idzie do SQLite, a każdy ekran czytający te dane odświeża się sam. To
realizuje wymóg „natychmiastowa reakcja UI na zapis lokalny" bez żadnej warstwy
zarządzania stanem serwerowym — nie ma cache'a do unieważniania, bo źródłem
prawdy jest baza.

Dwie pułapki do zapamiętania:

- baza musi być otwarta z `enableChangeListener: true` (domyślnie wyłączone),
- znany bug: `useLiveQuery` nie odświeża komponentu, gdy zapytanie zwraca zero
  wierszy ([drizzle-orm#2620](https://github.com/drizzle-team/drizzle-orm/issues/2620)).

Dane siedzą w SQLite, a stan czysto UI-owy — wybrany filtr, otwarty formularz —
okazał się zawsze lokalny dla jednego ekranu, więc trzyma go `useState`.
Biblioteki do stanu globalnego (rozważany był Zustand) w projekcie nie ma:
przy źródle prawdy w bazie nie zostało nic, co musiałoby żyć ponad ekranem.

## iOS — odłożone, ale nie zamknięte

Pierwsza wersja wychodzi na Androida. W grupie jest jedna osoba na iOS, więc
platforma docelowo wchodzi — i decyzja o jej odłożeniu nie pociąga za sobą
żadnych zmian w kodzie, bo React Native dzieli tę samą bazę kodu między
platformami.

Utrzymanie otwartych drzwi kosztuje trzy rzeczy:

- **Build na symulator iOS w CI od pierwszego dnia.** Buildy na symulator jako
  jedyne nie wymagają płatnego konta Apple, bo nie przechodzą podpisywania kodu.
  Wychwytują dokładnie to, co psuje się niezauważenie przy pracy wyłącznie na
  Androidzie: biblioteki bez wsparcia iOS, błędy kompilacji natywnej, konflikty
  zależności natywnych. Uruchomienie takiego buildu wymaga Maca, ale samo
  zbudowanie w chmurze EAS — nie, a to kompilacja wyłapuje regresje.
- **Sprawdzanie wsparcia iOS przy doborze bibliotek.** Tania dyscyplina, droga
  do nadrobienia wstecz.
- **Konfiguracja ATS od razu**, obok androidowej. Oba wyjątki wyliczają się
  z jednego adresu API w `apps/mobile/config/network.js`, więc nie ma jak ustawić
  jednego i przeoczyć drugiego — a osobno zapomniany blok iOS-owy leżałby
  niezauważony do pierwszego buildu na tę platformę.

Gdy przyjdzie czas: konto Apple Developer (99 USD rocznie), poświadczenia
podpisywania w EAS, dystrybucja przez TestFlight. Bez przepisywania kodu.

Sign in with Apple staje się wymagane dopiero przy publikacji w App Store —
TestFlight go nie wymaga.

## Backend

Hono + Drizzle + Zod na Node 22+, PostgreSQL 17.

Hono zamiast NestJS, bo API jest małe i głównie transakcyjne — Nest to w tej
skali głównie ceremonia. Hono daje przy tym dwie rzeczy naraz:

- `hc` — typowany klient RPC dla aplikacji i panelu, bez generowania kodu,
- OpenAPI ze schematów Zod — gotowa dokumentacja dla bota Discord.

### Autoryzacja

better-auth pokrywa wymagania specyfikacji niemal jeden do jednego:

| Wymaganie ze specyfikacji            | Mechanizm            |
| ------------------------------------ | -------------------- |
| logowanie e-mail + hasło             | natywnie             |
| logowanie Google                     | natywnie             |
| wiele tokenów API na użytkownika     | plugin `apiKey`      |
| role użytkownik / administrator      | plugin `admin`       |
| zarządzanie użytkownikami w panelu   | plugin `admin`       |
| obsługa sesji w React Native         | plugin `expo`        |

Wersje pinujemy i włączamy Dependabota — w 2025 biblioteka miała krytyczną
podatność w endpointach kluczy API (CVE-2025-61928, dawno załatana).

Logowanie Google działa poprawnie mimo API zamkniętego w VPN: telefon pobiera
`idToken` od Google zwykłą drogą, wysyła go do API przez VPN, API weryfikuje
podpis kluczami publicznymi Google.

## Panel administracyjny

Vite + React + TanStack Router + TanStack Query + shadcn/ui, korzystający z tego
samego API. Osobne SPA, nie Next.js — specyfikacja mówi „prosty panel", a SPA
jest tańsze w utrzymaniu i hostowaniu niż pełny framework SSR.

> **Panel nie ma osobnego klienta API.** Odpowiedzi czyta schematami Zod
> z `@alphapump/core` — tymi samymi, którymi API je opisuje i waliduje — więc
> kontrakt jest już wspólny i sprawdzany po obu stronach. Typowany klient RPC
> dołożyłby do tego zależność panelu od typów serwera, nie dając nowej gwarancji.

## Konwencje modelu danych

Cztery decyzje, które trzeba przyjąć na starcie, bo późniejsza zmiana jest
kosztowna:

**Wszystkie wartości jako liczby całkowite.** Ciężar w gramach, czas w
sekundach, dystans w metrach. Porównania frontu Pareto na liczbach
zmiennoprzecinkowych prowadzą do sytuacji, w której 80.0 kg nie równa się
80.0 kg, a „dokładny remis" — który zgodnie ze specyfikacją nie ma pokazywać
komunikatu — zaczyna losowo wyskakiwać jako rekord.

**Dzień jako `DATE` bez strefy czasowej**, osobno od `created_at timestamptz`.
Inaczej seria zapisana o 23:00 podczas wyjazdu wyląduje w innym dniu po
synchronizacji.

**Rekordy i rankingi są cache'em, nie źródłem prawdy.** Specyfikacja wymaga
pełnego przeliczenia po edycji serii, więc muszą dać się w każdej chwili
odtworzyć z samych serii. Dzięki temu eksport i kopia zapasowa obejmują wyłącznie
dane nieodtwarzalne: serie, ćwiczenia, tagi, cykle i minimalne dane
użytkowników.

**Soft delete wszędzie.** Bez tombstone'ów usunięcie wykonane offline nie ma jak
dojechać na serwer.

## Identyfikatory

| Encja     | Identyfikator                                          |
| --------- | ------------------------------------------------------ |
| seria     | UUIDv7 generowane na kliencie                          |
| cykl      | UUIDv7 generowane na kliencie                          |
| ćwiczenie | `uuidv5(NS_EXERCISE, "${author_id}/${slug(nazwa)}")`   |
| tag       | `uuidv5(NS_TAG, slug(nazwa))`                          |

Deterministyczne identyfikatory ćwiczeń i tagów rozwiązują problem duplikatów
tworzonych offline. Gdy ten sam użytkownik utworzy na dwóch urządzeniach bez
sieci ćwiczenie o tej samej nazwie, oba wyliczą **to samo id** i na serwerze
zwyczajnie się zsumują — bez indeksów ratunkowych, bez remapowania
identyfikatorów i bez przepinania serii wskazujących na porzucony wiersz.

Dwóch różnych użytkowników tworzących ćwiczenie o identycznej nazwie dostanie
różne id, bo `author_id` wchodzi w klucz — czyli dokładnie reguła unikalności
opisana w specyfikacji. Tagi, jako byt globalny, deduplikują się same:
„biceps", „Biceps" i „BICEPS" to jeden tag.

> **Kontrakt:** funkcja `slug()` (małe litery, ogonki na ASCII, spacje na
> myślniki) musi być identyczna na kliencie i serwerze i **nie może się nigdy
> zmienić** — zmiana normalizacji zmieniłaby id istniejących wierszy. Mieszka w
> `packages/core` i jest objęta testami traktowanymi jak kontrakt.

Kolor tagu pochodzi z **dwudziestoelementowej palety** barw wyraźnie różnych
od siebie (najbliższa para dzieli ΔE2000 ≈ 16, pilnuje tego test). Slug wskazuje
tylko slot startowy — przy zajętym szukamy pierwszego wolnego w przód, więc
dopóki tagów jest najwyżej dwadzieścia, żaden kolor nie powtarza się między
nimi. Powyżej dwudziestu powtórki są dopuszczalne; szersza paleta znaczyłaby
tylko tyle, że część par i tak byłaby nieodróżnialna.

Unikalność jest własnością **zbioru**, więc kolor nie jest czystą funkcją nazwy:
przydziela go ten, kto zna resztę tagów. Telefon przydziela offline z tego, co
zna lokalnie, a serwer poprawia przydział przy pushu — kolor jest wartością
zapisaną w `tags.color`, więc telefon dostaje poprawkę w odpowiedzi i nie zmienia
jej już nigdy potem. Zmiana nazwy koloru nie rusza, bo przeliczenie wepchnęłoby
tag na kolor sąsiada. Wiersze sprzed palety (kolor z hasha na pełne koło barw)
sprowadza do palety `normalizeTagColors` przy starcie serwera.

Ćwiczenia wbudowane potrzebują autora, bo `author_id` wchodzi w klucz
identyfikatora. Przypisujemy je do stałego konta systemowego o zafiksowanym
identyfikatorze — dzięki temu ich id są takie same w seedzie, w bazie i po
odtworzeniu z kopii.

## Synchronizacja

Rozwiązanie własne, oparte na outboxie i kursorze. Rozważane były PowerSync,
ElectricSQL i Zero — dwa ostatnie odpadają, bo świadomie nie obsługują pełnego
trybu offline.

PowerSync odpada z innego powodu. Po przyjęciu automatycznego rozstrzygania
konfliktów (suma / LWW / usunięcie wygrywa) jego model konfliktów pasuje do
naszego **dokładnie** — argument „nie obsłuży naszej semantyki" nie obowiązuje.
Decydują trzy inne rzeczy:

- **To przestało być silnikiem.** Zostają: tabela `outbox`, `POST /sync/push`,
  `GET /sync/pull?since=`. Rozstrzyganie konfliktów to jedna klauzula SQL:
  `INSERT ... ON CONFLICT (id) DO UPDATE WHERE excluded.updated_at > updated_at`.
- **Ścieżka zapisu i tak jest nasza.** PowerSync nie pisze do Postgresa — jego
  handler `uploadData` woła nasze API. Kolejkę na kliencie i endpointy zapisu
  piszemy tak czy inaczej; PowerSync przejmuje realnie tylko kierunek pobierania.
- **Koszt operacyjny.** Trzeci proces na minipc, replikacja logiczna Postgresa
  i DSL reguł synchronizacji w YAML do nauczenia.

Do tego skala: kilkanaście osób i biblioteka ćwiczeń rzędu kilkuset wierszy.
Wartość PowerSync ujawnia się przy częściowej synchronizacji dużych zbiorów —
my ściągamy bibliotekę raz, a potem tylko delty po kursorze.

Próg opłacalności: gdyby produkt stał się wielodostępnym SaaS z setkami tysięcy
wierszy na użytkownika, PowerSync staje się właściwym wyborem.

### Mechanika

- każdy synchronizowany wiersz ma `updated_at`, `deleted_at` i `server_seq`,
- lokalna tabela `outbox` — append-only log mutacji,
- push: batch mutacji z outboxu, domknięty referencyjnie — paczka dokłada
  wiersze, na które wskazuje, a których serwer nie potwierdził (`server_seq`
  pusty),
- pull: kursor po `server_seq`,
- po każdym pullu przeliczane są dane pochodne (rekordy, cykle) dla dotkniętych
  ćwiczeń,
- po każdej wymianie `reconcile` wraca po wiersze żywe, bez `server_seq` i bez
  wpisu w kolejce; odrzucenia czekają w `sync_rejections` z rosnącym odstępem.

`server_seq` pełni tu drugą rolę, obok kursora: jest odpowiedzią na pytanie „czy
serwer o tym wierszu wie". Dostaje go **każdy** wiersz potwierdzony przez
serwer, także ten, który przegrał LWW — a to znaczy, że wiersz żywy bez
`server_seq` i bez wpisu w kolejce jest zapisem zgubionym, niezależnie od tego,
na którym kroku się zgubił. Dopiero to pozwala mieć ścieżki „ten wiersz tym
razem nie pojedzie" (odrzucenie przez serwer, przycięcie paczki do limitu)
i nadal twierdzić, że żadna seria nie przepada.

Paczka pullu jest posortowana po `server_seq`, czyli chronologicznie względem
zapisu na serwerze — a nie topologicznie względem zależności. Ćwiczenie potrafi
więc przyjechać przed swoim tagiem, a seria przed swoim ćwiczeniem. Klucze obce
po stronie telefonu zostają takie same jak na serwerze, a transakcja pullu
ustawia `PRAGMA defer_foreign_keys = ON`: SQLite przenosi wtedy sprawdzenie na
`COMMIT`, więc kolejność wewnątrz paczki przestaje mieć znaczenie, a
niespójność, której nie domyka żaden wiersz z tej samej paczki, dalej nie
przechodzi. Zdejmowanie kluczy obcych z bazy lokalnej dawałoby to samo za cenę
bazy, w której nikt już niczego nie pilnuje.

### Rozstrzyganie konfliktów

Dodanie serii **nie jest konfliktem**. Każda seria ma własny identyfikator
nadany na telefonie, więc dwa urządzenia dodające serie tego samego dnia tworzą
dwa różne wiersze — suma zbiorów jest jedyną sensowną operacją. Prawdziwy
konflikt istnieje wyłącznie wtedy, gdy dwa urządzenia dotkną wiersza o tym samym
identyfikatorze, co dotyczy jednego użytkownika na dwóch urządzeniach.

| Sytuacja                                | Rozstrzygnięcie                        |
| --------------------------------------- | -------------------------------------- |
| dwa urządzenia dodają różne serie       | suma — brak konfliktu z definicji      |
| dwa urządzenia edytują tę samą serię    | LWW po `updated_at`, wymiana wiersza   |
| jedno usuwa, drugie edytuje             | **usunięcie wygrywa**, niezależnie od czasu |

LWW opiera się na zegarze telefonu, który bywa przestawiony. Mitygacja: serwer
przycina timestampy z przyszłości do własnego „teraz", a przy remisie
rozstrzyga `device_id`. Pełny zegar hybrydowy (HLC) to ok. 30 linii, gdyby
kiedyś okazał się potrzebny — dla dwóch urządzeń jednego użytkownika przycinanie
wystarczy.

### Strategia per encja

| Encja                       | Kto zapisuje                | Strategia                              |
| --------------------------- | --------------------------- | -------------------------------------- |
| seria                       | właściciel                  | suma + LWW + tombstone                 |
| cykl                        | właściciel                  | LWW per wiersz                         |
| ćwiczenie                   | **tylko autor** (+ admin)   | id deterministyczne → suma; edycja LWW |
| tag                         | każdy tworzy, edytuje admin | id deterministyczne → suma             |
| rekordy indywidualne        | nikt — dane pochodne        | **nie synchronizowane**, liczone lokalnie z lokalnych serii |
| rekordy globalne, rankingi  | wyłącznie serwer            | pull-only, przeliczalne z serii        |

Rekordy indywidualne nie przechodzą przez synchronizację w żadną stronę. Są
funkcją serii użytkownika, a te i tak są w całości na urządzeniu — liczymy je
lokalnie po każdej zmianie i po każdym pullu. To właśnie dlatego informacja
o rekordzie działa offline. Rekordy globalne i rankingi wymagają serii wszystkich
użytkowników, więc powstają na serwerze i schodzą do aplikacji tylko do odczytu.

Edycja ćwiczeń jest ograniczona do autora i administratora. Bez tego publiczna
biblioteka wchodzi w problemy rodem z wiki i samo LWW przestaje wystarczać.
Reguła jest odzwierciedlona w `specyfikacja_biznesowa.md`.

Status synchronizacji pokazywany użytkownikowi (online / offline / oczekujące
zmiany / błąd) pozostaje bez zmian — znika jedynie widok ręcznego wyboru wersji.

## Wykrywanie duplikatów ćwiczeń

Specyfikacja wymaga ostrzegania o podobnych ćwiczeniach przy tworzeniu nowego,
bez blokowania zapisu. Realizowane trójwarstwowo, bo warstwy mają różne
wymagania co do dostępności.

**Warstwa 1 — lokalna, zawsze dostępna.** SQLite FTS5 po znormalizowanej nazwie
plus filtr po głównym tagu. Musi działać offline i obsługuje przy okazji zwykłe
przeglądanie biblioteki. Łapie literówki i warianty zapisu.

**Warstwa 2 — serwerowa, gdy online.** Wyszukiwanie hybrydowe: leksykalne
(`pg_trgm` + `tsvector`) oraz semantyczne (`pgvector`, indeks HNSW, odległość
kosinusowa). Embedding liczony **raz, przy tworzeniu ćwiczenia**, nie przy każdym
zapytaniu. Obie listy scalane przez RRF do ok. 10 kandydatów. Ta warstwa łapie to,
czego pierwsza nie może — że „martwy ciąg" i „deadlift" to to samo ćwiczenie.

> **Konfiguracja `tsvector` to `simple`, nie polska** (ustalone przy realizacji
> etapu 12). PostgreSQL nie ma wbudowanego słownika polskiego, a dołożenie ispella
> oznaczałoby pliki słowników na serwerze i różnicę między bazą produkcyjną
> a testową. Wejściem indeksu jest **slug** — już bez ogonków i wielkich liter —
> więc `simple` wystarcza do dopasowania po słowach niezależnie od ich kolejności,
> a odmianę i literówki („przysiady" ↔ „przysiad") łapie obok indeks trigramowy.
> Wymiar wektora jest zafiksowany w schemacie (`EMBEDDING_DIMENSIONS`), bo indeks
> HNSW wymaga wymiaru znanego w definicji kolumny: zmiana modelu na taki o innym
> wymiarze jest migracją, nie zmianą konfiguracji.

**Warstwa 3 — LLM jako re-ranker.** Dostaje nową nazwę i kandydatów, zwraca
structured output (schemat Zod przez AI SDK): które pozycje są faktycznie
duplikatem i dlaczego. Dzięki temu użytkownik widzi nie samą listę, lecz
komunikat w rodzaju „to wygląda na to samo co «Wyciskanie sztangi leżąc»
(autor: Kuba)".

Rozdzielenie warstw 2 i 3 jest celowe: **do znalezienia podobnych wystarczą
embeddingi, generatywny model nie jest do tego potrzebny.** Embeddingi kosztują
grosze i odpowiadają w milisekundach, model generatywny kosztuje więcej i
odpowiada sekundy. Warstwę 3 można wyłączyć bez psucia funkcji. Odpowiedzi
cache'owane po slugu.

Offline działa sama warstwa 1. Zgodnie ze specyfikacją utworzenie ćwiczenia
**nigdy nie jest blokowane** — wyświetlamy wyłącznie ostrzeżenie.

## LLM

Vercel AI SDK 7 + `@openrouter/ai-sdk-provider` 3 (wymaga Node 22+, ESM-only).
OpenRouter obsługuje zarówno modele czatowe, jak i embeddingi przez jeden
endpoint, więc cały pipeline zostaje u jednego dostawcy na jednym kluczu.

Wywołania wychodzą **wyłącznie z backendu**. Klucz OpenRouter nie może trafić do
binarki aplikacji mobilnej, bo ta jest w praktyce publiczna.

### Rozpoznawanie mowy — drugi dostawca, ale nie druga biblioteka

Dyktowanie serii potrzebuje czegoś, czego OpenRouter nie wystawia: zamiany
nagrania na tekst. Jest to więc jedyne miejsce, w którym stos wychodzi poza
jednego dostawcę modeli — ale **nie** poza jeden protokół. Transkrypcja idzie
zwykłym `fetch`-em na `POST …/audio/transcriptions`, czyli tam, gdzie mówią tym
samym protokołem Groq (wartość domyślna, bo padł w zgłoszeniu), OpenAI i lokalny
`whisper.cpp` za cienkim serwerkiem. Adres jest zmienną środowiskową, a nie
nazwą dostawcy wpisaną w kod, bo wybór dostawcy nigdy nie był tu decyzją
techniczną — był przykładem.

SDK dostawcy nie wchodzi z tego samego powodu: całe użyte API to jedno pole
formularza i jedno pole odpowiedzi, a paczka przywiązałaby nas do jednej firmy
dokładnie w miejscu, w którym chcemy swobody. Interpretacja transkrypcji —
wskazanie ćwiczenia i wyciągnięcie liczb — jedzie już zwykłym `generateObject`
u OpenRoutera, jak re-ranker duplikatów i tłumaczenie nazw.

Rozpoznawanie mowy jest przy tym **dodatkiem, a nie fundamentem**: to samo
zdanie da się wpisać z klawiatury (`POST /voice/text`) i wtedy przepływ omija
dostawcę transkrypcji w całości. Wdrożenie bez jego klucza dalej ma dyktowanie —
klawiatura Androida ma własny mikrofon, za który nikt nam nie wystawia rachunku.
Nagranie nie jest nigdzie zapisywane: żyje tyle, ile trwa żądanie.

## Infrastruktura

Własny minipc w sieci NetBird. Telefony podpięte do tej samej sieci widzą serwer;
API nie jest wystawione na publiczny internet.

Docker Compose: PostgreSQL 17 (z `pgvector` i `pg_trgm`), API oraz panel admina
za Caddy pełniącym rolę zwykłego reverse proxy, bez TLS. Pliki są w `deploy/`,
a procedury uruchomienia, aktualizacji i odtworzenia w `docs/wdrozenie.md`. CI na GitHub
Actions.

Panel jest **wpieczony w obraz Caddy'ego**, a nie osobnym kontenerem (ustalone
przy realizacji etapu 15). Panel to zbiór plików statycznych, nie proces: osobny
kontener musiałby więc albo uruchomić drugi serwer HTTP obok Caddy'ego, albo
podać mu pliki wolumenem współdzielonym — a wtedy aktualizacja panelu zależy od
kolejności startu i od kontenera pomocniczego, który te pliki kopiuje.

Rozdział ruchu idzie **ścieżką, nie hostem**, żeby panel i API miały jedno
pochodzenie: ciasteczko sesji na osobnym hoście byłoby ciasteczkiem między
witrynami, a takie po HTTP wymaga flag, których po HTTP ustawić się nie da.
Kosztem jest lista ścieżek w `Caddyfile`, o której łatwo zapomnieć przy nowym
endpoincie — ścieżka spoza listy dostaje `index.html` panelu ze statusem 200,
czyli awarię wyglądającą jak błąd parsera u klienta. Pilnuje tego
`apps/api/tests/deploy.test.ts`, sprawdzając obie strony rozdziału.

Testy: Vitest we wszystkich pakietach — `core` i `db` jednostkowo, API
integracyjnie na PGlite w procesie. Aplikacja mobilna i panel mają po **dwa**
zestawy, rozdzielone projektami Vitest:

- `logika` — czyste moduły w Node: siatka kalendarza, punkty wykresu, silnik
  synchronizacji, wyliczanie wyjątków ATS, klient API panelu. Najtańsze
  sprawdzenie, jakie mamy.
- `ekrany` (aplikacja) i `komponenty` (panel) — renderowanie w jsdom. W aplikacji
  ekran jedzie na **prawdziwej** bazie lokalnej: SQLite w pamięci, ten sam bundle
  migracji i ten sam seed, co na telefonie. Dzięki temu test „naciśnij Add set"
  kończy się asercją na wierszu w tabeli `workout_sets`, a nie na atrapie.

W projekcie `ekrany` `react-native` jest podmieniony na `react-native-web`.
Źródła React Native są w składni Flow i nie da się ich wykonać w Node bez
przepuszczenia całej paczki przez Babel; `react-native-web` odwzorowuje `View`,
`Text`, `Pressable`, `TextInput` i `ScrollView` na DOM, więc sprawdzane jest
**nasze** drzewo komponentów, a nie implementacja warstwy natywnej. Przy okazji
jest to dokładnie ta warstwa, na której stanie wersja PWA.

Atrapowana jest wyłącznie warstwa, której poza telefonem nie ma: nawigacja
(`expo-router`), obszar bezpieczny, identyfikator urządzenia, klient
better-autha i zlecenie synchronizacji. Baza lokalna, zapytania, podpowiedzi,
walidacja pomiarów i cały `src/ui` jadą prawdziwe — atrapa reguły sprawdzałaby
atrapę.

Osobno stoi `deploy-stack.yml`: stawia w CI ten sam stos, który jedzie na
minipc, i sprawdza go z zewnątrz — bo wdrożenie da się zepsuć bez tknięcia
jednej linijki kodu aplikacji.

E2E na urządzeniu — rozważane było Maestro — w repozytorium **nadal nie ma**
i testy ekranów tego nie zastępują. Nie sprawdzają nawigacji między ekranami,
gestów, klawiatury ani zachowania SQLite na telefonie; zieleń w CI nie jest
dowodem, że aplikacja działa na urządzeniu. Zmieniło się natomiast to, co było
warunkiem wejścia Maestro: podpisy pól (`accessibilityLabel`) i role przycisków
są już na miejscu, bo bez nich nie dało się napisać testów ekranów. Flow
opierałyby się dziś na nich, a nie na widocznych napisach. Do tego czasu wydania
pilnują: `android-release.yml` (wydanie powstaje) i `deploy-stack.yml` (serwer
odpowiada).

### TLS — świadomie pominięty w MVP

**W MVP nie wystawiamy certyfikatu. API działa po HTTP wewnątrz VPN.**

TLS daje trzy rzeczy: szyfrowanie ruchu, uwierzytelnienie serwera i ochronę
przed manipulacją danych w drodze. NetBird opiera się na WireGuardzie, który
zapewnia dokładnie to samo — ruch między telefonem a minipc jest szyfrowany
(ChaCha20-Poly1305), a peery uwierzytelniają się wzajemnie kluczami publicznymi.
HTTPS byłby tu szyfrowaniem wewnątrz szyfrowania.

W zamian obowiązują trzy warunki:

**Wyjątek cleartext w aplikacji, zawężony do jednego hosta.** iOS blokuje HTTP
przez App Transport Security, Android od API 28 również. W Expo: `ios.infoPlist`
z wyjątkiem ATS dla naszego hosta oraz `expo-build-properties` z
`usesCleartextTraffic` po stronie Androida. Wyjątku nie robimy globalnie.

**Sesja w nagłówku, nie w ciasteczku z flagą `Secure`.** Ciasteczko oznaczone
jako `Secure` nie zostanie wysłane po HTTP. Plugin Expo dla better-auth trzyma
sesję w SecureStore i przekazuje ją nagłówkiem, więc to naturalna ścieżka —
trzeba jedynie świadomie nie włączyć `Secure` po stronie serwera.

**Natywne logowanie Google zamiast przepływu przez przeglądarkę.** Google Cloud
Console wymaga HTTPS dla adresów przekierowania OAuth (poza localhostem).
Natywny Sign-In tego nie dotyczy: telefon pobiera `idToken` od Google publicznym
internetem po HTTPS i przekazuje go do naszego API.

Nasłuch na `0.0.0.0` jest dopuszczony — sieć lokalna minipc jest traktowana jako
zaufana. Oznacza to, że API jest osiągalne plaintextem także z LAN, z pominięciem
VPN. Decyzja świadoma, do rewizji przy zmianie warunków sieciowych.

Decyzja o braku TLS jest odwracalna — Caddy już stoi przed API, więc włączenie
certyfikatu to zmiana jego konfiguracji, nie refaktor. Wraca na stół dopiero
wtedy, gdyby API miało wyjść poza VPN; wówczas ścieżką jest domena z rekordem A
na adres NetBird i wyzwanie DNS-01.

### Ruch wychodzący

Minipc potrzebuje dostępu do internetu dla: OpenRouter, pobrania kluczy
publicznych Google przy weryfikacji `idToken`, kopii zapasowych oraz obrazów
Dockera.

### Kopie zapasowe — Google Drive

Baza na minipc jest jedyną kopią danych całej grupy. Awaria dysku kasuje pełną
historię treningową wszystkich użytkowników.

Nie zrzucamy całej bazy. Kopia obejmuje wyłącznie dane nieodtwarzalne.

**W kopii:** serie, ćwiczenia, tagi, cykle oraz minimalne dane użytkowników
(`id`, e-mail, nick, rola).

> **E-mail w archiwum jest nullowalny** (ustalone przy realizacji etapu 14). Ten
> sam format obsługuje eksport z aplikacji, a baza lokalna zna adres wyłącznie
> właściciela telefonu — adresy pozostałych osób nie są potrzebne do niczego, co
> robi aplikacja, więc pull ich tam nie rozsyła. Konto bez adresu jest w archiwum
> obecne po to, by `author_id` przy ćwiczeniu na coś wskazywał, ale nie da się go
> dopasować ani założyć przy odtwarzaniu, bo dopasowanie idzie właśnie po adresie.
> Wartość zastępcza byłaby gorsza niż `null`: import utworzyłby z niej drugie
> konto tej samej osoby. Kopia systemowa z serwera ma adresy wszystkich kont, więc
> pełne odtworzenie po awarii nie jest tym ograniczone.

**Poza kopią:**

| Pominięte            | Dlaczego                              |
| -------------------- | ------------------------------------- |
| hashe haseł, sesje   | wrażliwe, a do odtworzenia zbędne     |
| klucze API           | użytkownik wygeneruje nowe            |
| embeddingi           | przeliczalne z nazw ćwiczeń           |
| rekordy, rankingi    | pochodne z serii                      |

Minimalny zapis użytkowników jest konieczny, mimo że dane logowania pomijamy.
Bez niego po odtworzeniu `author_id` przy ćwiczeniach i właściciel przy seriach
wskazywałyby w próżnię — użytkownicy zalogowaliby się ponownie przez Google,
dostali nowe identyfikatory, a odtworzone dane zostałyby osierocone. Zachowanie
samego `id` i e-maila wystarcza: po restore dopasowanie następuje po adresie
e-mail, a powiązania zostają nienaruszone.

Zestaw: **eksport JSON → gzip → `age` → `rclone copy` → Google Drive**, z crona.

Eksport używa **dokładnie tego samego kodu, którego specyfikacja wymaga do
eksportu i importu danych przez użytkownika**. Jeden serializer, przetestowany
tym, że jest używany w dwóch miejscach — i gwarancja, że ścieżka odtwarzania nie
zardzewieje, bo korzystają z niej także zwykli użytkownicy.

Szyfrowanie przez `age` (jedno polecenie w pipe, klucz publiczny odbiorcy).
Wybrane nie dlatego, że wymagamy silnej ochrony, lecz dlatego, że jest tak samo
proste jak rozwiązania słabsze — a plik zawiera adresy e-mail i pełną historię
treningową wszystkich użytkowników i trafia do usługi zewnętrznej.

Retencja: pliki nazwane datą, `rclone delete --min-age 90d`. Przy tej wielkości
danych dedup i polityki retencji restica są zbędną złożonością.

Konfiguracja dostępu do Google Drive ma dwie pułapki:

- **Konto usługowe nie zadziała** na zwykłym koncie Google. Service account ma
  własny Dysk bez przydziału miejsca, a obejście przez Shared Drive wymaga
  Google Workspace. Używamy więc OAuth na koncie właściciela —
  `rclone authorize` wykonujemy na maszynie z przeglądarką i przenosimy token na
  minipc.
- **Token odświeżania wygasa po 7 dniach**, jeśli aplikacja OAuth w Google Cloud
  Console pozostaje w stanie „Testing". Trzeba przełączyć ją na „In production".
  Zakładamy własny client ID (wbudowany w rclone jest współdzielony i
  limitowany) z zakresem `drive.file`, który daje dostęp wyłącznie do plików
  utworzonych przez tę aplikację.

### Szyfrowanie i odtwarzanie

`age` działa asymetrycznie — jeden klucz szyfruje, drugi odszyfrowuje. Parę
generujemy raz:

```
age-keygen -o klucz-alphapump.txt
```

Powstaje plik z kluczem prywatnym (`AGE-SECRET-KEY-1...`) oraz wypisany klucz
publiczny (`age1...`).

Na minipc trafia **wyłącznie klucz publiczny**. Kluczem publicznym można jedynie
zaszyfrować, więc włamanie na minipc nie daje dostępu do kopii leżących na
Dysku. Przy szyfrowaniu hasłem hasło musiałoby siedzieć w cronie i przejęcie
serwera oznaczałoby przejęcie wszystkich kopii.

Tworzenie kopii:

```
pnpm --filter api export --format=json \
  | gzip \
  | age -r age1... \
  > alphapump-$(date +%F).json.gz.age
rclone copy alphapump-*.json.gz.age gdrive:alphapump-backups/
```

Odtwarzanie:

```
rclone copy gdrive:alphapump-backups/alphapump-2026-08-10.json.gz.age .
age -d -i klucz-alphapump.txt alphapump-2026-08-10.json.gz.age | gunzip > backup.json
pnpm --filter api import backup.json
```

Ostatni krok to ten sam import, którego używa funkcja importu danych
użytkownika — dzięki czemu ścieżka odtwarzania jest sprawdzana przy normalnym
korzystaniu z aplikacji, a nie dopiero w sytuacji awaryjnej.

#### Przechowywanie klucza prywatnego

Najczęstsza przyczyna bezużytecznych kopii zapasowych: klucz prywatny leżał
wyłącznie na maszynie, której te kopie dotyczyły.

- klucz **nigdy** nie leży na minipc,
- klucz **nigdy** nie leży na Google Drive obok kopii,
- minimum dwa niezależne miejsca: menedżer haseł oraz wydruk (klucz age to jedna
  linia tekstu).

Comiesięczna próba odtworzenia w CI również potrzebuje klucza. Zamiast wystawiać
tam klucz główny, szyfrujemy do dwóch odbiorców naraz — `age` przyjmuje wiele
flag `-r`:

```
age -r age1_klucz_glowny -r age1_klucz_ci
```

CI dostaje własny klucz w sekretach repozytorium, klucz główny pozostaje poza
zasięgiem automatyki.

Kopia, której nigdy nie odtworzono, nie jest kopią. Raz w miesiącu odtwarzamy
eksport do bazy testowej jako zadanie w CI, żeby nie zależało to od pamięci.

### Konsekwencja dla UX

Aktywne połączenie NetBird jest warunkiem synchronizacji. Gdy telefon jest poza
VPN, aplikacja pracuje offline — i musi to komunikować jako spokojny status
„offline", nie jako błąd.

## Odrzucone alternatywy

**Flutter** — szybszy start UI i lepsza wydajność out-of-the-box, ale
uniemożliwia współdzielenie logiki frontu Pareto i cykli z backendem. Trzeba by
ją pisać dwa razy, w Dart i TypeScript.

**Supabase** — kusi zestawem auth + Postgres + realtime z pudełka, ale wymóg
pracy w VPN oznacza self-hosting, a self-hostowany Supabase to znacznie cięższa
infrastruktura niż Hono + Postgres. Jego model synchronizacji i tak trzeba by
nadpisać.

**PowerSync** — najdojrzalszy silnik synchronizacji dla React Native, ale
dokłada usługę do infrastruktury przy wąskim zakresie realnego synca w tym
projekcie.

**ElectricSQL, Zero** — oba świadomie nie obsługują pełnego trybu offline, co
jest tu wymaganiem twardym.

**NestJS** — nieproporcjonalnie dużo ceremonii jak na rozmiar tego API.

**tRPC** — Hono RPC daje to samo, a przy okazji OpenAPI dla bota Discord.

## Otwarte kwestie

- **Model embeddingów jest wybrany domyślnie, ale niezmierzony.** Domyślną
  wartością jest `qwen/qwen3-embedding-0.6b` (wielojęzyczny, 1024 wymiary —
  tyle ma kolumna), a `EMBEDDING_MODEL` pozwala go podmienić bez zmiany kodu.
  Pomiaru na kilkudziesięciu realnych parach nazw nie wykonano; kandydatem do
  porównania pozostaje Cohere Embed v4. Zmiana na model o **innym wymiarze**
  jest migracją, nie zmianą konfiguracji — indeks HNSW ma wymiar wpisany
  w definicję kolumny.
- Termin wejścia iOS i moment zakupu konta Apple Developer — patrz sekcja
  „iOS — odłożone, ale nie zamknięte".
- Testy E2E aplikacji na urządzeniu — patrz „Infrastruktura". Testy ekranów
  w jsdom pokrywają logikę ekranu i zapis do bazy lokalnej, ale nie nawigację,
  gesty ani zachowanie SQLite na telefonie; to zostaje otwarte.
- **Klucz podpisujący aplikację na Androida.** Bez sekretu
  `ANDROID_KEYSTORE_BASE64` wydanie jest podpisywane kluczem deweloperskim
  z szablonu React Native — publicznie znanym. Działa to do rozdania w grupie,
  ale przejście na własny klucz wymaga potem odinstalowania aplikacji na każdym
  telefonie, bo system nie pozwala podmienić pakietu podpisanego innym kluczem.
  Decyzja jest więc jednorazowa i zapada przed pierwszym rozdaniem, nie po nim.
