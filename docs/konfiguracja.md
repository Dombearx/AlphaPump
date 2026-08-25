# Konfiguracja

Wszystkie zmienne środowiskowe w jednym miejscu — po jednej tabeli na plik
`.env`. Kolejność kroków przy pierwszym uruchomieniu opisuje
[`uruchomienie.md`](uruchomienie.md); *dlaczego* akurat te wartości —
[`stack_technologiczny.md`](stack_technologiczny.md).

Każdy plik `.env` ma obok siebie `.env.example` z kompletem kluczy. Wzór jest
źródłem prawdy o tym, **co** trzeba ustawić; ta tabela mówi, **skąd to wziąć**.

Trzy aplikacje, trzy pliki `.env`, każdy obok swojej aplikacji. Wzorce leżą
w repozytorium (`apps/*/.env.example`) i to one są kompletną listą zmiennych —
poniższe tabele mówią, **skąd wziąć wartości** i co się stanie, gdy ich nie ma.

Zasada jest jedna: brakuje czegoś, bez czego serwer nie ma jak działać — proces
kończy się przy starcie. Brakuje klucza do funkcji dodatkowej — funkcja jest
wyłączona, a serwer wstaje i mówi o tym w logu.

### `apps/api/.env` — backend

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `DATABASE_URL` | **tak** | adres PostgreSQL 17 **z pgvectorem** (patrz niżej) |
| `BETTER_AUTH_SECRET` | **tak** | własny sekret, min. 32 znaki: `openssl rand -base64 48` |
| `BETTER_AUTH_URL` | nie (`http://localhost:3000`) | publiczny adres API — wchodzi do adresów zwrotnych OAuth i do OpenAPI |
| `TRUSTED_ORIGINS` | nie | lista po przecinku: schemat aplikacji (`alphapump://`) i adres panelu |
| `GOOGLE_SIGN_IN_ENABLED` | nie (`false`) | wyłącznik logowania i rejestracji przez Google — **domyślnie wyłączone** |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | nie | Google Cloud Console → *APIs & Services* → *Credentials* → OAuth client ID typu **Web application** |
| `OPENROUTER_API_KEY` | nie | [openrouter.ai](https://openrouter.ai) → *Keys* |
| `LLM_ENABLED`, `RERANKER_ENABLED` | nie (`true`) | wyłączniki warstw wykrywania duplikatów |
| `EMBEDDING_MODEL`, `RERANKER_MODEL`, `LLM_TIMEOUT_MS` | nie | wartości domyślne z `.env.example` |
| `TRANSLATION_ENABLED` | nie (`true`) | wyłącznik tłumaczenia nazw tagów i ćwiczeń |
| `TRANSLATION_MODEL`, `TRANSLATION_TIMEOUT_MS` | nie | model tłumaczący (domyślnie Haiku) i limit czasu |
| `VOICE_ENABLED` | nie (`true`) | wyłącznik dyktowania serii — i głosem, i z klawiatury |
| `SPEECH_TO_TEXT_API_KEY` | nie | klucz usługi transkrypcji, np. [console.groq.com](https://console.groq.com) → *API Keys*; bez niego zostaje dyktowanie z klawiatury |
| `SPEECH_TO_TEXT_URL`, `SPEECH_TO_TEXT_MODEL` | nie | adres i model transkrypcji — domyślnie Groq i `whisper-large-v3-turbo` |
| `VOICE_MODEL`, `VOICE_TIMEOUT_MS` | nie | model wyciągający serię z transkrypcji i limit czasu |
| `HOST`, `PORT` | nie (`0.0.0.0:3000`) | nasłuch |

Wymagane są dokładnie dwie zmienne. `loadConfig` wypisuje **komplet** braków
naraz i przerywa start — literówka w adresie bazy ma wywalić proces od razu,
a nie przy pierwszym logowaniu.

Logowanie przez Google jest **domyślnie wyłączone** i wymaga `GOOGLE_SIGN_IN_ENABLED=true`
**oraz** kompletu poświadczeń — sama flaga nie ma czym rozmawiać z Google, a same
poświadczenia znaczą „przygotowane, jeszcze nieużywane". Rozdzielenie jest celowe:
gdyby metodę wyłączało wyczyszczenie `GOOGLE_CLIENT_ID`, wróciłaby w chwili, w której
ktoś wkleiłby poświadczenia z powrotem. E-mail z hasłem działa niezależnie.
Brak `OPENROUTER_API_KEY` (albo `LLM_ENABLED=false`) sprowadza
wykrywanie duplikatów do warstwy leksykalnej — tworzenie ćwiczeń nie zmienia się
w żaden sposób. Żadne z tych dwóch nie jest błędem konfiguracji.

Tym samym kluczem jedzie **tłumaczenie nazw** tagów i ćwiczeń, ale ma własny
wyłącznik (`TRANSLATION_ENABLED`). Wyłączone — albo niedostępny dostawca modeli —
znaczy „nazwy zostają w języku, w którym je wpisano": zapis nigdy nie jest
blokowany, a `localizedName` cofa się wtedy do nazwy kanonicznej. Nazwy dochodzą
kolejką **po** zapisie, więc ani REST, ani `POST /sync/push` nie czekają na model.

**Dyktowanie serii** stoi na modelu wyciągającym z tekstu ćwiczenie i pomiary,
czyli na `OPENROUTER_API_KEY`. Klucz transkrypcji jest **dodatkiem**, który
dokłada do tego mikrofon — i to rozróżnienie widać w zachowaniu:

| Stan | `POST /voice/text` (opis z klawiatury) | `POST /voice/set` (nagranie) |
| ---- | -------------------------------------- | ---------------------------- |
| oba klucze | działa | działa |
| bez `SPEECH_TO_TEXT_API_KEY` | działa | 503 — ekran prosi o napisanie |
| bez `OPENROUTER_API_KEY` albo `VOICE_ENABLED=false` | 503 | 503 |

Wdrożenie bez klucza transkrypcji jest więc stanem sensownym samym w sobie:
klawiatura Androida ma własny mikrofon i własną transkrypcję, za którą nie
płacimy. W każdym z tych stanów zapisywanie serii formularzem nie zmienia się
w żaden sposób. Adres transkrypcji jest zmienną, a nie nazwą dostawcy: pasuje
każda usługa mówiąca protokołem `POST /audio/transcriptions` OpenAI, więc zmiana
dostawcy to zmiana dwóch zmiennych, a nie zmiana kodu.

> **Node nie czyta `.env` sam.** `node dist/index.js` zobaczy tylko zmienne ze
> środowiska procesu, więc do uruchomienia z pliku trzeba flagi:
> `node --env-file=apps/api/.env dist/index.js` — albo wczytania zmiennych do
> powłoki (`set -a; . apps/api/.env; set +a`). Dotyczy to również CLI eksportu
> i importu: czytają tę samą konfigurację, więc cron potrzebuje także
> `BETTER_AUTH_SECRET`, choć kopia zapasowa nie ma z sesjami nic wspólnego.
> Panel (Vite) i aplikacja mobilna (Expo) ładują swoje pliki `.env` same.

### `apps/admin/.env` — panel administracyjny

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `VITE_API_URL` | nie (`http://localhost:3000`) | cel proxy Vite (`/api-proxy`) w trybie deweloperskim |
| `VITE_API_BASE` | nie (puste) | adres, pod który panel woła API w przeglądarce; puste = proxy w dev, to samo pochodzenie w buildzie |

Zmienne `VITE_*` są **wkompilowane w build**, więc zmiana adresu API na
produkcji wymaga ponownego `vite build`, a nie restartu.

### `apps/mobile/.env` — aplikacja mobilna

| Zmienna | Wymagana | Skąd wziąć |
| ------- | -------- | ---------- |
| `EXPO_PUBLIC_API_URL` | nie (`http://localhost:3000`) | adres API **widoczny z telefonu**: IP w LAN lub w NetBirdzie; emulator Androida widzi hosta pod `10.0.2.2` |
| `EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED` | nie (`false`) | pokazuje przycisk „Continue with Google" — musi iść w parze z `GOOGLE_SIGN_IN_ENABLED` po stronie serwera |
| `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` | nie | ten sam projekt Google Cloud, client ID typu **Web** — także na Androidzie, bo to on jest odbiorcą `idToken`, który weryfikuje serwer |
| `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` | nie | client ID typu **iOS** |

Natywne logowanie na Androidzie wymaga dodatkowo klienta OAuth typu **Android**
w tym samym projekcie Google Cloud (pakiet `app.alphapump.mobile` i odcisk SHA-1
klucza podpisującego). Do `.env` on nie wchodzi, ale bez niego Sign-In kończy się
błędem po stronie Google.

Ma to konsekwencję łatwą do przeoczenia: **odcisk dotyczy klucza, którym podpisano
wydanie**, więc wygenerowanie własnego keystore'a (a jest wymagane — patrz
„Aplikacja na Androida") jest jednocześnie zmianą po stronie Google. Nowy odcisk
bierze się z `keytool -list -v -keystore alphapump.keystore -alias alphapump`.
Dopóki logowanie Google jest wyłączone, nic z tego nie jest potrzebne.

Adres API jest wkompilowany w bundle i **z niego wyliczają się** wyjątki od
szyfrowania ruchu (ATS na iOS, `network_security_config` na Androidzie), więc po
jego zmianie trzeba przejść przez `prebuild`, a nie tylko przeładować aplikację.

### Kopie zapasowe — zmienne dla crona i CI

Skrypty z `scripts/` nie czytają `.env`; zmienne biorą ze środowiska.

| Zmienna | Gdzie | Skąd wziąć |
| ------- | ----- | ---------- |
| `DATABASE_URL`, `BETTER_AUTH_SECRET` | skrypty wołające CLI z repozytorium | jak w konfiguracji API |
| `BACKUP_DIR` | `backup.sh` | katalog kopii na tej maszynie — cel domyślny, nic poza ścieżką do ustawienia |
| `RCLONE_REMOTE` | `backup.sh` | cel zdalny **zamiast** `BACKUP_DIR`: katalog po `rclone config`, np. `gdrive:alphapump-backups` |
| `AGE_RECIPIENTS` | `backup.sh` | klucze **publiczne** `age` po przecinku (`age-keygen`): główny i CI. Wymagane przy `RCLONE_REMOTE`, dobrowolne przy `BACKUP_DIR` |
| `RETENTION_DAYS`, `BACKUP_PREFIX` | `backup.sh` | domyślnie `90` i `alphapump` |
| `ALPHAPUMP_EXPORT_CMD` | `backup.sh` | polecenie wypisujące archiwum na stdout — wzór w `deploy/backup.env.example` |
| `AGE_IDENTITY` | `restore.sh` | plik z kluczem **prywatnym** — z menedżera haseł, nigdy z minipc. Tylko dla kopii `.age` |
| `ALPHAPUMP_IMPORT_CMD` | `restore.sh` | polecenie czytające archiwum ze stdin |
| `RESTORE_DATABASE_URL` | `backup-drill.sh` | czysta baza docelowa próby |

Dwie ostatnie zmienne istnieją dlatego, że **na minipc gospodarz nie ma dostępu
do bazy**: Postgres nie wystawia portu, jest widoczny wyłącznie w sieci Compose.
Eksport i import idą więc wewnątrz kontenera API (`docker compose exec`),
a zapis kopii, szyfrowanie i ewentualna wysyłka zostają na gospodarzu, bo to tam
leżą katalog kopii, klucz `age` i konfiguracja rclone. Gdy zmiennych nie ma,
skrypty wołają CLI z repozytorium tak jak dotąd — i wtedy potrzebują
`DATABASE_URL`.

Cel kopii jest **jeden z dwóch** i `backup.sh` przerywa, gdy ustawione są oba
albo żaden. `BACKUP_DIR` jest wariantem na start: broni przed złą migracją,
pomyłkowym `DELETE` i przewróconym kontenerem, ale nie przed padem dysku — kopia
leży wtedy razem z oryginałem. Szyfrowanie jest przy nim dobrowolne, bo kto ma
dostęp do dysku serwera, ma i tak dostęp do bazy; przy `RCLONE_REMOTE` jest
wymagane i skrypt tego pilnuje, zamiast po cichu oddać obcemu dostawcy historię
treningową grupy.

Po stronie repozytorium jest jeden sekret: `AGE_CI_IDENTITY` (comiesięczna próba
odtworzenia). Bez niego próba nadal przechodzi — na kluczu jednorazowym.
