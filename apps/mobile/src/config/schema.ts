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
  message: 'Adres API musi zaczynać się od http:// albo https://',
});

export const appConfigSchema = z.object({
  /** Adres API wewnątrz VPN — bez końcowego ukośnika. */
  apiUrl: httpUrlSchema,
  /**
   * Identyfikatory klienta Google. Puste znaczy „logowanie Google wyłączone" —
   * e-mail z hasłem działa dalej, bo brak jednej metody nie może zablokować
   * uruchomienia aplikacji.
   */
  googleWebClientId: z.string().min(1).nullable().default(null),
  googleIosClientId: z.string().min(1).nullable().default(null),
});

export type AppConfig = z.infer<typeof appConfigSchema>;

export function parseAppConfig(extra: unknown): AppConfig {
  const parsed = appConfigSchema.safeParse(extra);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('\n  ');
    throw new Error(`Niepoprawna konfiguracja aplikacji:\n  ${problems}`);
  }
  return { ...parsed.data, apiUrl: parsed.data.apiUrl.replace(/\/+$/, '') };
}

/** Czy logowanie przez Google jest skonfigurowane na tej platformie. */
export function isGoogleSignInConfigured(config: AppConfig): boolean {
  return config.googleWebClientId !== null;
}
