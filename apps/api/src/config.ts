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
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),

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

  const google =
    environmentVariables.GOOGLE_CLIENT_ID && environmentVariables.GOOGLE_CLIENT_SECRET
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
  };
}
