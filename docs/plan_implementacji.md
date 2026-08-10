# Plan implementacji

Dokument dzieli budowę AlphaPump na etapy. Opisuje *co* i *w jakiej kolejności*,
bez schodzenia do poziomu pojedynczych plików — szczegóły powstają dopiero przy
realizacji danego etapu.

Wymagania produktowe są w `specyfikacja_biznesowa.md`, decyzje techniczne w
`stack_technologiczny.md`. Ten dokument nie powtarza ani jednych, ani drugich.

## Jak czytać ten plan

Każdy etap to jedna zamknięta całość: własna gałąź, własny PR, własne kryterium
ukończenia. Etap uznajemy za zrobiony dopiero wtedy, gdy przechodzi swoje
„gotowe, gdy" — nie wtedy, gdy kod jest napisany.

Kolejność wynika z trzech zasad:

1. **Poprawność przed interfejsem.** Reguły domenowe (front Pareto, cykle,
   identyfikatory) powstają i są testowane, zanim istnieje jakikolwiek ekran.
   Błąd w tej warstwie jest niewidoczny, a zatruwa rekordy, rankingi i cykle
   naraz.
2. **Ryzyko przed wygodą.** Synchronizacja i offline wchodzą wcześnie, bo to one
   mogą wymusić zmiany w modelu danych. Wykresy i rankingi nie zmuszą do niczego.
3. **Działający produkt jak najwcześniej.** Po etapie 6 aplikacja jest już
   używalna do tego, do czego powstała — zapisywania serii. Reszta to
   rozbudowa wokół działającego rdzenia.

---

## Etap 0 — Fundament repozytorium

**Cel:** puste, ale w pełni działające monorepo z CI.

- pnpm workspaces + Turborepo, wspólna konfiguracja TypeScript,
- lint i formatowanie, jednolite dla wszystkich pakietów,
- GitHub Actions: build, test, lint na każdym PR,
- szkielety pakietów `core`, `db`, `api-client` i aplikacji `mobile`, `api`,
  `admin` — na razie puste.

**Gotowe, gdy:** CI przechodzi na zielono na pustym repozytorium, a `pnpm build`,
`pnpm test` i `pnpm lint` działają lokalnie i zdalnie tak samo.

## Etap 1 — Rdzeń domenowy (`packages/core`)

**Cel:** wszystkie reguły biznesowe, które muszą działać identycznie na telefonie
i na serwerze.

- typy encji i jednostki (wartości całkowite: gramy, sekundy, metry),
- `slug()` oraz wyliczanie deterministycznych identyfikatorów ćwiczeń i tagów,
- front Pareto dla wszystkich pięciu typów logowania,
- dopasowywanie serii do celów cyklu,
- podpowiadanie wartości kolejnej serii,
- deterministyczny kolor tagu,
- schematy Zod współdzielone przez API, aplikację i formularze.

**Gotowe, gdy:** pakiet nie ma żadnej zależności od I/O, testy pokrywają wszystkie
typy logowania i przypadki brzegowe (remis, dominacja, seria historyczna), a
`slug()` i identyfikatory mają testy golden traktowane jak kontrakt — ich zmiana
musi wymagać świadomej decyzji, bo przepisuje id istniejących danych.

## Etap 2 — Schemat danych (`packages/db`)

**Cel:** jeden opis schematu, dwa dialekty.

- schematy Drizzle dla Postgresa i SQLite,
- pola wspólne dla synchronizacji: `updated_at`, `deleted_at`, `server_seq`,
- migracje po obu stronach,
- seed: konto systemowe, wbudowane ćwiczenia i tagi startowe.

**Gotowe, gdy:** migracje przechodzą na czystej bazie Postgres i na czystym pliku
SQLite, a seed daje po obu stronach identyczne identyfikatory ćwiczeń
wbudowanych.

## Etap 3 — Backend: autoryzacja i API danych

**Cel:** serwer, z którym da się rozmawiać.

- szkielet Hono, konfiguracja, healthcheck,
- better-auth: e-mail + hasło, Google, tokeny API, role,
- CRUD serii, ćwiczeń, tagów i cykli z egzekwowaniem uprawnień
  (edycja i usuwanie ćwiczeń tylko przez autora lub administratora),
- generowanie OpenAPI.

**Gotowe, gdy:** można założyć konto, zalogować się oboma metodami, wygenerować
token API i wykonać nim CRUD serii — czyli kryterium akceptacyjne dotyczące API
jest spełnione, zanim powstanie aplikacja mobilna.

## Etap 4 — Backend: synchronizacja

**Cel:** obie strony protokołu wymiany danych.

- `POST /sync/push` i `GET /sync/pull?since=`,
- rozstrzyganie konfliktów: suma, LWW po `updated_at`, wygrywające usunięcie,
- przycinanie timestampów z przyszłości, rozstrzyganie remisów po `device_id`,
- przeliczanie danych pochodnych po stronie serwera — na tym etapie powstaje
  wyłącznie zbieranie zakresu dotkniętego pushem i miejsce wpięcia przeliczeń,
  bo jedyne serwerowe dane pochodne wchodzą dopiero w etapie 11 i tam jest ten
  dług odnotowany,
- porządkowanie tombstone'ów.

**Gotowe, gdy:** testy integracyjne symulujące dwa urządzenia pracujące offline
potwierdzają wszystkie trzy reguły konfliktów, w tym scenariusz „jedno usuwa,
drugie edytuje".

## Etap 5 — Aplikacja: szkielet i dane lokalne

**Cel:** aplikacja, która się uruchamia, loguje i trzyma dane u siebie.

- Expo, Expo Router, NativeWind, dark theme,
- SQLite z Drizzle i `useLiveQuery`,
- logowanie e-mailem i przez Google, przechowywanie sesji,
- konfiguracja ATS i cleartext dla obu platform od razu,
- build na symulator iOS w CI.

**Gotowe, gdy:** użytkownik loguje się, dane zapisują się lokalnie, a zmiana
w bazie przerysowuje ekran bez ręcznego odświeżania.

## Etap 6 — Logowanie serii

**Cel:** najważniejszy ekran produktu.

- widok dnia: lista serii, wybór ćwiczenia, dodanie kolejnej serii,
- edycja, usuwanie i zmiana kolejności serii,
- wejście w istniejącą serię jako punkt startowy następnej,
- podpowiadanie wartości,
- informacja o rekordzie przy zapisie,
- ten sam widok dla dnia bieżącego i historycznego.

**Gotowe, gdy:** cały przepływ działa w trybie samolotowym, informacja o rekordzie
pojawia się bez sieci, a zapis serii wymaga możliwie najmniejszej liczby kroków.
Od tego etapu aplikacja ma realną wartość użytkową.

## Etap 7 — Synchronizacja w aplikacji

**Cel:** domknięcie obiegu danych między urządzeniami.

- tabela `outbox` i kolejkowanie mutacji,
- push i pull z ponawianiem i wycofywaniem,
- praca w tle i reakcja na powrót łączności,
- status synchronizacji w interfejsie, z brakiem VPN jako spokojnym „offline",
- przeliczanie rekordów po każdym pullu.

**Gotowe, gdy:** dwa urządzenia pracujące offline po synchronizacji nie gubią
serii ani nie tworzą duplikatów, a interfejs ani razu nie blokuje się na
operacji sieciowej.

## Etap 8 — Biblioteka ćwiczeń i tagi

**Cel:** zarządzanie słownikiem, na którym stoi reszta.

- przeglądanie i filtrowanie biblioteki po tagach,
- tworzenie ćwiczeń i tagów, także offline,
- ostrzeganie o podobnych ćwiczeniach w oparciu o lokalne wyszukiwanie
  pełnotekstowe, bez blokowania zapisu.

**Gotowe, gdy:** przepływ „wybierz tag, zobacz ćwiczenia, dodaj nowe" działa bez
sieci, a ostrzeżenie o duplikacie pojawia się offline.

## Etap 9 — Cykle

**Cel:** cele treningowe i ich rozliczanie.

- definiowanie cyklu z wieloma pozycjami celu i zakresem dat,
- automatyczne zaliczanie serii do wszystkich pasujących cykli,
- postęp, reset z zachowaniem historii, archiwum,
- skrót wyboru ćwiczenia z listy pozycji pozostałych do wykonania.

**Gotowe, gdy:** cykl poprawnie zlicza serie, czas i dystans, a usunięcie serii
odpowiednio zmniejsza postęp.

## Etap 10 — Kalendarz i wykresy

**Cel:** przeglądanie historii.

- kalendarz miesięczny i tygodniowy z liczbą serii w kafelku dnia,
- wejście w dzień prowadzące do tego samego widoku co dzień bieżący,
- ekran analityczny ćwiczenia z przełączaniem metryk.

**Gotowe, gdy:** kalendarz pokazuje liczbę serii dla każdego dnia, a wykres
ćwiczenia odpowiada jego typowi logowania.

## Etap 11 — Rekordy globalne i rankingi

**Cel:** wymiar społecznościowy, jedyny obszar wymagający danych innych osób.

- serwerowe wyznaczanie rekordów globalnych,
- rankingi: objętość ciężaru, suma dystansu, zestawienia osiągnięć,
- **wpięcie przeliczania po pushu — dług z etapu 4** (patrz niżej),
- ekrany w aplikacji, zasilane danymi tylko do odczytu,
- pilnowanie prywatności: na zewnątrz wychodzą wyłącznie wartość, nick, data
  i notatka serii.

> **Dług z etapu 4.** Etap 4 wymagał „przeliczania danych pochodnych po stronie
> serwera", ale przeliczać nie było czego: jedyne dane pochodne trzymane na
> serwerze to właśnie rekordy globalne i rankingi, a rekordy indywidualne
> z definicji nie przechodzą przez synchronizację. Powstał więc sam zaczep —
> `apps/api/src/sync/derived.ts` zbiera po każdym pushu zakres dotknięty zmianą
> (para użytkownik + ćwiczenie) i przepuszcza go przez pustą listę przeliczeń,
> wołaną z `POST /sync/push`. **Ten etap ma tę listę wypełnić.** Zakres jest
> zbierany, bo po zapisie nie da się go już odtworzyć, a przeliczanie wszystkiego
> przy każdym pushu jest liniowe względem całej bazy.

**Gotowe, gdy:** rankingi zgadzają się z niezależnym przeliczeniem z surowych
serii, historia serii pozostaje niedostępna dla innych użytkowników, a zapis
serii przez `POST /sync/push` przelicza rekordy globalne dotkniętych ćwiczeń —
czyli lista przeliczeń w `derived.ts` przestaje być pusta.

## Etap 12 — Wyszukiwanie semantyczne i LLM

**Cel:** podniesienie jakości wykrywania duplikatów.

- `pgvector` i liczenie embeddingów przy tworzeniu ćwiczenia,
- wyszukiwanie hybrydowe: leksykalne plus wektorowe, scalane przez RRF,
- re-ranker przez OpenRouter zwracający uzasadnienie,
- cache odpowiedzi, wyłącznik całej warstwy.

**Gotowe, gdy:** zapytanie o „martwy ciąg" znajduje „deadlift", a wyłączenie tej
warstwy nie psuje tworzenia ćwiczeń — wraca wtedy zachowanie z etapu 8.

Etap jest celowo późno: warstwa lokalna wystarcza, żeby produkt działał, a ta
wyłącznie poprawia trafność.

## Etap 13 — Panel administracyjny

**Cel:** minimum do zarządzania systemem.

- Vite, React, TanStack Router, shadcn/ui,
- zarządzanie użytkownikami, ćwiczeniami i tagami,
- podstawowy wgląd w dane systemowe.

**Gotowe, gdy:** administrator wykonuje wszystkie operacje z zakresu opisanego
w specyfikacji, bez sięgania do bazy.

## Etap 14 — Eksport, import i kopie zapasowe

**Cel:** dane dają się wyjąć i wstawić z powrotem.

- serializer i deserializer JSON, wspólny dla funkcji użytkownika i kopii,
- eksport i import z poziomu aplikacji,
- skrypt kopii: eksport, gzip, `age`, `rclone` na Google Drive,
- retencja i comiesięczna próba odtworzenia w CI.

**Gotowe, gdy:** kopia z Dysku zostaje odtworzona do czystej bazy, a dane po
odtworzeniu zgadzają się z oryginałem — łącznie z powiązaniami autorów ćwiczeń
i właścicieli serii.

## Etap 15 — Wdrożenie

**Cel:** system działa na docelowej maszynie.

- Docker Compose na minipc: Postgres, API, panel, Caddy jako reverse proxy,
- dostęp przez NetBird, cron kopii zapasowych,
- dystrybucja aplikacji na Androida,
- procedura aktualizacji i odtwarzania spisana w README.

**Gotowe, gdy:** grupa korzysta z aplikacji na własnych telefonach, a odtworzenie
z kopii zostało wykonane co najmniej raz na sucho.

## Etap 16 — iOS (po MVP)

**Cel:** druga platforma.

- konto Apple Developer i poświadczenia podpisywania w EAS,
- weryfikacja przepływów na urządzeniu,
- dystrybucja przez TestFlight.

**Gotowe, gdy:** osoba korzystająca z iOS używa aplikacji na równi z resztą grupy.

---

## Co nie wchodzi do planu

Zgodnie ze specyfikacją poza zakresem pozostają: reset hasła przez e-mail,
rozbudowane funkcje społecznościowe, wiele drużyn, integracje z urządzeniami
ubieralnymi, powiadomienia push, rozbudowane plany treningowe oraz analityka per
partia mięśniowa poza widokiem cykli.

Bot Discord nie jest częścią tego planu. Etap 3 dostarcza API i tokeny, których
bot potrzebuje; sam bot to osobny projekt.
