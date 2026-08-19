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

## Czego potrzebuje minipc

Zanim zaczniesz krok C, na minipc musi być to:

| Czego | Do czego | Sprawdzenie |
| ----- | -------- | ----------- |
| Docker z wtyczką Compose | cały stos | `docker compose version` |
| użytkownik w grupie `docker` | serwer aktualizacji i kopie wołają `docker` bez `sudo` | `id -nG` zawiera `docker` |
| `git` | klon i `git pull` przy wdrożeniu | `git --version` |
| [`uv`](https://docs.astral.sh/uv/) | serwer aktualizacji z kroku D (jednostka woła `uv run`) | `uv --version` |
| NetBird | jedyna droga do minipc — Actions wchodzą tą samą siecią | `ip -4 addr show wt0` |
| `age` i `rclone` | **tylko** kopie wysyłane na Dysk (koniec kroku H) | `age --version`, `rclone version` |

`uv` instaluje się jednym poleceniem
(`curl -LsSf https://astral.sh/uv/install.sh | sh`) i ląduje w profilu
użytkownika. Jednostka systemd celowo woła go przez powłokę logowania, więc nie
musisz nigdzie wpisywać ścieżki — ale musi być zainstalowany na **tym**
użytkowniku, na którym stoi usługa.

Kopie zapasowe i segregacja zgłoszeń są niezależne od reszty: stos wstanie i bez
nich. Kopie z kroku H w wariancie domyślnym — do katalogu na minipc — nie
potrzebują niczego ponad to, co i tak masz; `age` i `rclone` dochodzą dopiero,
gdy zechcesz wysyłać kopie na Dysk.

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
| `ALPHAPUMP_PUBLISH_TOKEN` | wymyśl długi losowy napis: `openssl rand -hex 32`. **Ten sam** wpisujesz na minipc w kroku D |
| `CLAUDE_CODE_OAUTH_TOKEN` | na własnej maszynie: `claude setup-token`. Token z subskrypcji, nie klucz API — nie obciąża rachunku za API |
| `AGE_CI_IDENTITY` | **opcjonalny**, i przy kopiach lokalnych z kroku H niepotrzebny: klucz prywatny `age` dla CI. Bez niego comiesięczna próba odtworzenia generuje parę jednorazową i nadal sprawdza cały łańcuch |

`NETBIRD_*` i `ALPHAPUMP_UPDATE_SERVER_URL` prawdopodobnie już masz — używa ich
wdrożenie backendu.

`CLAUDE_CODE_OAUTH_TOKEN` czyta `.github/workflows/agent-issue.yml`, czyli agent
podejmujący issue założone przez segregację zgłoszeń. Bez niego pętla
„zgłoszenie → issue → PR-ka" zatrzymuje się na issue: samo powstaje normalnie,
ale nikt się za nie nie bierze. Jeśli nie uruchamiasz segregacji (krok C),
sekret nie jest potrzebny.

Zakładka **Variables**:

| Zmienna | Wartość |
| ------- | ------- |
| `EXPO_PUBLIC_API_URL` | `http://domin-server.iron.sq` |

Logowania Google **nie ustawiaj** — jest domyślnie wyłączone i nic nie wymaga.

Jeszcze jedno miejsce w GitHubie, jeśli agent z `agent-issue.yml` ma otwierać
PR-ki: *Settings → Actions → General → Workflow permissions* i zgoda
„Allow GitHub Actions to create and approve pull requests". Bez niej przebieg
dojdzie do końca i przewróci się dopiero na otwieraniu PR-ki.

## C. minipc — stos aplikacji

Katalog repozytorium jest Twoim wyborem — **nic w kodzie nie zna tej ścieżki**.
Compose liczy ścieżki względne od `deploy/`, serwer aktualizacji od katalogu
repozytorium, a jedno i drugie dostaje go z katalogu bieżącego. Niżej wszędzie
`~/AlphaPump`: katalog domowy jest nawet wygodniejszy od `/opt`, bo repozytorium
należy wtedy do tego samego użytkownika, na którym stoi serwer aktualizacji
(krok D) — `git pull` w klonie założonym przez `sudo` w `/opt` odbiłby się
o właściciela `root`.

Ścieżka wchodzi jawnie do trzech plików i tam **musi być bezwzględna** (`~` nie
rozwija się ani w systemd, ani w cronie):

| Plik | Co poprawić |
| ---- | ----------- |
| `deploy/alphapump-update-server.service` | `WorkingDirectory=` (krok D) |
| `deploy/crontab.example` | ścieżki do `scripts/backup.sh` i `deploy/smoke.sh` |
| `deploy/backup.env.example` | `ALPHAPUMP_EXPORT_CMD` i `BACKUP_DIR`, a przy odtwarzaniu `ALPHAPUMP_IMPORT_CMD` |

```bash
git clone https://github.com/Dombearx/AlphaPump ~/AlphaPump
cd ~/AlphaPump/deploy
cp .env.example .env
```

Uzupełnij `deploy/.env`:

| Zmienna | Skąd wziąć |
| ------- | ---------- |
| `POSTGRES_PASSWORD` | `openssl rand -base64 32` |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 48` — od razu docelowy, jego zmiana wylogowuje wszystkich |
| `BETTER_AUTH_URL` | `http://domin-server.iron.sq` — **musi** równać się `EXPO_PUBLIC_API_URL` |
| `TRUSTED_ORIGINS` | `alphapump://` (jest we wzorze) |
| `OPENROUTER_API_KEY` | [openrouter.ai](https://openrouter.ai) → *Keys*. Puste = wykrywanie duplikatów liczone z samej pisowni; dla API i panelu to poprawny stan, nie błąd — ale segregacja zgłoszeń bez niego nie wstanie |

> **Segregacja zgłoszeń wymaga uwagi.** Usługa `triage` bez `OPENROUTER_API_KEY`,
> `DISCORD_BOT_TOKEN`, `DISCORD_CHANNEL_ID`, `TRIAGE_GITHUB_TOKEN`
> i `TRIAGE_HTTP_TOKEN` kończy proces przy starcie i wpada w pętlę restartów
> (nazwę brakującej zmiennej widać w `docker compose logs triage`). Reszta stosu
> działa normalnie. Jeśli nie chcesz jej teraz uruchamiać, zakomentuj usługę
> `triage` w `deploy/docker-compose.yml` — pusty `OPENROUTER_API_KEY` sam z siebie
> nie przeszkadza niczemu innemu.

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

Sam token Discorda nie stawia jeszcze bota na serwerze — trzeba go zaprosić:
*OAuth2 → URL Generator*, zakres `bot`, uprawnienia *Send Messages*, *Create
Public Threads*, *Send Messages in Threads*, *Read Message History*, i otworzyć
wygenerowany adres. Intencję „MESSAGE CONTENT" włącza się osobno, w zakładce
*Bot* (*Privileged Gateway Intents*).

Dwa kroki po stronie GitHuba, **przed** pierwszym przebiegiem segregacji:

```bash
# na własnej maszynie, z zalogowanym `gh` — GitHub odrzuca issue z nieznaną
# etykietą, więc bez tego pierwszy przebieg wywala się na każdym zgłoszeniu
scripts/triage-labels.sh Dombearx/AlphaPump
```

Sekret `CLAUDE_CODE_OAUTH_TOKEN` z kroku B jest drugim z nich — bez niego issue
powstaną, ale nikt ich nie podejmie.

Pierwszy przebieg wygodnie zrobić na próbę: `TRIAGE_DRY_RUN=true`
w `deploy/.env` sprawia, że klasyfikacja i wykrywanie duplikatów działają
naprawdę, ale nic nie powstaje ani na GitHubie, ani na Discordzie — wynik widać
wyłącznie w `docker compose logs triage`. Przegląd ruszy sam o `TRIAGE_DAILY_AT`
(domyślnie 03:17), a po kroku F wywołasz go od ręki przyciskiem w panelu. Po
udanej próbie wróć do `false` i podnieś stos ponownie.

Start:

```bash
cd ~/AlphaPump
docker compose -f deploy/docker-compose.yml up --detach --build --wait
deploy/smoke.sh http://localhost
```

`--wait` czeka na healthchecki, czyli na wykonane migracje, a nie na sam start
kontenerów.

Migracje i **dane startowe** (konto systemowe, tagi startowe, ćwiczenia
wbudowane) wchodzą przy każdym starcie kontenera `api` — nie ma tu osobnego
kroku do wyklikania i nie da się go pominąć. Seed wstawia wyłącznie to, czego
brakuje, więc kolejne wdrożenia nie cofają zmian zrobionych w panelu. W logu
(`docker compose -f deploy/docker-compose.yml logs api`) widać wiersz „Dane
startowe: … tagów i … ćwiczeń wbudowanych w zestawie".

## D. minipc — serwer aktualizacji

Przyjmuje wydania aplikacji z GitHub Actions i przebudowuje stos po mergu.

```bash
# Wzór celuje w `/home/domin/AlphaPump` i użytkownika `domin`. Klonowałeś gdzie
# indziej albo stoisz na innym użytkowniku? Popraw `WorkingDirectory=` i `User=`
# przed skopiowaniem — ścieżka bezwzględna, patrz krok C
sudo cp ~/AlphaPump/deploy/alphapump-update-server.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now alphapump-update-server
systemctl status alphapump-update-server
```

Token wydawniczy wchodzi w **drop-inie**, a nie w pliku jednostki — ten jest
w repozytorium:

```bash
sudo systemctl edit alphapump-update-server
# [Service]
# Environment=UPDATE_SERVER_PUBLISH_TOKEN=<ten sam napis co sekret ALPHAPUMP_PUBLISH_TOKEN>
sudo systemctl restart alphapump-update-server
```

Bez niego `POST /apk` i `POST /ota` oddają 503 i mówią, czego brakuje —
publikowanie jest **wyłączone**, a nie otwarte. Czytanie manifestów przez telefony
i `/update` działają dalej, więc pominięcie tego kroku nie odcina wdrożeń, tylko
wydania. Token jest jedyną rzeczą stojącą między dostępem do VPN-u a możliwością
wysłania dowolnego JavaScriptu na wszystkie telefony w grupie: paczka OTA, w
odróżnieniu od pliku `.apk`, nie ma podpisu, który sprawdzałby system.

Użytkownik z `User=` musi należeć do grupy `docker`, mieć `uv` w profilu i być
**właścicielem katalogu repozytorium**: usługa robi w nim `git pull` i
`docker compose`. Klon w katalogu domowym spełnia to sam z siebie.

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
   cd ~/AlphaPump
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

Panel pokazuje **tę samą** bibliotekę co telefony: obie strony seedują się z tego
samego pliku i liczą identyfikatory z nazw tym samym kodem, a serwer robi to przy
każdym starcie. Gdyby telefon miał u siebie ćwiczenie wbudowane, którego serwer
nie zna (na przykład aplikacja wyprzedziła wdrożenie serwera), dośle je sam przy
najbliższej synchronizacji — razem z serią, która na nie wskazuje.

Kolejność ma znaczenie w jedną stronę: **najpierw tagi, potem ćwiczenia**. Tag
główny jest wymagany, więc przy pustej liście tagów przycisk dodawania ćwiczenia
jest nieaktywny.

Dwie reguły, które panel egzekwuje i które łatwo wziąć za błąd:

- **usunięcie jest miękkie** — wiersz zostaje, żeby serie nie straciły tego, na
  co wskazują. Skasowane ćwiczenie znika z list, ale historia pozostaje spójna,
  a seed przy starcie aplikacji **nie wskrzesi** go z powrotem,
- **typu logowania nie da się zmienić** — kto chce inny, tworzy nowe ćwiczenie.
  Zmiana typu unieważniłaby zapisane serie.

## H. Kopie zapasowe — na minipc, obok bazy

Nie da się tego odłożyć „na po rozdaniu": pierwsza kopia jest potrzebna, zanim
w bazie pojawi się cokolwiek, czego nie chcesz stracić. Wariant niżej stawia się
w kilka minut, bo kopia zostaje na minipc: nie ma tu ani konta u dostawcy, ani
klucza szyfrującego do przechowania. Wariant z wysyłką na Dysk jest na końcu
kroku — przechodzi się na niego podmianą jednej zmiennej.

```bash
sudo install -D -m 600 ~/AlphaPump/deploy/backup.env.example /etc/alphapump/backup.env
sudo nano /etc/alphapump/backup.env    # ALPHAPUMP_EXPORT_CMD i BACKUP_DIR — ścieżki swoje
sudo touch /var/log/alphapump-backup.log /var/log/alphapump-smoke.log
sudo chown "$USER" /var/log/alphapump-backup.log /var/log/alphapump-smoke.log

# pierwsza kopia ręcznie, żeby zobaczyć błąd konfiguracji teraz, a nie w nocy
set -a; . /etc/alphapump/backup.env; set +a; ~/AlphaPump/scripts/backup.sh
ls -l "$BACKUP_DIR"

crontab -e                             # wpisy z deploy/crontab.example, ścieżki swoje
```

`BACKUP_DIR` daj **poza katalogiem repozytorium** — w repozytorium serwer
aktualizacji robi `git pull` i kopie nie mają czego szukać w drzewie, którym
zarządza automat. Skrypt zakłada katalog sam z prawami `700` i daje plikom `600`:
kopia jest tu nieszyfrowana, więc prawa są jedyną ochroną.

> **Wiedz, przed czym to broni.** Zła migracja, pomyłkowy `DELETE`, przewrócony
> kontener — tak, i to są przypadki najczęstsze. Pad dysku albo utrata minipc —
> **nie**, bo kopia leży wtedy razem z oryginałem. Katalog wskazany na osobny
> nośnik albo na zamontowany zasób sieciowy zdejmuje i to zastrzeżenie, bez
> zmiany czegokolwiek w konfiguracji poza samą ścieżką.

Zostaje jedna rzecz, bez której kopia jest tylko plikiem na dysku:
**odtworzenie wykonane na sucho.** `scripts/restore.sh` kieruj do bazy testowej,
nigdy do produkcyjnej — importuje do **czystej** bazy, więc wycelowany w tę
właściwą zamieniłby dzisiejsze dane na wczorajsze. Baza na próbę stoi w tym samym
kontenerze, a kopia lokalna nie wymaga do tego żadnego klucza:

```bash
cd ~/AlphaPump
docker compose -f deploy/docker-compose.yml exec db \
  psql -U alphapump -d alphapump -c 'CREATE DATABASE alphapump_proba;'

# hasło to POSTGRES_PASSWORD z deploy/.env; `db` to nazwa usługi w sieci Compose
ALPHAPUMP_IMPORT_CMD="docker compose -f $HOME/AlphaPump/deploy/docker-compose.yml exec -T -e DATABASE_URL=postgres://alphapump:HASŁO@db:5432/alphapump_proba api node /app/apps/api/dist/cli/import.js" \
  scripts/restore.sh ~/alphapump-backups/alphapump-2026-08-17.json.gz

docker compose -f deploy/docker-compose.yml exec db \
  psql -U alphapump -d alphapump_proba -c 'SELECT count(*) FROM users;'
```

Import sam uruchamia migracje i seed przed wczytaniem archiwum, więc pusta baza
`alphapump_proba` to wszystko, czego potrzebuje. Po próbie skasuj ją
(`DROP DATABASE alphapump_proba;`).

Comiesięczną próbę robi też `.github/workflows/backup-restore.yml` (na danych
fikcyjnych, prawdziwy eksport nigdy nie trafia do CI), a `scripts/backup-drill.sh`
przechodzi cały łańcuch lokalnie.

### Kiedy zechcesz kopię poza minipc

Wtedy dochodzą dwie rzeczy, obie pomijalne dzisiaj. Klucz `age` — na własnej
maszynie, nie na minipc:

```bash
age-keygen -o alphapump-age.txt      # klucz prywatny: menedżer haseł, wydruk
grep 'public key' alphapump-age.txt  # klucz publiczny (`age1…`) idzie na minipc
```

> Na minipc trafia **wyłącznie klucz publiczny**. Klucz prywatny na maszynie,
> której kopie dotyczą, jest najczęstszą przyczyną kopii bezużytecznych: awaria
> zabiera jedno i drugie. Do odtworzenia przynosisz go z menedżera haseł
> (`scripts/restore.sh` czyta ścieżkę ze zmiennej `AGE_IDENTITY`).

I wysyłka — `rclone` autoryzuje się w przeglądarce, więc konfigurację robisz na
maszynie, która ją ma, i przenosisz plik na minipc:

```bash
rclone config                                  # remote na Dysk, np. `gdrive`
rclone lsd gdrive:                             # sprawdzenie
scp ~/.config/rclone/rclone.conf minipc:~/.config/rclone/rclone.conf
```

W `/etc/alphapump/backup.env` zamieniasz wtedy `BACKUP_DIR` na `RCLONE_REMOTE`
i `AGE_RECIPIENTS` — obie czekają zakomentowane we wzorze, wystarczy je
odkomentować i zakomentować `BACKUP_DIR`. `backup.sh` przerywa, gdy
ustawisz oba cele naraz albo gdy wyślesz na Dysk bez szyfrowania — kopia
u zewnętrznego dostawcy to historia treningowa całej grupy.

## I. Zanim rozdasz grupie

- `deploy/smoke.sh http://domin-server.iron.sq` przechodzi w całości,
- kopie zapasowe z kroku H działają (`ls "$BACKUP_DIR"` pokazuje dzisiejszy
  plik), a odtworzenie zostało wykonane na sucho — pamiętając, że kopia na
  minipc nie przeżyje utraty samego minipc,
- `docker compose -f deploy/docker-compose.yml ps` pokazuje wszystkie usługi jako
  `running`/`healthy` — w tym `triage`, jeśli ją uruchamiasz,
- pamiętaj, że w VPN każdy może założyć konto — dodanie kogoś do NetBirda jest
  równoznaczne z daniem dostępu do aplikacji.

## Gdy coś nie działa

| Objaw | Przyczyna |
| ----- | --------- |
| zadanie wydania: „Brak sekretu ANDROID_KEYSTORE_BASE64" | krok A i B |
| zadanie wydania: „nie zna trasy POST /apk" albo „POST /ota" | `sudo systemctl restart alphapump-update-server` |
| zadanie wydania: „Brak sekretu ALPHAPUMP_PUBLISH_TOKEN" | ustaw sekret repozytorium — patrz krok D |
| serwer aktualizacji oddaje 503 „Publishing is disabled" | brak `UPDATE_SERVER_PUBLISH_TOKEN` w drop-inie systemd — `sudo systemctl edit alphapump-update-server` |
| serwer aktualizacji oddaje 401 przy wydaniu | token w drop-inie systemd ≠ sekret `ALPHAPUMP_PUBLISH_TOKEN` w repozytorium |
| aplikacja nie łączy się z serwerem | `EXPO_PUBLIC_API_URL` ≠ `BETTER_AUTH_URL`, albo telefon poza VPN |
| telefon nie widzi nowego pakietu `.apk` | sprawdź `curl http://domin-server.iron.sq/alphapump/download/latest.json` |
| telefon nie dostaje paczki JavaScriptu | sprawdź `curl http://<minipc>:40002/ota` — czy jest wpis dla odcisku, który ma telefon; zgodność odcisków: `curl .../alphapump/download/latest.json \| jq .runtimeVersion` |
| każde wydanie idzie pełnym pakietem, choć nic natywnego się nie ruszyło | `latest.json` nie ma pola `runtimeVersion` (wydanie sprzed tej zmiany) — pierwszy `.apk` po niej naprawia to sam |
| `docker compose logs triage` w pętli restartów | brak jednej z pięciu zmiennych z kroku C — log podaje nazwę |
| `systemctl status alphapump-update-server`: `uv: command not found` | `uv` nie jest zainstalowany na użytkowniku z `User=` — patrz „Czego potrzebuje minipc" |
| serwer aktualizacji: `dubious ownership` albo `Permission denied` przy `git pull` | repozytorium należy do innego użytkownika niż ten z `User=` — `sudo chown -R <user> <katalog>` |
| segregacja: błąd przy zakładaniu issue, „label does not exist" | `scripts/triage-labels.sh` nie został uruchomiony — krok C |
| issue z etykietą `ai-triage` powstaje, ale agent się nie rusza | brak `CLAUDE_CODE_OAUTH_TOKEN` albo zgody na otwieranie PR-ek — krok B |
| bot na Discordzie nie pisze, choć usługa działa | bot nie jest zaproszony na serwer albo nie ma praw na kanale — krok C |
| panel nie wpuszcza | brak roli administratora — krok F.3 |
| kopia: „Ustaw BACKUP_DIR … albo RCLONE_REMOTE" | w `/etc/alphapump/backup.env` nie ma celu kopii — krok H |
| kopia: „Kopia ma tylko N bajtów — przerywam" | eksport nic nie oddał: stos nie stoi albo `ALPHAPUMP_EXPORT_CMD` celuje w złą ścieżkę `docker-compose.yml` |
