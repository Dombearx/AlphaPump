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
   * Adres usługi `services/triage` w sieci Compose (np. `http://triage:8090`)
   * i token, którym panel administracyjny wyzwala u niej przegląd na żądanie —
   * patrz `POST /admin/feedback/run`. Bez obu naraz endpoint istnieje, ale
   * oddaje 503: przegląd i tak dzieje się codziennie o umówionej godzinie
   * wewnątrz samej usługi `triage`, niezależnie od tego, czy API potrafi go
   * wyzwolić ręcznie.
   */
  TRIAGE_URL: z.url().optional(),
  TRIAGE_HTTP_TOKEN: z.string().optional(),

  /* ------------------------------------------- warstwa semantyczna (etap 12) */

  /**
   * Wyłącznik **całej** warstwy semantycznej i LLM-owej. `false` cofa wykrywanie
   * duplikatów do zachowania z etapu 8: ostrzeżenie liczone z samej pisowni.
   * Tworzenie ćwiczeń działa dalej bez zmian — to jest kryterium ukończenia
   * etapu 12 i dlatego wyłącznik jest jedną zmienną, a nie ćwiczeniem
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
  /** Katalog na zgłoszenia zwrotne — patrz `FEEDBACK_DIR`. */
  feedbackDir: string;
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
        }
      : null;

  const triageToken = environmentVariables.TRIAGE_HTTP_TOKEN?.trim() ?? '';
  const triage =
    environmentVariables.TRIAGE_URL && triageToken.length > 0
      ? { url: environmentVariables.TRIAGE_URL, token: triageToken }
      : null;

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
    feedbackDir: environmentVariables.FEEDBACK_DIR,
    triage,
  };
}
