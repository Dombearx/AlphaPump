/**
 * Konfiguracja serwera — czytana ze środowiska i walidowana raz, przy starcie.
 *
 * Brakujący sekret albo literówka w adresie bazy mają wywalić proces
 * natychmiast, a nie przy pierwszym żądaniu logowania. Dlatego `loadConfig`
 * rzuca z listą wszystkich brakujących zmiennych naraz, zamiast zwracać wartości
 * domyślne, które udają, że wszystko jest w porządku.
 */

import { z } from 'zod';

const nonEmpty = z.string().trim().min(1);

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  /** Nasłuch na `0.0.0.0` jest świadomy: sieć lokalna minipc jest zaufana. */
  HOST: nonEmpty.default('0.0.0.0'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(3000),
  DATABASE_URL: nonEmpty,
  /**
   * Sekret podpisujący sesje. Minimum 32 znaki — better-auth wyprowadza z niego
   * klucze, a krótki sekret jest jedynym łatwym do popełnienia błędem, którego
   * nie widać w żadnym logu.
   */
  BETTER_AUTH_SECRET: z.string().min(32),
  /** Publiczny adres API — wchodzi do adresów zwrotnych OAuth i do OpenAPI. */
  BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
  /** Lista po przecinkach; puste znaczy „tylko `BETTER_AUTH_URL`". */
  TRUSTED_ORIGINS: z.string().default(''),
  /**
   * Wyłącznik logowania i rejestracji przez Google — jedno i drugie, bo to ten
   * sam przepływ: konto zakłada się pierwszym udanym logowaniem.
   *
   * Jawna flaga, a nie samo „nie ustawiaj poświadczeń", i to jest decyzja.
   * Wyłączenie przez wyczyszczenie `GOOGLE_CLIENT_ID` znaczyłoby, że metoda
   * wraca w chwili, w której ktoś wklei poświadczenia z powrotem do
   * `deploy/.env` — a wracać ma wtedy, gdy ktoś tego chce. Ten sam wzorzec co
   * `LLM_ENABLED` obok klucza OpenRoutera.
   *
   * Domyślnie **wyłączone**: natywny Sign-In wymaga odcisku SHA-1 klucza
   * podpisującego wydanie w Google Cloud, więc każda zmiana klucza jest zmianą
   * po stronie Google. Dopóki metoda nie jest potrzebna, jest to koszt bez
   * pożytku. Logowanie e-mailem działa niezależnie.
   */
  GOOGLE_SIGN_IN_ENABLED: z.stringbool().default(false),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

  /**
   * Gdzie lądują zgłoszenia zwrotne z aplikacji (tekst, nick, data i ostatnie
   * logi telefonu) — na dysku, nie w bazie. To jest świadomie prosta,
   * doraźna skrzynka wsparcia: jeden plik na zgłoszenie, czytelny `cat`-em na
   * minipc, bez migracji dla czegoś, co nie jest encją produktu.
   */
  FEEDBACK_DIR: nonEmpty.default('./data/feedback'),

  /**
   * Katalog z wydaniami OTA — paczkami JavaScriptu, które telefon pobiera
   * zamiast całego pliku `.apk`. Zapisuje go `deploy/update_server.py` na
   * gospodarzu, API wyłącznie z niego czyta (wolumin tylko do odczytu).
   *
   * Wartość domyślna wskazuje na katalog obok tego ze zgłoszeniami zwrotnymi:
   * brak katalogu nie jest awarią, tylko stanem „nikt jeszcze nie wydał paczki",
   * a wtedy telefony uruchamiają tę wbudowaną w `.apk`.
   */
  OTA_DIR: nonEmpty.default('./data/ota'),

  /**
   * Katalog z kopiami zapasowymi, podmontowany **tylko do odczytu**. Serwer nic
   * tu nie pisze — kopie robi cron na gospodarzu (`scripts/backup.sh`), a API
   * wyłącznie sprawdza, kiedy powstała najnowsza, i pokazuje to w panelu.
   *
   * Pominięcie jest w pełni obsłużonym stanem, a nie brakiem konfiguracji:
   * kopie z założenia leżą poza stosem (przy `RCLONE_REMOTE` nawet poza
   * maszyną), więc `/admin/stats` mówi wtedy „nie mam jak zajrzeć" zamiast
   * zmyślać, że kopii nie ma.
   */
  BACKUP_DIR: z.string().optional(),

  /**
   * Adres usługi `services/triage` w sieci Compose (np. `http://triage:8090`)
   * i token, którym panel administracyjny wyzwala u niej przegląd na żądanie —
   * patrz `POST /admin/feedback/run`. Bez obu naraz endpoint istnieje, ale
   * oddaje 503: przegląd i tak dzieje się sam, w kilkanaście sekund po
   * wpłynięciu zgłoszenia, wewnątrz samej usługi `triage` — niezależnie od
   * tego, czy API potrafi go wyzwolić ręcznie.
   */
  // `z.string()`, nie `z.url()`: Compose przekazuje pusty napis, gdy
  // `TRIAGE_HTTP_TOKEN` nie jest ustawiony (`${TRIAGE_HTTP_TOKEN:+…}` w
  // `docker-compose.yml`), a `.optional()` łapie tylko `undefined` — pusty
  // napis trafiłby w `z.url()` i wywalał start serwera komunikatem
  // „Invalid URL" na stosie, który świadomie triage'a nie skonfigurował.
  TRIAGE_URL: z.string().optional(),
  TRIAGE_HTTP_TOKEN: z.string().optional(),

  /* ------------------------------------------------------ warstwa semantyczna */

  /**
   * Wyłącznik **całej** warstwy semantycznej i LLM-owej. `false` cofa wykrywanie
   * duplikatów do samej warstwy leksykalnej: ostrzeżenie liczone z pisowni.
   * Tworzenie ćwiczeń działa dalej bez zmian — to jest kryterium ukończenia
   * produktu i dlatego wyłącznik jest jedną zmienną, a nie ćwiczeniem
   * z komentowania kodu.
   */
  LLM_ENABLED: z.stringbool().default(true),
  /** Bez klucza warstwa jest po prostu wyłączona — serwer wstaje normalnie. */
  OPENROUTER_API_KEY: z.string().optional(),
  /**
   * Model embeddingów. Musi zwracać wektor o wymiarze `EMBEDDING_DIMENSIONS` —
   * odpowiedź o innym wymiarze jest odrzucana, bo indeks HNSW ma wymiar wpisany
   * w schemat.
   */
  EMBEDDING_MODEL: nonEmpty.default('qwen/qwen3-embedding-0.6b'),
  /** Model re-rankera (warstwa 3). Generatywny, więc droższy i wolniejszy. */
  RERANKER_MODEL: nonEmpty.default('google/gemini-2.5-flash'),
  /**
   * Osobny wyłącznik warstwy 3. Do znalezienia podobnych wystarczą embeddingi;
   * model generatywny dokłada wyłącznie uzasadnienie i ocenę, więc jego
   * wyłączenie zostawia funkcję działającą, tylko bez komentarza.
   */
  RERANKER_ENABLED: z.stringbool().default(true),
  /**
   * Limit czasu na wywołanie modelu. Krótki świadomie: wykrywanie duplikatów
   * jest **podpowiedzią** przy tworzeniu ćwiczenia, więc lepiej jej nie pokazać
   * niż kazać użytkownikowi czekać.
   */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),

  /* ------------------------------------------------ tłumaczenie automatyczne */

  /**
   * Model tłumaczący nazwy tagów i ćwiczeń na pozostałe języki. Haiku, bo
   * zgłoszenie wskazało go wprost, a zadanie jest krótkie: jedna nazwa i lista
   * kodów języków na wejściu, kilka słów na wyjściu.
   */
  TRANSLATION_MODEL: nonEmpty.default('anthropic/claude-haiku-4.5'),
  /**
   * Osobny wyłącznik tłumaczenia, obok `RERANKER_ENABLED`. Obie rzeczy jadą tym
   * samym kluczem OpenRoutera, ale są niezależne: tłumaczenie ma sens także
   * tam, gdzie re-ranker wyłączono dla kosztów, a wyłączone tłumaczenie nie
   * rusza wykrywania duplikatów.
   *
   * Wyłączone znaczy „nazwy zostają kanoniczne" — nie znaczy „zapis nie
   * działa". Tak samo wygląda błąd modelu, patrz `translation/fill.ts`.
   */
  TRANSLATION_ENABLED: z.stringbool().default(true),
  /**
   * Limit czasu na wywołanie tłumaczenia — osobny od `LLM_TIMEOUT_MS`, bo
   * osobny jest powód jego długości. Tam krótki, bo podpowiedź o duplikacie
   * pokazuje się w trakcie pisania; tutaj tłumaczenie idzie kolejką **poza**
   * żądaniem, więc nikt na nie nie czeka i nie ma po co ciąć go na ośmiu
   * sekundach.
   */
  TRANSLATION_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(20_000),

  /* ------------------------------------------------------ dyktowanie serii */

  /**
   * Wyłącznik dyktowania serii — i głosem, i z klawiatury. `false` znaczy
   * „aplikacja nie pokaże ekranu dyktowania" — a nie „zapis serii nie działa":
   * dyktowanie jest skrótem do formularza, który zostaje dokładnie tam, gdzie
   * był. Osobny wyłącznik obok `RERANKER_ENABLED` i `TRANSLATION_ENABLED`,
   * i z tego samego powodu: to trzy niezależne rachunki u dwóch dostawców.
   */
  VOICE_ENABLED: z.stringbool().default(true),
  /**
   * Adres usługi zamieniającej nagranie na tekst. Domyślnie Groq, bo to on padł
   * w zgłoszeniu — ale **adres, a nie nazwa dostawcy**, bo wybór nie był
   * decyzją techniczną, tylko przykładem. Każda usługa mówiąca protokołem
   * `POST /audio/transcriptions` OpenAI (Groq, OpenAI, lokalne `whisper.cpp`
   * za serwerkiem) wchodzi tu bez zmiany kodu.
   */
  SPEECH_TO_TEXT_URL: z.url().default('https://api.groq.com/openai/v1/audio/transcriptions'),
  /**
   * Klucz do tej usługi. Osobny od `OPENROUTER_API_KEY`, bo to osobny dostawca:
   * OpenRouter nie wystawia transkrypcji, a rozpoznawanie mowy i model
   * interpretujący tekst nie muszą stać u jednego.
   *
   * Bez klucza znika **samo nagrywanie**, a nie całe dyktowanie: opisanie serii
   * z klawiatury (`POST /voice/text`) idzie prosto do modelu i klucza
   * transkrypcji nie potrzebuje. Telefon chowa wtedy mikrofon, a pole tekstowe
   * zostaje — bo systemowe dyktowanie z klawiatury działa niezależnie od nas.
   */
  SPEECH_TO_TEXT_API_KEY: z.string().optional(),
  /** Model transkrypcji. `turbo`, bo nagranie ma wrócić tekstem w sekundę. */
  SPEECH_TO_TEXT_MODEL: nonEmpty.default('whisper-large-v3-turbo'),
  /**
   * Model wyciągający z tekstu ćwiczenie i liczby. Ten sam dostawca co reszta
   * warstwy LLM-owej (OpenRouter) i ten sam klucz — a że tekst bierze się albo
   * z transkrypcji, albo wprost z klawiatury, to **ten** model jest warunkiem
   * koniecznym dyktowania. Klucz transkrypcji dokłada do niego mikrofon.
   */
  VOICE_MODEL: nonEmpty.default('google/gemini-2.5-flash'),
  /**
   * Limit czasu na transkrypcję i na model, każdy z osobna. Dłuższy niż
   * `LLM_TIMEOUT_MS`, bo tu jest odwrotnie niż przy podpowiedzi o duplikacie:
   * użytkownik nacisnął przycisk i **czeka na wynik**, więc odpowiedź po pięciu
   * sekundach jest odpowiedzią, a nie karą. Krótszy niż tłumaczenie, bo tamto
   * jedzie poza żądaniem i nikt na nie nie patrzy.
   */
  VOICE_TIMEOUT_MS: z.coerce.number().int().min(500).max(120_000).default(20_000),
});

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TriageConfig {
  url: string;
  token: string;
}

/**
 * Konfiguracja warstwy semantycznej. `null` w `AppConfig.llm` znaczy „warstwa
 * wyłączona" — i jest to stan w pełni obsługiwany, nie awaria konfiguracji.
 */
export interface LlmConfig {
  apiKey: string;
  embeddingModel: string;
  rerankerModel: string;
  /** `false` — działają warstwy 1 i 2, bez oceny i uzasadnienia od modelu. */
  rerankerEnabled: boolean;
  timeoutMs: number;
  /** Model tłumaczący nazwy na pozostałe języki. */
  translationModel: string;
  /** `false` — nazwy zostają w jednym języku, zapis działa bez zmian. */
  translationEnabled: boolean;
  /** Limit czasu tłumaczenia; dłuższy niż `timeoutMs`, bo nikt na nie nie czeka. */
  translationTimeoutMs: number;
}

/** Usługa transkrypcji — protokół `POST /audio/transcriptions` OpenAI. */
export interface SpeechConfig {
  url: string;
  apiKey: string;
  model: string;
}

/**
 * Konfiguracja dyktowania serii. `null` w `AppConfig.voice` znaczy „dyktowanie
 * wyłączone" — stan w pełni obsługiwany: aplikacja nie pokazuje ekranu
 * dyktowania, a formularz serii działa bez zmian.
 *
 * `speech` jest w środku osobno, bo dyktowanie ma **dwa wejścia i jeden mózg**:
 * nagranie trzeba najpierw zamienić na tekst, a opis wpisany z klawiatury już
 * tekstem jest. Brak klucza transkrypcji zabiera więc mikrofon, a nie całą
 * funkcję — i jest to stan sensowny sam w sobie: systemowe dyktowanie
 * z klawiatury Androida nie kosztuje nas nic i działa bez żadnego dostawcy.
 */
export interface VoiceConfig {
  /** `null` — samo nagrywanie wyłączone; opis z klawiatury działa dalej. */
  speech: SpeechConfig | null;
  /** Model interpretujący tekst; u dostawcy z `LlmConfig`. */
  model: string;
  timeoutMs: number;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  host: string;
  port: number;
  databaseUrl: string;
  authSecret: string;
  baseUrl: string;
  trustedOrigins: string[];
  /**
   * `null`, gdy nie skonfigurowano Google. Logowanie e-mailem działa dalej —
   * brak jednej metody nie może zablokować startu serwera.
   */
  google: GoogleCredentials | null;
  /**
   * `null`, gdy warstwa semantyczna jest wyłączona albo nie ma klucza
   * OpenRoutera. Wykrywanie duplikatów wraca wtedy do warstwy leksykalnej, a
   * tworzenie ćwiczeń działa bez zmian.
   */
  llm: LlmConfig | null;
  /**
   * `null`, gdy dyktowanie serii jest wyłączone albo wyłączona jest cała
   * warstwa LLM-owa (`llm === null`) — bo interpretacja tekstu jedzie tym samym
   * kluczem co reszta modeli. Oba powody są tym samym stanem: telefon nie
   * pokazuje ekranu dyktowania. Brak samego klucza transkrypcji zabiera z tego
   * ekranu mikrofon (`voice.speech === null`), a nie cały ekran.
   */
  voice: VoiceConfig | null;
  /** Katalog na zgłoszenia zwrotne — patrz `FEEDBACK_DIR`. */
  feedbackDir: string;
  /** Katalog z wydaniami OTA — patrz `OTA_DIR`. */
  otaDir: string;
  /** Katalog z kopiami zapasowymi do podejrzenia; `null`, gdy niepodmontowany. */
  backupDir: string | null;
  /** `null`, gdy panel nie ma jak wyzwolić przeglądu zgłoszeń ręcznie — patrz `TRIAGE_URL`. */
  triage: TriageConfig | null;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Niepoprawna konfiguracja środowiska:\n  ${problems}`);
  }

  const environmentVariables = parsed.data;
  const trustedOrigins = environmentVariables.TRUSTED_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  // Flaga **i** komplet poświadczeń. Sama flaga bez poświadczeń nie ma czym
  // włączyć metody, a same poświadczenia bez flagi znaczą „przygotowane, ale
  // jeszcze nie używane" — stan, który przy poprzednim zapisie nie istniał.
  const google =
    environmentVariables.GOOGLE_SIGN_IN_ENABLED &&
    environmentVariables.GOOGLE_CLIENT_ID &&
    environmentVariables.GOOGLE_CLIENT_SECRET
      ? {
          clientId: environmentVariables.GOOGLE_CLIENT_ID,
          clientSecret: environmentVariables.GOOGLE_CLIENT_SECRET,
        }
      : null;

  // Brak klucza nie jest błędem konfiguracji, tylko wyłączoną warstwą. Serwer
  // bez OpenRoutera ma działać w pełni — z ostrzeżeniem o duplikatach liczonym
  // leksykalnie.
  const apiKey = environmentVariables.OPENROUTER_API_KEY?.trim() ?? '';
  const llm =
    environmentVariables.LLM_ENABLED && apiKey.length > 0
      ? {
          apiKey,
          embeddingModel: environmentVariables.EMBEDDING_MODEL,
          rerankerModel: environmentVariables.RERANKER_MODEL,
          rerankerEnabled: environmentVariables.RERANKER_ENABLED,
          timeoutMs: environmentVariables.LLM_TIMEOUT_MS,
          translationModel: environmentVariables.TRANSLATION_MODEL,
          translationEnabled: environmentVariables.TRANSLATION_ENABLED,
          translationTimeoutMs: environmentVariables.TRANSLATION_TIMEOUT_MS,
        }
      : null;

  // Dyktowanie stoi na modelu interpretującym tekst, czyli na tym samym kluczu
  // co reszta warstwy LLM-owej. Klucz transkrypcji jest **dodatkiem**, który
  // dokłada do niego mikrofon: bez niego zostaje opisanie serii z klawiatury.
  // Brak jednego i drugiego nie jest błędem konfiguracji, tylko węższą funkcją —
  // dokładnie jak brak klucza przy warstwie semantycznej.
  const speechApiKey = environmentVariables.SPEECH_TO_TEXT_API_KEY?.trim() ?? '';
  const voice =
    environmentVariables.VOICE_ENABLED && llm !== null
      ? {
          speech:
            speechApiKey.length > 0
              ? {
                  url: environmentVariables.SPEECH_TO_TEXT_URL,
                  apiKey: speechApiKey,
                  model: environmentVariables.SPEECH_TO_TEXT_MODEL,
                }
              : null,
          model: environmentVariables.VOICE_MODEL,
          timeoutMs: environmentVariables.VOICE_TIMEOUT_MS,
        }
      : null;

  const backupDir = environmentVariables.BACKUP_DIR?.trim() ?? '';

  const triageUrl = environmentVariables.TRIAGE_URL?.trim() ?? '';
  const triageToken = environmentVariables.TRIAGE_HTTP_TOKEN?.trim() ?? '';
  const triage =
    triageUrl.length > 0 && triageToken.length > 0 ? { url: triageUrl, token: triageToken } : null;

  return {
    nodeEnv: environmentVariables.NODE_ENV,
    host: environmentVariables.HOST,
    port: environmentVariables.PORT,
    databaseUrl: environmentVariables.DATABASE_URL,
    authSecret: environmentVariables.BETTER_AUTH_SECRET,
    baseUrl: environmentVariables.BETTER_AUTH_URL,
    trustedOrigins: [environmentVariables.BETTER_AUTH_URL, ...trustedOrigins],
    google,
    llm,
    voice,
    feedbackDir: environmentVariables.FEEDBACK_DIR,
    otaDir: environmentVariables.OTA_DIR,
    backupDir: backupDir.length > 0 ? backupDir : null,
    triage,
  };
}
