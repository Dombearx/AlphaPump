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
   * Wyłącznik logowania i rejestracji przez Google — odpowiednik
   * `GOOGLE_SIGN_IN_ENABLED` po stronie serwera i wyłączony tak samo domyślnie.
   *
   * Musi być osobnym polem, a nie wnioskiem z obecności `googleWebClientId`:
   * identyfikator klienta bywa ustawiony „na zapas", a wtedy przycisk pojawiłby
   * się w aplikacji, mimo że serwer metody nie przyjmuje. Rozjazd tych dwóch
   * stron kończy się przyciskiem, który wygląda normalnie i zawsze zwraca błąd.
   */
  googleSignInEnabled: z.stringbool().default(false),
  /**
   * Katalog z wydaniami na minipc — stąd bierze się `latest.json` i sam plik
   * `.apk`. Pominięty wylicza się z `apiUrl`, bo w praktyce zawsze jest to ten
   * sam host: Caddy oddaje `/alphapump/download` z woluminu obok API. Pole istnieje
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
        ? `${apiUrl}/alphapump/download`
        : trimTrailingSlash(parsed.data.updateBaseUrl),
  };
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Czy pokazać „Continue with Google".
 *
 * Dwa warunki, nie jeden: metoda ma być **włączona** i mieć czym działać.
 * Sam identyfikator klienta nie wystarcza, bo bywa ustawiony przed
 * uruchomieniem metody; sama flaga też nie, bo bez identyfikatora natywny
 * Sign-In nie ma jak poprosić Google o token.
 */
export function isGoogleSignInConfigured(config: AppConfig): boolean {
  return config.googleSignInEnabled && config.googleWebClientId !== null;
}
