/**
 * Autoryzacja — better-auth spięty ze schematem z `@alphapump/db`.
 *
 * Cztery wymagania specyfikacji pokrywają się z pluginami niemal jeden do
 * jednego: e-mail z hasłem i Google są natywne, wiele tokenów API daje plugin
 * `apiKey`, a role użytkownik/administrator — plugin `admin`.
 *
 * Dwie rzeczy są ustawione świadomie wbrew domyślnym:
 *
 * - **`useSecureCookies: false`.** API działa po HTTP wewnątrz VPN, a ciasteczko
 *   z flagą `Secure` nigdy by po HTTP nie dojechało. Szyfrowanie i wzajemne
 *   uwierzytelnienie peerów zapewnia WireGuard pod spodem.
 * - **`requireEmailVerification: false`.** Potwierdzanie adresu nie jest
 *   wymaganiem, a reset hasła przez e-mail jest poza zakresem MVP — serwer nie
 *   ma więc czym wysłać wiadomości i nie udaje, że ma.
 *
 * Identyfikatory kont są UUIDv7, a nie domyślnymi napisami better-auth, bo
 * `users.id` wchodzi do klucza deterministycznego identyfikatora ćwiczenia.
 */

import { apiKey } from '@better-auth/api-key';
import { expo } from '@better-auth/expo';
import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { admin, bearer } from 'better-auth/plugins';
import { v7 as uuidv7 } from 'uuid';
import { accounts, apiKeys, rateLimits, sessions, users, verifications } from '@alphapump/db/pg';
import type { AppConfig } from './config.js';
import type { Database } from './db.js';

/**
 * Nick jest wymagany — to jedyna dana osobowa wychodząca na zewnątrz przy
 * rekordach globalnych. Rejestracja e-mailem go nie podaje, więc wyprowadzamy
 * go z nazwy konta, a w ostateczności z części adresu przed małpą.
 */
export function deriveNickname(input: { name?: string | null; email: string }): string {
  const fromName = input.name?.trim();
  if (fromName) return fromName.slice(0, 40);
  return (input.email.split('@')[0] ?? input.email).slice(0, 40);
}

export function createAuth(db: Database, config: AppConfig) {
  return betterAuth({
    appName: 'AlphaPump',
    secret: config.authSecret,
    baseURL: config.baseUrl,
    basePath: '/api/auth',
    trustedOrigins: config.trustedOrigins,

    database: drizzleAdapter(db, {
      provider: 'pg',
      schema: {
        user: users,
        session: sessions,
        account: accounts,
        verification: verifications,
        apikey: apiKeys,
        rateLimit: rateLimits,
      },
    }),

    advanced: {
      database: { generateId: () => uuidv7() },
      useSecureCookies: false,
      defaultCookieAttributes: { secure: false, sameSite: 'lax' },
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      autoSignIn: true,
      minPasswordLength: 8,
    },

    /**
     * Limit żądań do `/api/auth/*`, ustawiony jawnie zamiast domyślnego.
     *
     * Domyślny działa wyłącznie w produkcji i liczy w pamięci procesu — czyli
     * zeruje się przy każdym wdrożeniu, a wdrożenie idzie z każdym wejściem na
     * `main`. Licznik w bazie przeżywa restart, więc okno jest oknem, a nie
     * „oknem do najbliższego wydania".
     *
     * Logowanie ma osobne, ostrzejsze okno: reszta tras autoryzacji to odczyt
     * sesji, wołany przy każdym uruchomieniu aplikacji, a zgadywanie hasła
     * potrzebuje wielu prób i to je ma powstrzymać.
     */
    rateLimit: {
      enabled: true,
      storage: 'database',
      window: 60,
      max: 60,
      customRules: {
        '/sign-in/email': { window: 60, max: 10 },
        '/sign-up/email': { window: 3600, max: 10 },
      },
    },

    socialProviders: config.google
      ? {
          google: {
            clientId: config.google.clientId,
            clientSecret: config.google.clientSecret,
          },
        }
      : {},

    user: {
      additionalFields: {
        /**
         * `required: false` dotyczy **wejścia**, nie bazy. Rejestracja e-mailem
         * nie pyta o nick, więc wymaganie go od klienta odrzuciłoby każde
         * założenie konta; wypełnia go hook poniżej, a gwarancją niepustości
         * jest `NOT NULL` na kolumnie.
         */
        nickname: { type: 'string', required: false, input: false },
      },
    },

    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({
            data: { ...user, nickname: deriveNickname(user) },
          }),
        },
      },
    },

    plugins: [
      /**
       * Sesja w nagłówku `Authorization: Bearer …`, nie tylko w ciasteczku.
       * Ciasteczko z flagą `Secure` nie dojechałoby po HTTP wewnątrz VPN,
       * a telefon i tak trzyma token w bezpiecznym magazynie systemowym.
       */
      bearer(),
      /**
       * Domyślny limit pluginu to 10 żądań na dobę — dla bota logującego serie
       * oznaczałby, że przestaje działać po dziesiątej serii. Ustawiamy limit
       * na minutę: chroni przed pętlą w skrypcie, nie przeszkadza w pracy.
       */
      apiKey({ rateLimit: { enabled: true, timeWindow: 60_000, maxRequests: 120 } }),
      admin({ defaultRole: 'user', adminRoles: ['admin'] }),
      /**
       * Obsługa sesji po stronie React Native: dopuszcza schemat deep linków
       * aplikacji jako zaufane pochodzenie i rozumie nagłówek, którym klient
       * Expo przedstawia swoje. Bez tego żądania z telefonu wyglądałyby dla
       * serwera jak przychodzące z nieznanego origina.
       */
      expo(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
