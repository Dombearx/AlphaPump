/**
 * Konto po stronie serwera — stan hasła.
 *
 * Druga (po rekordach i rankingach) rzecz, której nie da się przeczytać
 * lokalnie, i z tego samego powodu: wie o niej wyłącznie serwer. Administrator
 * może kontu nadać hasło tymczasowe z panelu — poczty w stosie nie ma, więc
 * „przypomnij hasło" nie ma jak dojść do nikogo — a telefon dowiaduje się o tym
 * dopiero pytając `GET /me`.
 *
 * Warstwa jest osobno od `read-only.ts`, bo tamten jest **tylko do odczytu**
 * i ma taki zostać: tutaj jest zapis, i to zapis zmieniający poświadczenie.
 * Adres API i sesję moduł dostaje z zewnątrz, tak jak tamten — inaczej nie
 * dałoby się go sprawdzić poza urządzeniem.
 *
 * Brak sieci jest tu `SyncOfflineError`, czyli tym samym, czym w reszcie
 * aplikacji: telefon poza VPN-em nie ma jak sprawdzić stanu hasła, a to nie jest
 * awaria — to jest zwykły dzień aplikacji offline-first.
 */

import { z } from 'zod';
import { setOwnPasswordInputSchema, userSchema } from '@alphapump/core';
import { describeShapeMismatch } from '../sync/shape';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../sync/transport';

const TIMEOUT_MS = 10_000;

const accountSchema = userSchema.extend({
  credential: z.enum(['session', 'api-key']),
  /** Konto ma hasło nadane przez administratora i nie ustawiło jeszcze własnego. */
  mustChangePassword: z.boolean(),
});

export type Account = z.infer<typeof accountSchema>;

export interface AccountClientOptions {
  /** Adres API bez końcowego ukośnika. */
  baseUrl: string;
  /** Ciasteczko sesji; funkcja, bo sesja zmienia się częściej niż klient. */
  cookie: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface AccountClient {
  /** Stan konta widziany przez serwer — w tym flaga hasła tymczasowego. */
  me(): Promise<Account>;
  /**
   * Ustawia własne hasło konta, które ma hasło tymczasowe. Starego hasła nie
   * podajemy: zna je administrator, bo sam je nadał, więc pytanie o nie niczego
   * by nie dowiodło. Sesja, z której idzie żądanie, zostaje ważna.
   */
  setPassword(newPassword: string): Promise<void>;
}

export function createAccountClient(options: AccountClientOptions): AccountClient {
  const { baseUrl, cookie } = options;

  const call = async (path: string, init: RequestInit): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    const fetchImpl = options.fetchImpl ?? fetch;

    try {
      return await fetchImpl(`${baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: { 'content-type': 'application/json', cookie: cookie() },
      });
    } catch (error) {
      // Brak trasy do hosta i nasz timeout znaczą to samo: jesteśmy poza VPN-em.
      throw new SyncOfflineError(error);
    } finally {
      clearTimeout(timeout);
    }
  };

  return {
    async me() {
      const response = await call('/me', { method: 'GET' });
      if (response.status === 401 || response.status === 403) throw new SyncAuthError();
      if (!response.ok) {
        throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
      }

      const body: unknown = await response.json();
      const parsed = accountSchema.safeParse(body);
      if (!parsed.success) {
        throw new SyncServerError(
          `Account response has an unknown shape: ${describeShapeMismatch(body, parsed.error)}`,
        );
      }
      return parsed.data;
    },

    async setPassword(newPassword) {
      // Ten sam schemat, którym waliduje serwer: hasło za krótkie ma odpaść
      // przy formularzu, a nie po locie do API i z powrotem.
      const input = setOwnPasswordInputSchema.parse({ newPassword });

      const response = await call('/me/password', {
        method: 'POST',
        body: JSON.stringify(input),
      });
      if (response.status === 401 || response.status === 403) throw new SyncAuthError();
      if (!response.ok) {
        throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
      }
    },
  };
}
