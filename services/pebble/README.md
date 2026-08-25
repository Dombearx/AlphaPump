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

## Budowanie i wgrywanie

### 1. SDK

Repozytorium go nie zawiera i CI nie buduje watchappa (patrz „Testy"), więc raz,
na swojej maszynie. `pebble-tool` utrzymuje dziś Core Devices i instaluje się
jak zwykłe narzędzie Pythona — `uv` jest w tym repozytorium i tak potrzebny do
`services/triage`:

```
uv tool install pebble-tool      # albo: pip install pebble-tool
pebble sdk install
```

Drugie polecenie dociąga to, co kiedyś było osobnym, wielkim archiwum SDK:
łańcuch narzędzi `arm-none-eabi` i emulator QEMU. Potrzebny jest Python 3.10+.

### 2. Budowa

```
cd services/pebble
pebble build
```

Wynik to `build/alphapump.pbw` — jeden plik z aplikacją dla wszystkich czterech
platform naraz.

### 3. Wgranie na zegarek

**Drogą deweloperską** (najwygodniejsza, bo od razu widać logi):

1. W aplikacji Pebble na telefonie: menu → *Settings* → *Developer Mode* →
   włącz, potem *Developer Connection* → włącz.
2. Przepisz **Server IP**, które się tam pokaże.
3. Z katalogu projektu:

```
pebble install --phone 192.168.1.23
pebble logs --phone 192.168.1.23      # `APP_LOG` z watchappa i z PebbleKit JS
```

Telefon i komputer muszą być w tej samej sieci — to połączenie idzie wprost do
telefonu, a nie przez zegarek.

**Bez SDK i bez komputera**: przerzuć `.pbw` na telefon (dowolnie — chmura,
kabel, komunikator) i otwórz go menedżerem plików; aplikacja Pebble sama
zaproponuje instalację. Na nowszych Androidach bywa, że system nie pozwala
wskazać jej jako celu — wtedy pomaga *Sideload Helper* od Rebble, którego całym
zadaniem jest podanie pliku `.pbw` do aplikacji Pebble.

**Bez zegarka**: `pebble install --emulator basalt`. Emulator nie ma mikrofonu,
więc dyktowania na nim nie sprawdzisz — ale sprawdzenie połączenia (UP) i cały
przepływ błędów już tak, bo one dzieją się po stronie telefonu.

### 4. Konfiguracja i pierwsze uruchomienie

Po instalacji: aplikacja Pebble → lista aplikacji → AlphaPump → **koło zębate**
(ustawienia). Wklej adres API i token, zapisz. Potem na zegarku naciśnij **UP** —
zanim cokolwiek podyktujesz, sprawdzenie połączenia powie, czy telefon widzi
serwer i czy token żyje.

Platformy: `basalt`, `chalk`, `diorite`, `emery` — czyli wszystko z mikrofonem,
łącznie z nowymi Core 2 Duo i Core Time 2. `aplite` (Pebble Classic i Steel) jest
pominięty świadomie: bez mikrofonu została by z tego sama diagnostyka.

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

Watchappa (`src/c`) nie sprawdza nic. `pebble build` wymaga SDK z łańcuchem
narzędzi dla ARM-a, a potwierdziłby wyłącznie to, że kod się kompiluje — bo
jedyne, co naprawdę dowodzi działania tej połowy (dyktowanie i przyciski),
dzieje się na sprzęcie, do którego CI nie ma dostępu. Dlatego w `src/c` nie ma
żadnej decyzji do podjęcia: watchapp zbiera zdanie, pokazuje odpowiedź i tyle.

## Znane pytania bez odpowiedzi

- **Czysty HTTP.** API stoi na HTTP wewnątrz WireGuarda, a żądanie wychodzi
  z **cudzej** aplikacji (Pebble), której `networkSecurityConfig` nie znamy.
  Jeśli sprawdzenie połączenia pokazuje `Server: no` mimo dobrego adresu i VPN-a,
  to jest pierwszy podejrzany. Wyjścia: TLS na Caddym albo łatka w aplikacji
  Pebble — jest otwartoźródłowa.
- **CORS.** Piaskowka PKJS zwykle nie wymusza CORS-a (żądanie idzie natywnie),
  ale gdyby jednak — dopisz pochodzenie aplikacji Pebble do `TRUSTED_ORIGINS`
  w konfiguracji API.
