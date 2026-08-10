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
});

export interface GoogleCredentials {
  clientId: string;
  clientSecret: string;
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

  return {
    nodeEnv: environmentVariables.NODE_ENV,
    host: environmentVariables.HOST,
    port: environmentVariables.PORT,
    databaseUrl: environmentVariables.DATABASE_URL,
    authSecret: environmentVariables.BETTER_AUTH_SECRET,
    baseUrl: environmentVariables.BETTER_AUTH_URL,
    trustedOrigins: [environmentVariables.BETTER_AUTH_URL, ...trustedOrigins],
    google,
  };
}
