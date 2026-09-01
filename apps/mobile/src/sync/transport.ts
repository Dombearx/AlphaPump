/**
 * Rozmowa z `/sync/push` i `/sync/pull`.
 *
 * Warstwa jest cienka celowo: wszystko, co potrafi, to zamienić wyjątek albo kod
 * odpowiedzi na jedną z trzech sytuacji, które aplikacja **umie różnie pokazać**.
 *
 * | Sytuacja                          | Klasa błędu        | Co widzi użytkownik   |
 * | --------------------------------- | ------------------ | --------------------- |
 * | serwer nieosiągalny, timeout      | `SyncOfflineError` | spokojne „offline"    |
 * | 401 / 403                         | `SyncAuthError`    | prośba o zalogowanie  |
 * | 4xx / 5xx, odpowiedź nie do czytania | `SyncServerError` | „błąd synchronizacji" |
 *
 * Rozróżnienie pierwszego wiersza jest wymaganiem produktu, a nie kosmetyką:
 * synchronizacja działa wewnątrz NetBirda, więc telefon **z pełnym zasięgiem
 * LTE** bywa poza VPN-em i nie ma jak dosięgnąć API. Systemowy stan sieci
 * powiedziałby wtedy „połączony" i nie ma o tym pojęcia — jedynym uczciwym
 * testem osiągalności serwera jest próba dobicia się do niego. Dlatego brak
 * odpowiedzi to „offline", a nie „błąd".
 *
 * Odpowiedzi przechodzą przez schematy Zod z `@alphapump/core`. To ten sam opis,
 * którym serwer waliduje własne wyjście — paczka, która mu nie odpowiada, nie
 * ma prawa dotknąć bazy lokalnej.
 */

import {
  syncPullResponseSchema,
  syncPushResponseSchema,
  SYNC_PULL_LIMIT,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
} from '@alphapump/core';
import { describeShapeMismatch } from './shape';

/** Serwera nie da się dosięgnąć. Nie jest to błąd — to normalny stan pracy. */
export class SyncOfflineError extends Error {
  constructor(cause?: unknown) {
    super('The server is unreachable');
    this.name = 'SyncOfflineError';
    this.cause = cause;
  }
}

/** Sesja wygasła albo konto straciło dostęp. */
export class SyncAuthError extends Error {
  constructor() {
    super('The session expired — sign in again');
    this.name = 'SyncAuthError';
  }
}

/** Serwer odpowiedział, ale nie tak, jak umiemy przeczytać. */
export class SyncServerError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
    this.name = 'SyncServerError';
  }
}

export interface SyncTransport {
  push(request: SyncPushRequest): Promise<SyncPushResponse>;
  pull(since: number, limit?: number): Promise<SyncPullResponse>;
}

export interface HttpTransportOptions {
  /** Adres API bez końcowego ukośnika. */
  baseUrl: string;
  /**
   * Ciasteczko sesji better-auth. Funkcja, a nie wartość, bo sesja zmienia się
   * przy wylogowaniu i odświeżeniu tokenu, a transport żyje dłużej niż jedna.
   */
  cookie: () => string;
  /** Po tylu milisekundach bez odpowiedzi uznajemy serwer za nieosiągalny. */
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

const DEFAULT_TIMEOUT_MS = 15_000;

export function createHttpTransport(options: HttpTransportOptions): SyncTransport {
  const request = async (path: string, init: RequestInit): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    const call = options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await call(`${options.baseUrl}${path}`, {
        ...init,
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          cookie: options.cookie(),
          ...init.headers,
        },
      });
    } catch (error) {
      // `fetch` rzuca zarówno przy braku trasy do hosta, jak i przy naszym
      // timeoucie. Jedno i drugie znaczy „nie dogadaliśmy się z serwerem".
      throw new SyncOfflineError(error);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) throw new SyncAuthError();

    if (!response.ok) {
      throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new SyncServerError(
        `Server response isn't valid JSON: ${String(error)}`,
        response.status,
      );
    }
  };

  return {
    async push(payload) {
      const body = await request('/sync/push', { method: 'POST', body: JSON.stringify(payload) });
      const parsed = syncPushResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new SyncServerError(
          `Push response has an unknown shape: ${describeShapeMismatch(body, parsed.error)}`,
        );
      }
      return parsed.data;
    },

    async pull(since, limit = SYNC_PULL_LIMIT) {
      const query = `?since=${String(since)}&limit=${String(limit)}`;
      const body = await request(`/sync/pull${query}`, { method: 'GET' });
      const parsed = syncPullResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new SyncServerError(
          `Pull response has an unknown shape: ${describeShapeMismatch(body, parsed.error)}`,
        );
      }
      return parsed.data;
    },
  };
}

/** Czy błąd oznacza „pracujemy dalej offline", a nie „coś jest zepsute". */
export function isOffline(error: unknown): boolean {
  return error instanceof SyncOfflineError;
}
