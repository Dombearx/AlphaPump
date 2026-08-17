# Uruchomienie krok po kroku

Przewodnik do jednorazowego postawienia AlphaPumpa na minipc i wydania pierwszej
aplikacji. Zakłada, że minipc jest widoczny w NetBirdzie pod
`domin-server.iron.sq` — jeśli adres jest inny, podstaw swój **wszędzie**, bo
wchodzi w trzy różne miejsca i musi być w nich identyczny.

Szczegóły i uzasadnienia są w `README.md`; tutaj jest sama kolejność.

## Gdzie co trafia

Konfiguracja mieszka w trzech miejscach i **nic się między nimi nie kopiuje samo**:

| Miejsce | Co tam jest | Kto to czyta |
| ------- | ----------- | ------------ |
| `deploy/.env` na minipc | sekrety serwera, adres w VPN | kontenery (API, baza, segregacja zgłoszeń) |
| GitHub → Secrets | klucz podpisujący, dostęp do VPN | zadanie wydania aplikacji |
| GitHub → Variables | adres API wkompilowany w aplikację | zadanie wydania aplikacji |

Sekrety GitHuba są maskowane w logach, zmienne (Variables) nie — i o to chodzi.
Adres API trafia do Variables **świadomie**: i tak jest w środku pliku `.apk`
(w `res/xml/network_security_config.xml`), więc ukrywanie go w sekretach
zamazałoby tylko logi, utrudniając diagnostykę bez zysku.

---

## A. Klucz podpisujący — raz, na zawsze

Na własnej maszynie, nie na minipc:

```bash
keytool -genkeypair -v -keystore alphapump.keystore -alias alphapump \
  -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 alphapump.keystore     # to wklejasz do sekretu
```

> **Plik `alphapump.keystore` zachowaj poza repozytorium** — najlepiej tam, gdzie
> klucz `age` od kopii zapasowych. Bez niego nie da się wydać aktualizacji do już
> zainstalowanej aplikacji, a jedynym wyjściem jest odinstalowanie jej na
> **każdym** telefonie. Zadanie wydania celowo przerywa się, gdy sekretu brakuje,
> zamiast po cichu podpisać wydanie publicznie znanym kluczem deweloperskim.

## B. GitHub — sekrety i zmienne

*Settings → Secrets and variables → Actions.*

Zakładka **Secrets**:

| Sekret | Skąd wziąć |
| ------ | ---------- |
| `ANDROID_KEYSTORE_BASE64` | wynik `base64 -w0` z kroku A |
| `ANDROID_KEYSTORE_PASSWORD` | hasło podane przy `keytool` |
| `ANDROID_KEY_ALIAS` | `alphapump` |
| `ANDROID_KEY_PASSWORD` | hasło klucza (przy `keytool` zwykle to samo co store) |
| `NETBIRD_ACCESS_KEY` | panel NetBirda → *Setup Keys* (te same, których używa `deploy.yml`) |
| `NETBIRD_MANAGEMENT_URL` | panel NetBirda → adres instancji zarządzającej |
| `ALPHAPUMP_UPDATE_SERVER_URL` | `http://domin-server.iron.sq:40002/update` |

Trzy ostatnie prawdopodobnie już masz — używa ich wdrożenie backendu.

Zakładka **Variables**:

| Zmienna | Wartość |
| ------- | ------- |
| `EXPO_PUBLIC_API_URL` | `http://domin-server.iron.sq` |

Logowania Google **nie ustawiaj** — jest domyślnie wyłączone i nic nie wymaga.

## C. minipc — stos aplikacji

Katalog repozytorium jest Twoim wyborem — **nic w kodzie nie zna tej ścieżki**.
Compose liczy ścieżki względne od `deploy/`, serwer aktualizacji od katalogu
repozytorium, a jedno i drugie dostaje go z katalogu bieżącego. Niżej wszędzie
`~/alphapump`: katalog domowy jest nawet wygodniejszy od `/opt`, bo repozytorium
należy wtedy do tego samego użytkownika, na którym stoi serwer aktualizacji
(krok D) — `git pull` w klonie założonym przez `sudo` w `/opt` odbiłby się
o właściciela `root`.

Ścieżka wchodzi jawnie do trzech plików i tam **musi być bezwzględna** (`~` nie
rozwija się ani w systemd, ani w cronie):

| Plik | Co poprawić |
| ---- | ----------- |
| `deploy/alphapump-update-server.service` | `WorkingDirectory=` (krok D) |
| `deploy/crontab.example` | ścieżki do `scripts/backup.sh` i `deploy/smoke.sh` |
| `deploy/backup.env.example` | `ALPHAPUMP_EXPORT_CMD`, a przy odtwarzaniu `ALPHAPUMP_IMPORT_CMD` |

```bash
git clone https://github.com/Dombearx/AlphaPump ~/alphapump
cd ~/alphapump/deploy
cp .env.example .env
```

Uzupełnij `deploy/.env`:

| Zmienna | Skąd wziąć |
| ------- | ---------- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` — od razu docelowy, jego zmiana wylogowuje wszystkich |
| `BETTER_AUTH_URL` | `http://domin-server.iron.sq` — **musi** równać się `EXPO_PUBLIC_API_URL` |
| `TRUSTED_ORIGINS` | `alphapump://` (jest we wzorze) |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) → *Keys*. Puste = wykrywanie duplikatów liczone z samej pisowni; to poprawny stan, nie błąd |

> **Segregacja zgłoszeń wymaga uwagi.** Usługa `triage` bez `DISCORD_BOT_TOKEN`,
> `DISCORD_CHANNEL_ID`, `TRIAGE_GITHUB_TOKEN` i `TRIAGE_HTTP_TOKEN` kończy
> proces przy starcie i wpada w pętlę restartów (nazwę brakującej zmiennej
> widać w `docker compose logs triage`). Reszta stosu działa normalnie. Jeśli
> nie chcesz jej teraz uruchamiać, zakomentuj usługę `triage` w
> `deploy/docker-compose.yml`.
>
Skąd wziąć zmienne segregacji, jeśli ją uruchamiasz:

| Zmienna | Skąd wziąć |
| ------- | ---------- |
| `DISCORD_BOT_TOKEN` | [discord.com/developers/applications](https://discord.com/developers/applications) → aplikacja → *Bot*. Bot potrzebuje intencji „MESSAGE CONTENT" i praw na kanale: wysyłanie wiadomości, tworzenie wątków publicznych, wysyłanie w wątkach, czytanie historii |
| `DISCORD_CHANNEL_ID` | tryb dewelopera w Discordzie → PPM na kanale → *Kopiuj ID kanału*. Kanał **tekstowy**, nie forum |
| `TRIAGE_GITHUB_TOKEN` | GitHub → *Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token*. Właściciel `Dombearx`, *Only select repositories* → `AlphaPump`, uprawnienia: *Issues* → Read and write, *Pull requests* → Read-only, *Contents* → Read-only |
| `TRIAGE_HTTP_TOKEN` | znikąd — wymyślasz go sam: `openssl rand -base64 32` |

Dwa ostatnie łatwo pomylić z czymś, czym nie są, więc wprost:

- `TRIAGE_GITHUB_TOKEN` to token **konta**, nie sekret repozytorium — wpisujesz
  go w `deploy/.env` na minipc, w GitHubie nie ustawiasz nic. Nie da się go
  zastąpić `GITHUB_TOKEN`-em z Actions, bo segregacja działa poza Actions.
  Issue powstają **jako Twoje konto** (widać to w autorze), a token ma datę
  wygaśnięcia: po niej zakładanie issue przestaje działać i trzeba go wymienić.
- `TRIAGE_HTTP_TOKEN` nie pochodzi z żadnej usługi zewnętrznej. To wspólny
  sekret, którym API i triage dogadują się w środku sieci Compose: oba kontenery
  czytają tę samą zmienną z tego samego `.env`, więc nie ma czego z niczym
  uzgadniać. Port segregacji nie jest wystawiony na gospodarza, więc token jest
  drugą warstwą, nie jedyną. Bez niego przycisk „Uruchom przegląd zgłoszeń"
  w panelu (ekran „Zgłoszenia") jest niedostępny, a przegląd nadal dzieje się
  codziennie o umówionej godzinie.

Start:

```bash
cd ~/alphapump
docker compose -f deploy/docker-compose.yml up --detach --build --wait
deploy/smoke.sh http://localhost
```

`--wait` czeka na healthchecki, czyli na wykonane migracje, a nie na sam start
kontenerów.

## D. minipc — serwer aktualizacji

Przyjmuje wydania aplikacji z GitHub Actions i przebudowuje stos po mergu.

```bash
# `WorkingDirectory` we wzorze to `/home/domin/alphapump` — podstaw swoją
# ścieżkę bezwzględną przed skopiowaniem, patrz krok C
sudo cp ~/alphapump/deploy/alphapump-update-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alphapump-update-server
systemctl status alphapump-update-server
```

Jednostka zakłada użytkownika `domin` należącego do grupy `docker` — inny
użytkownik znaczy edycję pliku przed skopiowaniem, tak samo jak inna ścieżka.
Użytkownik z `User=` musi być właścicielem repozytorium: usługa robi w nim
`git pull` i `docker compose`.

> **Po każdej zmianie w `deploy/update_server.py` trzeba go zrestartować ręcznie.**
> `/update` robi `git pull`, ale nie przeładowuje samego siebie: usługa trzyma
> w pamięci kod sprzed aktualizacji repozytorium. Zadanie wydania sprawdza to
> przed wysłaniem pliku i mówi wprost, co wpisać.

## E. Pierwsze wydanie

```bash
# na minipc, po zmergowaniu gałęzi z obsługą aktualizacji do main
sudo systemctl restart alphapump-update-server
```

Merge do `main` uruchamia dwa zadania: `deploy.yml` przestawia stos (~2 min),
`android-release.yml` buduje `.apk` (~15 min) i wysyła go na minipc. Postęp widać
w zakładce *Actions*.

## F. Pierwsza instalacja i konto

1. Z telefonu **w VPN** wejdź na `http://domin-server.iron.sq/alphapump/download/`
   i pobierz plik `.apk` z listy. Android zapyta o zgodę na instalację
   z nieznanego źródła — to normalne poza sklepem.
2. Załóż konto w aplikacji (e-mail i hasło).
3. Nadaj sobie rolę administratora — bez niej panel nie wpuści:

   ```bash
   cd ~/alphapump
   docker compose -f deploy/docker-compose.yml exec db \
     psql -U alphapump -d alphapump \
     -c "UPDATE users SET role = 'admin' WHERE email = 'twoj@adres.pl';"
   ```

4. Panel: `http://domin-server.iron.sq/` — logowanie tym samym kontem.

Od tego momentu każdy merge do `main` daje wydanie, które telefony **proponują**
przy najbliższym otwarciu aplikacji. Instalacja nie jest cicha: potwierdzasz ją
w oknie aplikacji, a potem system pyta o podmianę pakietu.

## G. Przegląd biblioteki przed rozdaniem

Wszystko robisz w panelu, zakładka *Biblioteka*: przeglądanie, dodawanie,
zmienianie i usuwanie — zarówno ćwiczeń, jak i tagów. Formularz ćwiczenia
obejmuje nazwę, typ logowania, tag główny, tagi dodatkowe, siłownię i notatkę.

Biblioteka jest wspólna dla całej grupy, więc dodane pozycje zobaczą wszyscy.
Jedyna różnica między ćwiczeniem wbudowanym a dodanym przez Ciebie to autor
(konto systemowe kontra Twoje) — na widoczność ani na filtrowanie po tagach nie
wpływa to w żaden sposób.

Kolejność ma znaczenie w jedną stronę: **najpierw tagi, potem ćwiczenia**. Tag
główny jest wymagany, więc przy pustej liście tagów przycisk dodawania ćwiczenia
jest nieaktywny.

Dwie reguły, które panel egzekwuje i które łatwo wziąć za błąd:

- **usunięcie jest miękkie** — wiersz zostaje, żeby serie nie straciły tego, na
  co wskazują. Skasowane ćwiczenie znika z list, ale historia pozostaje spójna,
  a seed przy starcie aplikacji **nie wskrzesi** go z powrotem,
- **typu logowania nie da się zmienić** — kto chce inny, tworzy nowe ćwiczenie.
  Zmiana typu unieważniłaby zapisane serie.

## H. Zanim rozdasz grupie

- `deploy/smoke.sh http://domin-server.iron.sq` przechodzi w całości,
- kopie zapasowe: cron z `scripts/backup.sh`, klucz `age` **przechowywany poza
  minipc**, i co najmniej jedno odtworzenie wykonane na sucho
  (`scripts/restore.sh` do bazy testowej, nie produkcyjnej),
- pamiętaj, że w VPN każdy może założyć konto — dodanie kogoś do NetBirda jest
  równoznaczne z daniem dostępu do aplikacji.

## Gdy coś nie działa

| Objaw | Przyczyna |
| ----- | --------- |
| zadanie wydania: „Brak sekretu ANDROID_KEYSTORE_BASE64" | krok A i B |
| zadanie wydania: „nie zna trasy POST /apk" | `sudo systemctl restart alphapump-update-server` |
| aplikacja nie łączy się z serwerem | `EXPO_PUBLIC_API_URL` ≠ `BETTER_AUTH_URL`, albo telefon poza VPN |
| telefon nie widzi nowej wersji | sprawdź `curl http://domin-server.iron.sq/alphapump/download/latest.json` |
| `docker compose logs triage` w pętli restartów | brak zmiennych Discorda/GitHuba — patrz krok C |
| panel nie wpuszcza | brak roli administratora — krok F.3 |
