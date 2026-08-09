# Stack technologiczny

Dokument opisuje wybrany stack, architekturę i decyzje projektowe dla AlphaPump.
Uzupełnia `specyfikacja_biznesowa.md` — tam jest *co*, tutaj *czym* i *jak*.

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
  api-client/   typowany klient (Hono RPC)
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

Expo SDK 57 (React Native 0.85, React 19.2).

| Warstwa      | Wybór                              | Uzasadnienie                                            |
| ------------ | ---------------------------------- | ------------------------------------------------------- |
| Nawigacja    | Expo Router                        | file-based, deep linking bez konfiguracji               |
| Baza lokalna | expo-sqlite + Drizzle              | `useLiveQuery` — zapis do bazy sam przerysowuje UI      |
| Styling      | NativeWind + react-native-reusables | dark theme i spójne komponenty z pudełka                |
| Listy        | FlashList                          | historia serii bywa długa                               |
| Wykresy      | victory-native XL (Skia)           | minimalistyczne i płynne, dokładnie w stylu ze spec     |
| Animacje     | Reanimated + Gesture Handler       | zmiana kolejności serii w obrębie dnia                  |
| Auth         | better-auth + `@better-auth/expo`  | wspólny mechanizm z backendem                           |
| Buildy       | EAS Build + EAS Update             | poprawki OTA bez przechodzenia przez sklep              |

### Dlaczego `useLiveQuery` ma znaczenie

Zapis idzie do SQLite, a każdy ekran czytający te dane odświeża się sam. To
realizuje wymóg „natychmiastowa reakcja UI na zapis lokalny" bez żadnej warstwy
zarządzania stanem serwerowym — nie ma cache'a do unieważniania, bo źródłem
prawdy jest baza.

Dwie pułapki do zapamiętania:

- baza musi być otwarta z `enableChangeListener: true` (domyślnie wyłączone),
- znany bug: `useLiveQuery` nie odświeża komponentu, gdy zapytanie zwraca zero
  wierszy ([drizzle-orm#2620](https://github.com/drizzle-team/drizzle-orm/issues/2620)).

Stan czysto UI-owy (filtry, otwarte modale) trzyma Zustand. Dane siedzą w SQLite.

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
odtworzyć z samych serii. Daje to przy okazji darmowy eksport/import JSON —
wystarczy zrzucić serie, ćwiczenia i tagi.

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

Kolor tagu wyliczany jest deterministycznie z hasha sluga na paletę ok. 20
kolorów. Dzięki temu tag utworzony offline ma od razu finalny kolor i nie zmienia
go po synchronizacji. Serwer może skorygować przy kolizji, a klient przyjmie jego
wersję przy pull.

## Synchronizacja

Silnik własny, oparty na outboxie i kursorze. Rozważane były PowerSync,
ElectricSQL i Zero — dwa ostatnie odpadają, bo świadomie nie obsługują pełnego
trybu offline. PowerSync jest dojrzały, ale wprowadza dodatkową usługę do
infrastruktury, a zakres realnej synchronizacji dwukierunkowej jest tu wąski:
biblioteka ćwiczeń, tagi, rekordy globalne i rankingi jadą wyłącznie w dół.

### Mechanika

- każdy synchronizowany wiersz ma `updated_at`, `deleted_at` i `server_seq`,
- lokalna tabela `outbox` — append-only log mutacji,
- push: batch mutacji z outboxu,
- pull: kursor po `server_seq`,
- po każdym pullu przeliczane są dane pochodne (rekordy, cykle) dla dotkniętych
  ćwiczeń.

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

| Encja              | Kto zapisuje              | Strategia                          |
| ------------------ | ------------------------- | ---------------------------------- |
| seria              | właściciel                | suma + LWW + tombstone             |
| cykl               | właściciel                | LWW per wiersz                     |
| ćwiczenie          | **tylko autor** (+ admin) | id deterministyczne → suma; edycja LWW |
| tag                | każdy tworzy, edytuje admin | id deterministyczne → suma       |
| rekordy, rankingi  | wyłącznie serwer          | pull-only, zawsze przeliczalne     |

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
(`pg_trgm` + polski `tsvector`) oraz semantyczne (`pgvector`, indeks HNSW,
odległość kosinusowa). Embedding liczony **raz, przy tworzeniu ćwiczenia**, nie
przy każdym zapytaniu. Obie listy scalane przez RRF do ok. 10 kandydatów. Ta
warstwa łapie to, czego pierwsza nie może — że „martwy ciąg" i „deadlift" to to
samo ćwiczenie.

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

## Infrastruktura

Własny minipc w sieci NetBird. Telefony podpięte do tej samej sieci widzą serwer;
API nie jest wystawione na publiczny internet.

Docker Compose: PostgreSQL 17 (z `pgvector` i `pg_trgm`), API, panel admina za
Caddy. CI na GitHub Actions. Testy: Vitest dla `core` i API, Maestro dla E2E
mobilnego.

### TLS — świadomie pominięty w MVP

**W MVP nie wystawiamy certyfikatu. API działa po HTTP wewnątrz VPN.**

TLS daje trzy rzeczy: szyfrowanie ruchu, uwierzytelnienie serwera i ochronę
przed manipulacją danych w drodze. NetBird opiera się na WireGuardzie, który
zapewnia dokładnie to samo — ruch między telefonem a minipc jest szyfrowany
(ChaCha20-Poly1305), a peery uwierzytelniają się wzajemnie kluczami publicznymi.
HTTPS byłby tu szyfrowaniem wewnątrz szyfrowania.

W zamian obowiązują cztery warunki:

**Nasłuch wyłącznie na interfejsie NetBird.** Ważniejsze niż certyfikat. Przy
nasłuchu na `0.0.0.0` każdy w lokalnej sieci minipc dosięgnie API plaintextem z
pominięciem VPN. Wiązanie musi być na adres NetBird (`100.x.x.x`).

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

Decyzja jest odwracalna — dołożenie Caddy z certyfikatem to zmiana konfiguracji,
nie refaktor. Wraca na stół dopiero wtedy, gdyby API miało wyjść poza VPN;
wówczas ścieżką jest domena z rekordem A na adres NetBird i wyzwanie DNS-01.

### Ruch wychodzący

Minipc potrzebuje dostępu do internetu dla: OpenRouter, pobrania kluczy
publicznych Google przy weryfikacji `idToken`, kopii zapasowych oraz obrazów
Dockera.

### Kopie zapasowe — Google Drive

Baza na minipc jest jedyną kopią danych całej grupy. Awaria dysku kasuje pełną
historię treningową wszystkich użytkowników.

Zestaw: **`pg_dump -Fc` → restic → rclone → Google Drive**, uruchamiany z crona.

Restic robi trzy rzeczy naraz, których osobno nie chcemy pisać: deduplikację,
politykę retencji (`--keep-daily 7 --keep-weekly 4`) i **szyfrowanie po stronie
klienta**. To ostatnie jest tu istotne — zrzut zawiera dane treningowe całej
grupy oraz tabele autoryzacji z hashami haseł i kluczami API, a trafia do usługi
zewnętrznej. Skoro restic szyfruje natywnie, warstwa `crypt` w rclone jest
zbędna.

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

Kopia, której nigdy nie odtworzono, nie jest kopią. Raz w miesiącu odtwarzamy
zrzut do bazy testowej — najlepiej jako zadanie w CI, żeby nie zależało od
pamięci.

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

- Wybór konkretnego modelu embeddingów w OpenRouter (kandydaci: Qwen3 Embedding,
  Cohere Embed v4 — oba wielojęzyczne, co ma znaczenie przy polskich nazwach
  ćwiczeń). Warto zmierzyć na kilkudziesięciu realnych parach nazw, zanim
  zapadnie decyzja.
- Dystrybucja iOS: TestFlight wymaga konta Apple Developer (99 USD rocznie).
  Publikacja w App Store dołożyłaby wymóg Sign in with Apple obok logowania
  Google.
