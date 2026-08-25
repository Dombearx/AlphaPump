# AlphaPump na Pebble

Dyktowanie serii z zegarka. Mówisz „wyciskanie osiemdziesiąt dwa i pół na osiem",
seria ląduje w twoim dzienniku, a telefon zobaczy ją przy najbliższej
synchronizacji.

## Najważniejsze, zanim zajrzysz w kod

**Zegarek nie wysyła nagrania i nie ma jak go wysłać.** Pebble nie daje aplikacji
dostępu do dźwięku z mikrofonu — Dictation API oddaje **gotowy tekst**, a samo
nagranie i transkrypcja dzieją się poza naszym kodem: w aplikacji Pebble na
telefonie i u dostawcy mowy (Rebble przy starych zegarkach, Core Devices przy
nowych). Ta aplikacja jest więc mikrofonem, który oddaje zdanie.

Dlatego pasuje do AlphaPumpa bez jednej zmiany w API: `POST /voice/text` przyjmuje
dokładnie jedno zdanie i to jest to samo wejście, z którego korzysta pole
tekstowe na ekranie dyktowania w telefonie.

## Jak to leci

```
Pebble (src/c)  ──dictation──▶  tekst
      │  AppMessage
PebbleKit JS (src/pkjs, chodzi w aplikacji Pebble na telefonie)
      │  POST /voice/text   (x-api-key)  ──▶  rozpoznana seria
      │  POST /sets         (x-api-key)  ──▶  zapis
AlphaPump API  ──sync──▶  telefon widzi serię przy następnej wymianie
```

Zegarek nie ma własnej sieci i nie musi jej mieć: PebbleKit JS to piaskowka
JavaScriptu **wewnątrz aplikacji Pebble na telefonie**, więc żądania wychodzą
z telefonu — tego samego, który jest w VPN-ie.

Dwa wywołania zamiast jednego, bo obydwa już istniały i żadne nie powstało dla
zegarka: pierwsze zamienia zdanie w serię, drugie zapisuje serię tokenem API —
tą samą drogą, dla której powstały tokeny („dla bota Discord").

## Przyciski

| Przycisk | Co robi                                                               |
| -------- | --------------------------------------------------------------------- |
| SELECT   | dyktowanie; a gdy seria czeka na potwierdzenie — zapis                 |
| UP       | **sprawdzenie połączenia** (`GET /health`, potem `GET /me`)            |
| BACK     | odrzucenie czekającej serii, a poza tym wyjście z aplikacji            |

Wibracja mówi to samo co ekran, tylko do kieszeni: jedno pulsnięcie — zapisane,
dwa — coś poszło nie tak.

### Sprawdzenie połączenia

To jest przycisk do debugowania i warto o nim wiedzieć, **zanim** cokolwiek nie
zadziała. Dwa żądania, bo są dwie różne rzeczy do zepsucia:

| Co pokazuje zegarek | Co to znaczy |
| ------------------- | ------------ |
| `Server: no` + „No answer…" | telefon nie dosięga API: zły adres, telefon poza VPN-em albo aplikacja Pebble nie przepuszcza czystego HTTP |
| `Server: OK` + „paste an API token" | sieć działa, brakuje tokenu |
| `Token: no` | serwer odpowiada, ale token jest zły albo unieważniony |
| `All good` | obie połowy działają |

`GET /health` idzie **bez tokenu** i to jest cały jego sens: odpowiada wyłącznie
na pytanie „czy telefon w ogóle dosięga serwera".

## Instalacja

Normalna droga jest jedna i nie wymaga ani SDK, ani komputera, ani wiedzy o tym,
że plik `.pbw` istnieje:

> **Aplikacja AlphaPump → Account → Watch app → „Install on the watch"**

Telefon pobiera wydanie z minipc i podaje je aplikacji Pebble, która przerzuca
je na zegarek. To jest dokładnie ta sama droga, którą aplikacja instaluje własne
aktualizacje — z tą różnicą, że plik odbiera aplikacja Pebble, a nie instalator
systemu.

Buduje i publikuje CI (`.github/workflows/pebble-release.yml`): każda zmiana
w `services/pebble/` na `main` kładzie nowe wydanie na minipc, obok pakietu
`.apk`. Ręcznie: **Actions → „Wydanie aplikacji na zegarek" → Run workflow**.

Gdyby przycisk nie zadziałał — bo Android nie znalazł aplikacji, której podać
plik — zostają dwie drogi awaryjne. Pierwsza: otworzyć w przeglądarce telefonu
`http://<adres-minipc>/alphapump/download/`, pobrać najnowszy `.pbw` i otworzyć go
menedżerem plików. Druga, gdy system nie pozwala wskazać aplikacji Pebble jako
celu: *Sideload Helper* od Rebble, którego całym zadaniem jest podanie tego
pliku dalej.

Po pierwszej instalacji zostaje jedno: wpisać adres API i token — patrz
„Ustawienia" wyżej. Potem na zegarku **UP**, żeby sprawdzić połączenie, zanim
cokolwiek podyktujesz.

## Budowanie u siebie

Potrzebne tylko wtedy, gdy zmieniasz kod zegarka i chcesz zobaczyć wynik przed
wypchnięciem. Poza tym nie ma po co.

```
uv tool install pebble-tool      # albo: pip install pebble-tool
pebble sdk install 4.4           # numer jest wymagany — bez niego tool odmawia
```

Drugie polecenie dociąga to, co kiedyś było osobnym, wielkim archiwum SDK:
łańcuch narzędzi `arm-none-eabi` i emulator QEMU. Potrzebny jest Python 3.10+.
SDK 4.4 jest ostatnim z czasów Pebble i pierwszym, w którym są wszystkie cztery
platformy z mikrofonem.

```
cd services/pebble
pebble build
```

Wynik to `build/alphapump.pbw`. „Platformy" znaczą tu **generacje zegarków**, a nie
warstwy AlphaPumpa: jeden plik `.pbw` niesie osobny binarny plik dla każdego
modelu z listy `targetPlatforms`, bo w chwili budowania nie wiadomo, na czyim
zegarku wyląduje — wybiera dopiero aplikacja na telefonie, przy instalacji.
Kto buduje dla siebie i wie, co ma na ręce, może zostawić w `package.json` jedną
pozycję i skrócić budowanie czterokrotnie.

Z samego AlphaPumpa nie ma tu **niczego**: ani bazy, ani biblioteki ćwiczeń, ani
rekordów, ani synchronizacji. Watchapp to 388 linii C, w których nie pada nawet
słowo „ćwiczenie" — on zbiera zdanie i pokazuje odpowiedź. Wszystko, co wie
o dziedzinie, wie serwer.

Wgranie prosto z komputera, z logami:

```
pebble install --phone 192.168.1.23     # albo --emulator basalt
pebble logs --phone 192.168.1.23        # `APP_LOG` z watchappa i z PebbleKit JS
```

Adres bierze się z aplikacji Pebble → *Settings* → *Developer Mode* →
*Developer Connection*; telefon i komputer muszą być w tej samej sieci. Emulator
nie ma mikrofonu, więc dyktowania na nim nie sprawdzisz — ale sprawdzenie
połączenia (UP) i cały przepływ błędów już tak, bo one dzieją się po stronie
telefonu.

Platformy: `basalt`, `chalk`, `diorite`, `emery` — czyli wszystko z mikrofonem,
łącznie z nowymi Core 2 Duo i Core Time 2. `aplite` (Pebble Classic i Steel) jest
pominięty świadomie: bez mikrofonu została by z tego sama diagnostyka.

## Ustawienia

Aplikacja Pebble na telefonie → AlphaPump → *Settings*. Trzy pola:

| Pole | Skąd wziąć |
| ---- | ---------- |
| **API address** | ten sam adres, którego używa aplikacja na telefonie (`EXPO_PUBLIC_API_URL`) |
| **API token** | aplikacja AlphaPump → Account → API tokens → nowy token dla zegarka |
| **Confirm before saving** | domyślnie **włączone**: po rozpoznaniu zegarek pokazuje serię i czeka na SELECT |

Strona ustawień jedzie jako `data:`-URI, a nie z serwera — konfigurator
hostowany musiałby być osiągalny **zanim** ktokolwiek wpisze adres API, czyli
dokładnie wtedy, gdy nic jeszcze nie jest ustawione.

## Czego potrzeba poza tym repozytorium

- **Zegarka z mikrofonem** — Pebble Time / Time Steel / Time Round, Pebble 2 HR,
  Core 2 Duo, Core Time 2.
- **Działającego dyktowania w aplikacji Pebble** — na starych zegarkach chodzi
  ono przez Rebble i wymaga ich subskrypcji; na nowych przez usługę Core Devices.
  To nie jest nasz koszt ani nasza awaria, ale bez tego watchapp dostaje pusty
  wynik i mówi „No dictation".
- **Telefonu w tym samym VPN-ie co API** — żądania wychodzą z telefonu.

## Testy

```
cd services/pebble
node --test
```

Sprawdzana jest **połowa telefonowa** — i to nie jest kompromis, tylko podział
przebiegający dokładnie tam, gdzie trzeba: cała decyzyjność tej aplikacji siedzi
w `src/pkjs`. Kiedy wolno zapisać serię, co jest błędem, a co brakiem
konfiguracji, który z dwóch dostawców nie odpowiada, jaki dzień wpisać — to
wszystko da się sprawdzić bez zegarka i jest sprawdzone, na atrapach `Pebble`,
`localStorage` i `XMLHttpRequest`. Testy chodzą na gołym `node --test`, bez
jednej zależności, i mają własne zadanie w `ci.yml`.

Watchappa (`src/c`) nie sprawdza żaden test — ale **kompiluje go CI**:
`pebble-release.yml` biegnie także na pull requestach i buduje `.pbw`, więc kod,
który się nie składa, nie wchodzi do `main`. Dalej to jedyne, co da się
sprawdzić bez sprzętu: dyktowanie i przyciski dzieją się na zegarku, do którego
CI nie ma dostępu. Dlatego w `src/c` nie ma żadnej decyzji do podjęcia —
watchapp zbiera zdanie, pokazuje odpowiedź i tyle.

## Znane pytania bez odpowiedzi

- **Czysty HTTP.** API stoi na HTTP wewnątrz WireGuarda, a żądanie wychodzi
  z **cudzej** aplikacji (Pebble), której `networkSecurityConfig` nie znamy.
  Jeśli sprawdzenie połączenia pokazuje `Server: no` mimo dobrego adresu i VPN-a,
  to jest pierwszy podejrzany. Wyjścia: TLS na Caddym albo łatka w aplikacji
  Pebble — jest otwartoźródłowa.
- **CORS.** Piaskowka PKJS zwykle nie wymusza CORS-a (żądanie idzie natywnie),
  ale gdyby jednak — dopisz pochodzenie aplikacji Pebble do `TRUSTED_ORIGINS`
  w konfiguracji API.
