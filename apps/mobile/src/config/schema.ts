/**
 * Konfiguracja aplikacji przekazana przez `app.config.ts`.
 *
 * Walidujemy ją raz, przy starcie, a nie przy pierwszym żądaniu sieciowym.
 * Literówka w adresie API ma się objawić od razu czytelnym komunikatem, a nie
 * po zalogowaniu, jako „coś nie działa".
 *
 * Moduł jest czysty i nie importuje `expo-constants` — dzięki temu chodzi
 * w testach bez środowiska React Native.
 */

import { z } from 'zod';

/**
 * `z.url()` przepuszcza każdy poprawny URI, także `minipc:3000` — a taki adres
 * ani nie dojedzie do API, ani nie da się z niego wyliczyć wyjątku cleartext.
 */
const httpUrlSchema = z.url().regex(/^https?:\/\//i, {
  message: 'The API address must start with http:// or https://',
});

/**
 * Manifest klasycznego protokołu Expo Go serializuje `extra` tak, że `null`
 * dochodzi do klienta jako `{}` (pusty obiekt), nie `null` — stąd normalizacja
 * przed właściwą walidacją stringa.
 */
const nullableClientId = z.preprocess(
  (value) =>
    typeof value === 'object' && value !== null && Object.keys(value).length === 0 ? null : value,
  z.string().min(1).nullable().default(null),
);

export const appConfigSchema = z.object({
  /** Adres API wewnątrz VPN — bez końcowego ukośnika. */
  apiUrl: httpUrlSchema,
  /**
   * Identyfikatory klienta Google. Puste znaczy „logowanie Google wyłączone" —
   * e-mail z hasłem działa dalej, bo brak jednej metody nie może zablokować
   * uruchomienia aplikacji.
   */
  googleWebClientId: nullableClientId,
  googleIosClientId: nullableClientId,
  /**
   * Katalog z wydaniami na minipc — stąd bierze się `latest.json` i sam plik
   * `.apk`. Pominięty wylicza się z `apiUrl`, bo w praktyce zawsze jest to ten
   * sam host: Caddy oddaje `/pobierz` z woluminu obok API. Pole istnieje
   * wyłącznie po to, żeby dało się rozdzielić te dwie rzeczy bez przepisywania
   * kodu, gdyby wydania kiedyś pojechały gdzie indziej.
   */
  updateBaseUrl: httpUrlSchema.optional(),
});

/**
 * `updateBaseUrl` jest w schemacie opcjonalny, ale po `parseAppConfig` już nie:
 * pominięty wylicza się z `apiUrl`. Kod aplikacji nie ma więc gałęzi „a jeśli
 * nie ustawiono", bo nie ma takiego stanu.
 */
export type AppConfig = Omit<z.infer<typeof appConfigSchema>, 'updateBaseUrl'> & {
  updateBaseUrl: string;
};

export function parseAppConfig(extra: unknown): AppConfig {
  const parsed = appConfigSchema.safeParse(extra);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Invalid app configuration:\n  ${problems}`);
  }
  const apiUrl = trimTrailingSlash(parsed.data.apiUrl);
  return {
    ...parsed.data,
    apiUrl,
    updateBaseUrl:
      parsed.data.updateBaseUrl === undefined
        ? `${apiUrl}/pobierz`
        : trimTrailingSlash(parsed.data.updateBaseUrl),
  };
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/** Czy logowanie przez Google jest skonfigurowane na tej platformie. */
export function isGoogleSignInConfigured(config: AppConfig): boolean {
  return config.googleWebClientId !== null;
}
