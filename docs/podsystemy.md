# Podsystemy

Po jednej sekcji na część systemu: co robi, jak się ją uruchamia osobno i które
reguły są w niej nieoczywiste. Zakres i reguły biznesowe opisuje
[`specyfikacja_biznesowa.md`](specyfikacja_biznesowa.md), decyzje techniczne —
[`stack_technologiczny.md`](stack_technologiczny.md); tutaj jest to, co
przydaje się przy pracy z konkretnym pakietem.

## Baza danych

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

## API

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
| `/admin/library/*` | porządkowanie biblioteki: użycie, scalanie, przywracanie |

Uwierzytelnienie idzie dwiema drogami: nagłówkiem `Authorization: Bearer …`
(sesja, tak korzysta aplikacja) albo `x-api-key` (token API, tak korzysta bot
Discord). Serie są prywatne — także administrator nie widzi cudzej historii.

### Tokeny API

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

## Rekordy globalne i rankingi

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

## Wykrywanie duplikatów ćwiczeń

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

## Dyktowanie serii

Dwa wejścia i jeden mózg (`apps/api/src/voice/`):

| Trasa         | Wejście                   | Czego wymaga              |
| ------------- | ------------------------- | ------------------------- |
| `/voice/set`  | nagranie (`multipart`)    | transkrypcji **i** modelu |
| `/voice/text` | opis z klawiatury (JSON)  | samego modelu             |

Kroki, przez które przechodzą:

| Krok | Gdzie                                 | Czym                                            |
| ---- | ------------------------------------- | ----------------------------------------------- |
| 1    | telefon (`src/screens/dictate.tsx`)   | `expo-audio`: 16 kHz mono, najwyżej 30 sekund — **albo** pole tekstowe, które tego kroku nie ma |
| 2    | serwer (`voice/speech.ts`)            | `POST …/audio/transcriptions`, domyślnie Groq — tylko dla nagrania |
| 3    | serwer (`voice/interpreter.ts`)       | model przez OpenRoutera, structured output        |

Wejście tekstowe nie jest wariantem awaryjnym: klawiatura Androida ma własny
mikrofon i własną transkrypcję, za którą nie płacimy, więc „podyktuj
klawiaturą" jest pełnoprawną drogą — a wpisane zdanie da się poprawić przed
wysłaniem. Dlatego to **model** jest warunkiem koniecznym dyktowania, a klucz
transkrypcji tylko dokłada do niego mikrofon: `voiceAvailable` pyta o pierwsze,
`speechAvailable` o oba.

Model dostaje transkrypcję i **kontekst z bazy** (`voice/context.ts`): do stu
ćwiczeń użytkownika — tych, na które ma serie, i tych, które sam założył, od
najczęściej wykonywanego — oraz dwadzieścia ostatnich serii. Historia jest tam
po to, żeby dało się zrozumieć zdanie niepełne („jeszcze osiem") i ocenić skalę
usłyszanej liczby.

Odpowiada **numerem pozycji z listy**, nie identyfikatorem — ten sam wzorzec co
przy re-rankerze duplikatów i z tego samego powodu: UUID przepisany przez model
z jednym przekręconym znakiem trafiłby w cudze ćwiczenie, a numer spoza zakresu
odrzuca `applyVoiceVerdict` w rdzeniu. Tam też wycinane są pomiary spoza osi typu
logowania („dwadzieścia powtórzeń deski") i przeliczane kilogramy na gramy.

**Serwer nie zapisuje serii** — oddaje transkrypcję i wypełniony formularz.
Zapis dzieje się na telefonie i tylko tam, a co się dzieje po rozpoznaniu,
rozstrzyga przełącznik w ustawieniach (`src/dictation/`, reguła w
`dictationOutcome`):

| Tryb            | Co robi ekran dyktowania                                     |
| --------------- | ------------------------------------------------------------ |
| `form` (domyślny) | przechodzi do `src/screens/log.tsx` z wartościami w parametrach adresu (`src/voice-draft.ts`) |
| `save`          | zapisuje serię przez `src/db/sets.ts` — tą samą drogą co z palca — i zostaje na miejscu, gotowy na następną |

Tryb `save` nie omija kompletności: serii bez pól wymaganych przez jej typ
logowania nie da się zapisać, więc taka trafia do formularza niezależnie od
ustawienia. Brak dopasowania nie jest awarią: aplikacja pokazuje wtedy
transkrypcję z powodem i proponuje zwykły wybór ćwiczenia z listy.

Wyłączniki są dwa i znaczą dwie różne rzeczy. `VOICE_ENABLED=false` albo
wyłączona warstwa LLM zabiera dyktowanie w całości — oba endpointy oddają 503.
Brak samego `SPEECH_TO_TEXT_API_KEY` zabiera **mikrofon**: `/voice/set` oddaje
503, a `/voice/text` działa dalej i ekran mówi wprost, żeby napisać albo
podyktować klawiaturą. W obu przypadkach zapis serii formularzem działa bez
zmian. Awaria dostawcy w trakcie żądania też kończy się 503, a nie 500: to nie
jest błąd w naszym kodzie, a ekran ma powiedzieć „spróbuj jeszcze raz". Nagranie
nie jest nigdzie zapisywane — żyje tyle, ile trwa żądanie. Testy integracyjne
podstawiają obie warstwy (`apps/api/tests/voice.test.ts`), więc CI nie zależy ani
od cudzej usługi, ani od klucza w sekretach.

### Dyktowanie z zegarka Pebble

Osobna aplikacja (`services/pebble/`), która **nie dokłada do API niczego** —
korzysta z dwóch endpointów, które już były, i z tokenów API, które powstały dla
bota Discord:

```
Pebble ──dictation──▶ tekst ──AppMessage──▶ PebbleKit JS (w aplikacji Pebble na telefonie)
                                                  │ POST /voice/text   → rozpoznana seria
                                                  │ POST /sets         → zapis
                                            AlphaPump API ──sync──▶ telefon
```

Rzecz, która rozstrzyga o kształcie całości: **Pebble nie oddaje nagrania**.
Dictation API daje gotowy tekst, a dźwięku aplikacja na zegarku nie widzi w ogóle
— transkrypcja dzieje się w aplikacji Pebble i u dostawcy mowy (Rebble albo Core
Devices), poza naszym kodem i poza naszym rachunkiem. Dlatego zegarek wpina się
w wejście **tekstowe**, które i tak powstało dla klawiatury.

Zegarek ma własny przycisk sprawdzenia połączenia: `GET /health` bez tokenu
(czy telefon w ogóle dosięga API), a potem `GET /me` z tokenem (czy token żyje).
Rozdzielenie tych dwóch jest całym sensem tego przycisku — pierwszy podejrzany
przy „nie działa" to czysty HTTP przepuszczany przez cudzą aplikację.

Reguła „model nie zapisuje sam" obowiązuje tu tak samo jak w telefonie: po
rozpoznaniu zegarek domyślnie pokazuje serię i czeka na naciśnięcie, a zapis bez
potwierdzenia jest ustawieniem, które trzeba włączyć. Serii niekompletnej nie
zapisze w żadnym trybie — formularza na zegarku nie ma, więc jedynym wyjściem
jest powtórzenie zdania.

Testy ma **połowa telefonowa** — to w niej siedzi cała decyzyjność, a chodzi
w Node, więc idzie osobnym zadaniem w `ci.yml` (`node --test`, na atrapach
`Pebble`, `localStorage` i XHR-a). Watchappa w C nie sprawdza żaden test, ale
kompiluje go `pebble-release.yml`, który biegnie także na pull requestach.

**Instalacja nie wymaga SDK.** Wydanie buduje CI i kładzie je na minipc przez
`POST /pbw` serwera wydań — w tym samym katalogu, z którego telefon bierze swoje
pakiety, tylko pod własnym manifestem (`watch.json`, bo `latest.json` odpowiada
na pytanie o pakiet telefonu). Aplikacja czyta ten manifest w karcie „Watch app"
na ekranie konta, pobiera plik i podaje go aplikacji Pebble — tą samą drogą,
którą podaje instalatorowi systemu własny `.apk` (`src/update/apk.ts`).
Reszta — przyciski, ustawienia, drogi awaryjne — jest
w [`services/pebble/README.md`](../services/pebble/README.md).

## Język aplikacji i wielojęzyczne nazwy

Nazwy tagów i ćwiczeń mają dwa poziomy: **nazwę kanoniczną** (kolumna `name`)
i mapę tłumaczeń (`translations`, „kod języka → nazwa"). Kanoniczna jest ta,
z której liczy się slug i identyfikator, więc tłumaczenie nie ma prawa jej
ruszyć — gdyby id zależało od języka, ten sam tag utworzony po polsku i po
angielsku byłby dwoma wierszami, a cała deduplikacja offline przestałaby
działać.

| Warstwa | Co robi |
| ------- | ------- |
| `packages/core/src/languages.ts` | lista języków, `localizedName`, `missingLanguages`, `mergeTranslations` |
| `apps/api/src/translation/` | tłumacz na Haiku, kolejka poza żądaniem, uzupełnianie wierszy |
| `apps/mobile/src/language/` | wybór języka **per urządzenie** i `useLocalizedName` |

**Wybór języka jest per urządzenie**, a nie per konto. Zgłoszenie tego nie
ustaliło; wybór działa dzięki temu także przed zalogowaniem (ekran logowania jest
pierwszym, który ktoś widzi), a zapis per konto oznaczałby kolumnę w tabeli
użytkowników i pole w protokole synchronizacji — dla ustawienia, które dotyczy
wyłącznie tego, co widać na ekranie. Cena: kto ma dwa telefony, wybiera język na
obu. Rejestr leży w pliku obok tapety, a nie w bazie lokalnej, bo nigdzie nie
jedzie.

**Tłumaczenie dzieje się po zapisie i poza żądaniem.** `POST /tags`,
`POST /exercises` i `POST /sync/push` zapisują wiersz z nazwą, którą ktoś
wpisał, i dopiero zgłaszają go do kolejki (`TranslationBacklog` — jeden wykonawca
na proces, tak jak przy wektorach). Paczka pushu potrafi nieść pięćset ćwiczeń
utworzonych offline; tłumaczenie ich w środku żądania przekroczyłoby limit czasu
telefonu i wyglądałoby na utratę łączności.

**Błąd modelu nie blokuje zapisu.** Zgłoszenie nie ustaliło zachowania przy
awarii dostawcy, więc obowiązuje ta sama reguła co przy warstwie 3 wykrywania
duplikatów: wiersz zostaje z nazwą kanoniczną, a w logu ląduje ostrzeżenie.
Na ekranie wygląda to dokładnie tak, jak wyglądało przed dodaniem języków, bo
`localizedName` cofa się do nazwy kanonicznej. To samo dotyczy wyłączonego
tłumaczenia (`TRANSLATION_ENABLED=false`) i stosu bez klucza OpenRoutera.

**Nazwa wpisana ręcznie ma pierwszeństwo.** Formularze aplikacji i panelu mają
pole na nazwę w każdym języku; model uzupełnia wyłącznie luki
(`mergeTranslations`), więc powtórzony przebieg niczego nie nadpisze. Wyjątkiem
jest edycja z panelu i z aplikacji, gdzie komplet nazw **podmienia** poprzedni —
inaczej złego tłumaczenia nie dałoby się usunąć.

Wiersze utworzone, zanim tłumaczenie w ogóle istniało, uzupełnia jednorazowy
przebieg — przyciskiem „Fill in translations" w panelu
(`POST /admin/library/translations/refresh`) albo z wiersza poleceń:

| Polecenie | Co robi |
| --------- | ------- |
| `pnpm --filter @alphapump/api run translate` | uzupełnia brakujące nazwy i **czeka** na koniec przebiegu |

Biblioteka wbudowana tego nie potrzebuje: ma komplet nazw polskich i angielskich
wpisany ręcznie w seedzie (seed nie ma prawa wołać sieci), a kolejka pomija
wiersze, którym niczego nie brakuje. Uzupełnienie podbija `updated_at`, bo
inaczej nie dojechałoby na telefony — dlatego jest to przebieg jednorazowy,
a nie zadanie cron.

## Eksport, import i kopie zapasowe

Jeden format i jeden zestaw reguł (`packages/core/src/transfer.ts`), trzy miejsca
użycia: `GET /export` i `POST /import`, ekran „Eksport i import" w aplikacji oraz
skrypty kopii. To nie oszczędność linijek — to jedyny sposób, żeby ścieżka
odtwarzania nie zardzewiała: drogę „eksport → plik → import" przechodzą zwykli
użytkownicy przy normalnym korzystaniu z aplikacji.

**W archiwum:** serie, ćwiczenia, tagi, cykle i minimalne dane kont (`id`, e-mail,
nick, rola). W archiwum **systemowym** dodatkowo sposoby logowania: hash hasła
i powiązanie z Google. **Poza archiwum:** sesje, klucze API (użytkownik wygeneruje
nowe), tokeny OAuth (wygasają), embeddingi (przeliczalne z nazw) oraz rekordy
i rankingi (pochodne z serii). Tombstone'ów też nie ma — archiwum odtwarza
**stan**, nie historię usunięć.

> **Poświadczenia są wyłącznie w archiwum systemowym**, zastrzeżonym dla
> administratora, a przy wysyłce poza maszynę `backup.sh` wymusza szyfrowanie
> `age`. Bez nich odtworzenie dawało bazę, na którą nikt nie umiał wejść: konta
> wchodziły razem z adresami, więc rejestracja odbijała się o zajęty adres,
> a hasła nie było — resetu przez e-mail ten serwer nie ma. Archiwum jednego
> konta, które użytkownik pobiera sobie sam, poświadczeń nie niesie.
>
> Comiesięczna próba odtworzenia kończy się teraz **logowaniem** na odtworzoną
> bazę (`drill signin`). Porównanie danych tej dziury nie widziało: poświadczeń
> nie było po obu stronach, więc zera się zgadzały.

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
| `scripts/backup.sh`                                   | eksport → gzip → (age) → katalog lub rclone + retencja |
| `scripts/restore.sh <plik\|zdalny>`                    | (age -d) → gunzip → import               |
| `scripts/backup-drill.sh`                             | pełna próba odtworzenia z porównaniem    |

`--silent` nie jest ozdobą: pnpm wypisuje nagłówek skryptu na **stdout**, czyli
tym samym strumieniem, którym jedzie archiwum. `run` też nie — `pnpm import` jest
wbudowanym poleceniem pnpm.

Kopia idzie potokiem, bez pliku pośredniego w drodze, i powstaje pod nazwą
roboczą `.part` — dopiero sprawdzenie rozmiaru nadaje jej nazwę docelową, żeby
kopia przerwana w połowie nie wyglądała przy odtwarzaniu na najświeższą.

Przy wysyłce na Dysk jest szyfrowana **kluczem publicznym** `age` do dwóch
odbiorców: głównego i CI. Na minipc trafia wyłącznie klucz publiczny, więc
włamanie na serwer nie daje dostępu do kopii na Dysku. Klucz prywatny nie leży
ani na minipc, ani na Dysku obok kopii — menedżer haseł i wydruk. Przy kopii do
katalogu lokalnego szyfrowanie jest dobrowolne i domyślnie wyłączone: chroniłoby
przed kimś, kto ma dostęp do dysku serwera, a więc i tak do bazy, a kosztowałoby
klucz do trwałego przechowania.

Comiesięczna próba odtworzenia (`.github/workflows/backup-restore.yml`) przechodzi
cały łańcuch na dwóch bazach i na końcu **porównuje dane z oryginałem** w postaci
kanonicznej: nie sprawdzamy, czy import się wykonał, ale czy powiązania autorów
ćwiczeń i właścicieli serii są po odtworzeniu takie same. Dane próby są fikcyjne
i powstają na miejscu; prawdziwy eksport nigdy nie trafia do CI.

### Wymiana z kopią FitNotesa

Osobna ścieżka w tej samej sekcji aplikacji, bo cel jest inny niż przy archiwum:
nie odtworzenie danych, tylko wymiana z aplikacją, której ktoś używa obok — albo
używał wcześniej. Plik `FitNotes_Backup.fitnotes` jest nieszyfrowaną bazą SQLite,
więc czytamy z niego i dopisujemy do niego wprost — do tabeli `training_log` —
zamiast produkować trzeci format wymiany, którego i tak nie miałby kto
zaimportować.

| Warstwa | Gdzie | Co robi |
| ------- | ----- | ------- |
| plan    | `packages/core/src/fitnotes.ts`      | co dopisać, co pominąć, które ćwiczenie utworzyć — w obie strony |
| plik    | `apps/mobile/src/fitnotes/file.ts`   | odczyt dziennika i zapis w jednej transakcji na pliku użytkownika |
| zapis   | `apps/mobile/src/fitnotes/import.ts` | wciągnięcie planu importu do bazy lokalnej |
| rejestr | `apps/mobile/src/fitnotes/state.ts`  | co już poszło i czym zastąpić brakującą kategorię |
| system  | `apps/mobile/src/fitnotes/expo.ts`   | wybór pliku, SQLite, oddanie go z powrotem |

Trzy rzeczy są w tym nieoczywiste i wszystkie wynikają z FitNotesa, nie z nas:

- **Kategorii nie tworzymy.** Darmowa wersja nie pozwala ich zakładać, więc tag
  główny bez odpowiednika o tej samej nazwie zatrzymuje swoje serie i pyta
  użytkownika, którą istniejącą kategorią je zastąpić. Wybór jest zapamiętywany —
  pytanie ma paść raz, a nie po każdym treningu.
- **Rejestr duplikatów jest po naszej stronie.** `training_log` zna dzień, ale nie
  godzinę dodania wpisu, więc plik docelowy nie potrafi odpowiedzieć, czy tę serię
  już dostał. Klucz (ćwiczenie + wartości serii + moment dodania w AlphaPump) leży
  w pamięci aplikacji; bez niego drugi eksport dopisałby drugi komplet historii.
  Nieczytelny rejestr jest **błędem**, a nie pustką — udawanie, że nic jeszcze nie
  poszło, kosztowałoby użytkownika zdublowany dziennik, widoczny dopiero po
  przywróceniu kopii.
- **Piszemy do kopii roboczej, nie w pliku w miejscu.** Android oddaje wybrany plik
  jako `content://`, pod którym SQLite nie ma czego otworzyć. Gotowy plik wraca
  systemowym udostępnianiem, więc oryginał zostaje nietknięty, dopóki użytkownik
  sam go nie podmieni.

Poza zakresem są pomiary ciała (`BodyWeight`, `Measurement`) i szablony treningów
(`Routine…`): wymieniamy dziennik, a nie całą bazę FitNotesa. Nowym ćwiczeniom
nie ustawiamy też `exercise_type_id` — zostaje wartość domyślna ze schematu,
bo znaczenia pozostałych typów FitNotes nigdzie nie deklaruje, a zgadnięty numer
zmieniłby użytkownikowi wygląd formularza w cudzej aplikacji.

Import idzie tą samą warstwą planu, ale rozstrzyga inaczej trzy rzeczy — bo
tym razem to **nasza** baza jest stroną, w której coś przybywa:

- **Duplikat rozpoznaje sam plik zestawiony z bazą, bez rejestru.** Kluczem jest
  dzień + ćwiczenie + pomiary, a porównujemy liczności, a nie zbiór kluczy: cztery
  identyczne serie z jednego treningu, z których trzy już mamy, dokładają jedną.
  Rejestr byłby tu wręcz szkodliwy — plik może pochodzić z innego telefonu, a jego
  wpisy mogły wejść do AlphaPump dowolną drogą.
- **Tagi i ćwiczenia zakładamy sami.** W drugą stronę nie możemy (darmowy FitNotes
  nie tworzy kategorii), a u siebie nie ma o co pytać. Typ logowania nowego
  ćwiczenia wynika z **całości** jego wpisów, nie z pierwszego: podciąganie
  z obciążeniem ma w pliku także serie z ciężarem zero, a typu logowania nie da
  się później zmienić.
- **Zapis idzie wierszami, nie jedną transakcją.** Odwrotnie niż przy eksporcie,
  bo tam plik jest cudzy, a tu przerwany import zostawia to, co zdążyło wejść —
  i jest to bezpieczne dokładnie dlatego, że powtórzenie rozpozna te serie jako
  duplikaty. Serie zapisują się tymi samymi funkcjami co z ekranu, więc trafiają
  do outboxu i jadą na serwer przy najbliższej synchronizacji.

Wpisy, których nie da się zapisać — bez żadnego pomiaru, z datą, której nie ma
w kalendarzu, albo z nazwą, której nie przyjmuje biblioteka — są pomijane
i policzone w podsumowaniu. Przerwanie całego importu na jednym takim wierszu
kosztowałoby użytkownika resztę dziennika.

## Panel administracyjny

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

Biblioteka jest w panelu **kompletna**: dodawanie, zmiana i usuwanie ćwiczeń
razem z tagiem głównym, tagami dodatkowymi, siłownią i notatką, oraz dodawanie,
zmiana nazwy i usuwanie tagów. Przeglądanie biblioteki przed rozdaniem aplikacji
nie wymaga więc telefonu. Reguły formularza mieszkają w
`apps/admin/src/lib/exercise-draft.ts` i są przetestowane bez renderowania —
dwie z nich są domenowe, a nie kosmetyczne: tag główny nie może się powtórzyć
wśród dodatkowych (inaczej ćwiczenie liczyłoby się do celu cyklu dwa razy),
a `PATCH` niesie **wyłącznie** zmienione pola (komplet podbijałby `updatedAt`
na wszystkich urządzeniach także wtedy, gdy nic się nie zmieniło).

### Porządkowanie biblioteki

Sam CRUD nie wystarcza do posprzątania bazy, w której to samo ćwiczenie stoi dwa
razy, a serie leżą w obu wierszach. Reguła jest jedna i obowiązuje wszędzie:
**nic z zalogowanego nie ginie**.

- **Usunąć nie da się** ćwiczenia, na którym ktokolwiek zapisał serię albo które
  wskazuje cel żywego cyklu (`apps/api/src/exercise-usage.ts`), ani tagu, którego
  używa jakiekolwiek żywe ćwiczenie albo cel cyklu (`apps/api/src/tag-usage.ts`).
  Obie reguły obowiązują **oba wejścia**: `DELETE /…` i tombstone przyjeżdżający
  w `POST /sync/push`. Telefon sprawdza je też u siebie, żeby odmowa nie
  przyszła dopiero jako cicho odrzucony wiersz w kolejce.
- **Scalenie** jest wyjściem, które te blokady zostawiają. `POST
  /admin/library/exercises/:id/merge` przenosi serie (także te z tombstonem)
  i cele cyklu na ćwiczenie docelowe, przelicza rekordy globalne po obu stronach
  i dopiero puste źródło oznacza jako usunięte. Typ logowania musi się zgadzać —
  serie są walidowane względem typu **ćwiczenia**. `POST
  /admin/library/tags/:id/merge` robi to samo dla tagów: przepina ćwiczenia
  (jako główny i jako dodatkowy) oraz cele, a ćwiczeniu, które miało oba tagi,
  zostawia jeden.
- **Przywrócenie** (`…/restore`) zdejmuje tombstone — usunięcie jest miękkie,
  więc pomyłka jest odwracalna. Odmawia, gdy nazwa zdążyła zostać zajęta albo gdy
  tag główny ćwiczenia leży usunięty.
- **Podobne ćwiczenia** liczy w panelu to samo wyszukiwanie hybrydowe, które
  w aplikacji ostrzega przed duplikatem przy tworzeniu ćwiczenia — tylko pytaniem
  jest nazwa istniejącego wiersza. Wektory całej biblioteki przelicza `POST
  /admin/library/embeddings/refresh`; bez tego lista widzi wyłącznie ćwiczenia
  zapisane po włączeniu warstwy semantycznej.
- **Brakujące tłumaczenia** uzupełnia `POST /admin/library/translations/refresh` —
  ten sam przebieg co `pnpm --filter @alphapump/api run translate`, dla tagów
  i ćwiczeń dodanych, zanim tłumaczenie automatyczne istniało. Nazwy wpisane
  ręcznie zostają nietknięte, a wiersz z kompletem nazw nie trafia do modelu.

Lista ćwiczeń w panelu niesie przy każdym wierszu **co na nim wisi**: serie, ilu
osób dotyczą, cele cyklu, datę ostatniego treningu i to, czy wiersz ma policzony
wektor. To te liczby, a nie uprawnienia, decydują o tym, czy „Usuń" ma prawo
zadziałać — więc stoją obok przycisku razem z powodem, dla którego jest wygaszony.
Filtry po autorze (wbudowane kontra dodane przez ludzi), po stanie (żywe kontra
usunięte) i po tagu są tam po to, żeby dało się odróżnić bibliotekę z seeda od
tego, co doszło później.

Kont panel nie usuwa i nie będzie: konto jest autorem ćwiczeń i właścicielem serii,
więc jego usunięcie albo osieroca cudze dane, albo wymaga kaskady niszczącej
historię grupy. Właściwą operacją jest blokada — dane zostają, człowiek nie wchodzi.
Nie da się też zablokować ani zdegradować **własnego** konta (panel jest jedynym
narzędziem do nadawania roli) ani ruszyć konta systemowego, które jest autorem
ćwiczeń wbudowanych.

Panel czyta odpowiedzi schematami Zod z `@alphapump/core` — tymi samymi, którymi
API je opisuje — więc kontrakt jest już wspólny po obu stronach, bez osobnego
klienta RPC i bez zależności panelu od typów serwera.

## Synchronizacja

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

Paczka jest **domknięta referencyjnie**: telefon dokłada do niej wiersze, na
które wskazuje, a których serwer jeszcze nie potwierdził (`server_seq` pusty) —
ćwiczenia serii i celów, a za nimi ich tagi. Bez tego seria zapisana na
ćwiczeniu wbudowanym odbijałaby się o „Ćwiczenie serii nie istnieje" wszędzie
tam, gdzie serwer nie ma dokładnie tej samej biblioteki co telefon. Serwer
przyjmuje takie **wstawienie** wiersza konta systemowego od zwykłego
użytkownika, bo identyfikator ćwiczenia musi wynikać z pary autor + nazwa —
podszycie się nie przechodzi, a istniejącego wiersza konta systemowego dalej nie
ruszy nikt poza administratorem.

`POST /sync/tombstones/prune` (administrator) zdejmuje stare tombstone'y. Okno
retencji musi być dłuższe niż najdłuższa realna przerwa w synchronizacji —
urządzenie, które przespało tombstone, przywiozłoby usuniętą serię z powrotem.

## Aplikacja mobilna

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

### Logowanie serii

Ekran dnia (`src/screens/day.tsx`) obsługuje dzień bieżący i historyczny — to ten
sam komponent, wołany z dwóch tras. Zapis idzie przez `src/db/sets.ts`, gdzie
w jednej transakcji dzieją się trzy rzeczy: wiersz trafia do bazy, jego
identyfikator do outboxu, a pomiary przez front Pareto z `@alphapump/core`.
Dlatego informacja o rekordzie pojawia się natychmiast i **bez sieci**.

Edycja serii nie ma własnego przycisku wyjścia: wejście w serię wypełnia ten sam
formularz, zmianę zatwierdza „Save changes", a wychodzi się tapnięciem w tło poza
kartą formularza — co **odrzuca** wpisane wartości. „Add as new" i „Cancel"
zniknęły z tego widoku, bo pierwsze nie było używane, a drugie dublowało
tapnięcie w tło. Sam zestaw przycisków wylicza `apps/mobile/src/set-form.ts`
i ma test bez renderowania ekranu.

Obok „Add set" stoi mikrofon prowadzący do dyktowania (`src/screens/dictate.tsx`) —
nagraniem albo jednym zdaniem wpisanym z klawiatury.
Jest **wąskim przyciskiem obok**, a nie zamiast: dyktowanie wymaga serwera, więc
poza VPN-em jest drogą, która nie działa, a wybór ćwiczenia z listy musi działać
zawsze. Rozpoznane wartości wracają do tego samego formularza jako wypełnione
pola — z podpisem, skąd się wzięły — i wygrywają wtedy z podpowiedzią
z poprzedniej serii. Po zapisie formularz wraca do podpowiedzi: dyktowanie jest
jednorazowe.

Rekordy indywidualne nie są nigdzie trzymane — liczy je `@alphapump/core` przy
rysowaniu ekranu, z serii leżących w bazie lokalnej. Tabela pochodna byłaby
drugim źródłem prawdy o czymś, co i tak liczy się w milisekundach, i wymagałaby
przeliczania po każdej edycji, każdym usunięciu i każdym pullu.

### Kalendarz i wykresy

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

### Tapeta

Własne zdjęcie w tle ustawia się w koncie (`src/ui/background.tsx`), a rysuje je
korzeń aplikacji pod całą nawigacją. Ekrany są od tego przezroczyste — kolor tła
maluje `_layout.tsx`, a nie każdy `SafeAreaView` z osobna, więc żaden ekran nie
musi o tapecie wiedzieć. Nieprzezroczyste zostają karty, nagłówek i paski akcji,
bo to na nich stoi tekst; nad samym zdjęciem leży jeszcze przyciemnienie kolorem
tła, żeby jasna fotografia nie zjadła białych podpisów.

Zdjęcie kopiujemy do katalogu dokumentów, zamiast zapamiętać adres wybranego
pliku: Android oddaje go jako `content://`, a uprawnienie do tego adresu wygasa
razem z procesem — po restarcie tapeta byłaby pustym prostokątem. Wyboru pliku
pilnuje `expo-document-picker`, ten sam co przy imporcie z FitNotesa, a nie
`expo-image-picker`: dołożenie modułu natywnego znaczyłoby, że tapeta dojedzie
dopiero z nowym `.apk`, a nie wydaniem OTA.

Reguły (formaty, limit rozmiaru, nazwy kolejnych kopii) siedzą w czystym
`src/background/state.ts` i mają testy w Node; `src/background/expo.ts` tylko je
wykonuje. Kolejne tapety dostają kolejne numery w nazwie, bo pod tym samym
adresem React Native pokazałby obraz z pamięci podręcznej zamiast nowo wybranego.

### Ekrany, które czekają na sieć

Są cztery i każdy z tego samego powodu: potrzebują czegoś, czego nie da się
policzyć ani przechować lokalnie.

| Ekran                       | Dlaczego nie działa offline                                    |
| --------------------------- | -------------------------------------------------------------- |
| Rekordy globalne, rankingi  | liczą się z serii wszystkich, a cudze serie nigdy nie zjadą na telefon |
| Tokeny API                  | token weryfikuje serwer i tylko on wie, czy jeszcze żyje         |
| Dyktowanie serii            | ani transkrypcji, ani modelu nie ma jak policzyć na telefonie, a kluczy nie wolno w nim trzymać — dotyczy tak samo nagrania, jak opisu z klawiatury |

Rekordy i rankingi czyta `src/remote/` — warstwa **wyłącznie do odczytu**, bez
cache'u i bez outboxu. Tokeny mają własną ścieżkę (`src/screens/api-keys.tsx`),
bo są jedynym zapisem sieciowym poza synchronizacją, a ich lista trzymana
lokalnie kłamałaby po unieważnieniu tokenu z innego urządzenia. Dyktowanie ma
własnego klienta (`src/remote/voice.ts`), bo jako jedyne wysyła plik.

Wszystkie cztery pokazują brak łączności jako spokojne „offline" z przyciskiem
ponowienia — tymi samymi klasami błędów co synchronizacja. Reszta aplikacji,
łącznie z rekordami indywidualnymi i zapisem serii, dalej działa w trybie
samolotowym: dyktowanie jest skrótem do formularza, a nie drogą do niego.

### Ostrzeżenie o duplikacie i transfer danych

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

### Wymiana danych

Kolejka wysyłki (`outbox`), kursor (`sync_state`) i kwarantanna odrzuceń
(`sync_rejections`) to tabele istniejące wyłącznie po stronie telefonu. Wpis w outboxie nie niesie treści mutacji, tylko wskazuje
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

Rozstrzygany jest jednak wyłącznie wiersz, który **ma czego bronić**: taki,
którego zmiana czeka jeszcze w kolejce albo w kwarantannie odrzuceń. Dla reszty
wersja serwera wchodzi wprost (`src/sync/authority.ts`), bo LWW jest tam złym
przybliżeniem pytania „czy użytkownik zmienił to w międzyczasie" i myli się
w obie strony: wiersz oddany przez serwer przy odmowie, znacznik przycięty
z przyszłości i kolor tagu przydzielony przez serwer są **starsze** niż wersja
lokalna, więc przegrywały każde rozstrzygnięcie. Skutek był zawsze ten sam:
telefon i serwer trzymały różną treść tego samego wiersza, numer wiersza stał już
za kursorem — więc pull nigdy go nie przywoził — i nikt tego nie widział. Tak
powstawało ćwiczenie z tagiem głównym `legs` na telefonie i `quads` w panelu,
mimo działającej synchronizacji.

Odrzucony wiersz schodzi z outboxu — inaczej jedna zatruta mutacja zatrzymałaby
kolejkę na zawsze — ale **nie przepada**. Ląduje w `sync_rejections`, razem
z powodem i licznikiem prób, a po każdej udanej wymianie `reconcile`
(`src/sync/reconcile.ts`) szuka wierszy żywych, bez `server_seq` i bez wpisu
w kolejce, i wstawia je z powrotem. `server_seq` jest tu wiarygodnym znacznikiem
„serwer o tym wie", bo dostaje go nawet wiersz, który przegrał LWW. Dzięki temu
każda ścieżka „ten wiersz tym razem nie pojedzie" kosztuje najwyżej jedną
wymianę opóźnienia, a nie zapisaną serię. Odstęp przed kolejną próbą rośnie
(minuta, pięć, pół godziny, dwie godziny, doba), więc wiersz, którego serwer nie
przyjmie nigdy, nie kręci kolejką w kółko — a licznik takich wierszy widać
w pigułce statusu.

Odmowa dotycząca wiersza, o którym serwer **już wie** (edycja ćwiczenia albo
tagu z biblioteki), niczego nie ponawia: do kolejki wracają tylko wiersze bez
`server_seq`, a lokalna wersja takiego wiersza została już zastąpiona wersją
serwerową. Jej wpis w kwarantannie żyje więc dokładnie tyle, co odstęp — po to,
żeby zdążył pokazać się w pigułce statusu. Wcześniej kasował go ten sam przebieg
`reconcile`, który go tworzył, więc **żadna** odmowa dotycząca biblioteki nie
była dla użytkownika widoczna.

Brak łączności jest stanem pracy, a nie awarią: serwer stoi za NetBirdem, więc
telefon z pełnym zasięgiem bywa poza VPN-em, a systemowy stan sieci i tak mówi
wtedy „połączony". Jedynym uczciwym testem jest próba dobicia się do API, więc
nieudane żądanie pokazujemy jako spokojne „offline", a ponawianie wycofuje się
dwukrotnie, do godzinnego sufitu.

Telefon rozmawia z API zwykłym `fetch`em (`src/sync/transport.ts`), a odpowiedzi
sprawdza schematami Zod z `@alphapump/core` — tymi samymi, którymi serwer
waliduje własne wyjście. Kontrakt jest więc opisany raz i sprawdzany po obu
stronach, bez osobnego klienta RPC — dokładnie ten sam wniosek, do którego doszedł
panel administracyjny (patrz „Panel administracyjny").

## Kontrakt identyfikatorów

`slug()` oraz deterministyczne identyfikatory ćwiczeń i tagów są objęte testami
golden (`packages/core/tests/golden/identifiers.ts`). Ich zmiana przepisuje
identyfikatory istniejących wierszy, więc czerwony test golden nie jest testem
do poprawienia — to sygnał, że zmiana wymaga świadomej decyzji i migracji.

## Segregacja zgłoszeń zwrotnych

Osobna usługa w Pythonie (`services/triage`), poza workspace pnpm i poza logiką
produktu. Czyta zgłoszenia zapisane przez `POST /feedback` w kilkanaście sekund
po tym, jak wpadną, klasyfikuje je modelem językowym i prowadzi dalej dwiema
różnymi ścieżkami:

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
        │                                   issue na GitHubie
        │                              (ai-triage + enhancement)
        │                                            │
        └──────────────┬─────────────────────────────┘
                       │
        etykieta `ai-triage` uruchamia Claude Code w Akcjach
                       │
          ┌────────────┴────────────┐
     pull request            komentarz pod issue
          │              (za ogólne albo przebieg padł)
          └────────────┬────────────┘
                       │
     bot przekłada jedno i drugie do wątku tego zgłoszenia
```

Podział na dwie ścieżki jest sednem: błąd ma jedno poprawne rozwiązanie i nie
wymaga niczyjej decyzji, więc idzie prosto do naprawy. Prośba o zmianę wymaga
ustalenia zakresu — a zakres ustala zespół w wątku, nie model na podstawie
jednego zdania od użytkownika.

**Bot nie dopytuje o szczegóły.** Po oznaczeniu w wątku issue powstaje od razu,
także wtedy, gdy dyskusja czegoś nie rozstrzygnęła — rolą bota jest
pośredniczyć między Discordem a GitHubem: założyć issue i odesłać link, a nie
prowadzić rundy pytań. Czego zespół nie ustalił, model opisuje w treści issue
jako nieustalone, zamiast zostawiać tam pytanie: etykieta `ai-triage` uruchamia
agenta w Akcjach natychmiast po założeniu issue, a agent nie ma jak dopytać.
Dalsze ustalenia idą w wątku albo w komentarzu pod issue — te i tak wracają na
Discorda (patrz niżej).

**Wykrywanie duplikatów.** Przed założeniem issue usługa pokazuje modelowi
otwarte zgłoszenia z etykietą `ai-triage` i pyta, czy to ta sama sprawa. Duplikat
błędu ląduje jako komentarz do istniejącego issue, duplikat prośby o zmianę —
jako wpis w trwającym wątku. Przy wątpliwości model ma odpowiadać „nie":
dwa issue scala się jednym kliknięciem, a zgubione zgłoszenie nie wraca.

**Zgłoszenie idzie do segregacji od razu.** Usługa zagląda do katalogu co
`TRIAGE_FEEDBACK_POLL_SECONDS` (domyślnie 15). Wcześniej robiła to raz na dobę
o umówionej godzinie i zgłoszenie napisane rano czekało do nocy — a razem z nim
czekał użytkownik, który je napisał, i osoba, która miała je przeczytać. Pusty
przebieg kosztuje `glob` po zamontowanym katalogu i jedno zapytanie do SQLite'a;
modelu językowego dotyka dopiero wtedy, gdy w katalogu naprawdę leży nowy plik,
więc częstość nie przekłada się na rachunek za OpenRoutera.

Odpytywanie, a nie powiadomienie z API — mimo że oba kontenery stoją w tej samej
sieci Compose i API ma już klienta do usługi. Powód jest ten sam, co przy pull
requestach: katalog jest źródłem prawdy, więc nic nie ginie, gdy któryś
z kontenerów akurat wstaje, a zgłoszenie podłożone ręcznie zostanie zauważone
tak samo jak to z aplikacji. Cena — kilkanaście sekund opóźnienia — jest przy
zgłoszeniu, na które i tak odpowiada człowiek, nie do zauważenia.

**Zgłoszenie, które padło, wraca po karencji.** `TRIAGE_RETRY_AFTER_SECONDS`
(domyślnie kwadrans) trzyma je z dala od kolejnego przebiegu. Przy odstępie
kilkunastu sekund trzy podejścia z `TRIAGE_MAX_ATTEMPTS` wypaliłyby się w minutę
i pierwsza lepsza czkawka OpenRoutera odkładałaby zgłoszenie na bok bezpowrotnie
— a to jest dokładnie ten rodzaj awarii, który mija sam. Kwadrans rozkłada trzy
podejścia na pół godziny.

**Skąd bot wie o pull requeście.** Odpytuje GitHuba co dwie minuty, zamiast
czekać na webhooka. Minipc stoi za VPN-em i GitHub nie ma jak się do niego dobić.
Skutek uboczny wychodzi na plus: PR-ka otwarta ręcznie zostanie zauważona tak
samo jak ta z Akcji, bo liczy się powiązanie po stronie GitHuba (`Fixes #N`),
a nie to, kto ją otworzył.

**Komentarze pod issue też wracają do wątku.** Agent nie zawsze kończy PR-ką:
gdy zgłoszenie jest zbyt ogólne, żeby je zlokalizować, ma o tym napisać
w komentarzu zamiast zgadywać — i tak samo komentuje kontrola, kiedy przebieg
padnie. Bez przekazywania taki komentarz byłby ślepym zaułkiem: powstaje na
GitHubie, a rozmowa toczy się na Discordzie. Ta sama pętla co przy PR-kach
przekłada więc każdy nowy komentarz do wątku, w całości, nie samym linkiem —
pytanie agenta ma być widoczne tam, gdzie są ludzie zdolni odpowiedzieć.

Dwa zastrzeżenia, oba celowe. Własne komentarze usługi (te przy duplikacie) są
odhaczane w chwili wysłania, żeby nie wróciły do wątku, w którym za moment i tak
zostaną ogłoszone. A issue, które usługa zna sprzed tej pętli, przy pierwszym
obiegu tylko zapamiętuje swój stan i milczy — wysypanie całej zaległej historii
komentarzy byłoby gorsze niż jej pominięcie. Po powstaniu PR-ki odpytywanie
ustaje: rozmowa przenosi się do niej.

**Modele.** Klasyfikacja idzie na `openai/gpt-5.6-terra` (decyzja binarna na
krótkim tekście), pisanie treści issue na `anthropic/claude-sonnet-5` — bo tę
treść czyta potem agent, który ma zgłoszenie naprawić. W Akcjach model zależy od
etykiety: `bug` → Sonnet 5, `enhancement` → Opus 5.

### Konfiguracja

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

### Uruchomienie

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
# Podgląd pracy. Pusty przebieg nie zostawia śladu na INFO — przy odpytywaniu
# co kilkanaście sekund zalałby log. Widać go po `TRIAGE_LOG_LEVEL=DEBUG`.
docker compose logs -f triage

# Przegląd na żądanie — przydatny głównie po to, żeby ruszyć zgłoszenie odłożone
# na czas karencji. Na czas tego polecenia do Discorda zalogowane są dwie sesje
# tego samego bota (usługa i to wywołanie), więc nie oznaczaj go w wątku, dopóki
# polecenie nie skończy pracy.
docker compose exec triage python -m alphapump_triage once

# Próba na sucho: klasyfikacja i duplikaty liczą się naprawdę, ale nic nie
# powstaje — stan idzie do pamięci, więc zgłoszenia nie zostaną odhaczone.
TRIAGE_DRY_RUN=true docker compose up triage
```

Zgłoszenie, którego nie udało się przetworzyć (awaria OpenRoutera, GitHuba),
wraca po karencji — do trzech podejść, potem zostaje odłożone na bok z powodem
zapisanym w bazie stanu. Uszkodzony plik JSON odpada od razu: za kwadrans nie
będzie bardziej poprawny.

### Rozwój

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
