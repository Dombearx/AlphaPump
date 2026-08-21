/**
 * Wysyłka zgłoszenia zwrotnego — `POST /feedback`.
 *
 * Jedyny w aplikacji zapis, który idzie **wprost** na serwer, z pominięciem
 * bazy lokalnej i outboksu: zgłoszenie nie jest encją produktu (nie ma go po
 * co synchronizować ani trzymać offline), tylko jednorazową wiadomością.
 * Stąd też brak tu retry — nieudana wysyłka po prostu wraca błędem do ekranu,
 * tak jak zwykły formularz.
 *
 * Kształt błędów jest ten sam co przy synchronizacji i przy `remote/read-only`
 * — offline / sesja wygasła / serwer odpowiedział czymś nie do przyjęcia — bo
 * to ta sama rozmowa z tym samym API, tylko w jedną stronę zamiast w dwie.
 */

import { FEEDBACK_MESSAGE_MAX_LENGTH } from '@alphapump/core';
import type { AppLogEntry } from './app-log';
import { SyncAuthError, SyncOfflineError, SyncServerError } from './sync/transport';

export { FEEDBACK_MESSAGE_MAX_LENGTH };

const TIMEOUT_MS = 10_000;

/** `null` znaczy „można wysłać" — ten sam kształt co walidatory gdzie indziej w aplikacji. */
export function feedbackProblem(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return 'Write what happened before sending.';
  if (trimmed.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return `Keep it under ${String(FEEDBACK_MESSAGE_MAX_LENGTH)} characters.`;
  }
  return null;
}

export interface SubmitFeedbackOptions {
  baseUrl: string;
  cookie: () => string;
  message: string;
  logs: readonly AppLogEntry[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function submitFeedback(options: SubmitFeedbackOptions): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const call = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await call(`${options.baseUrl}/feedback`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', cookie: options.cookie() },
      body: JSON.stringify({ message: options.message.trim(), logs: options.logs }),
    });
  } catch (error) {
    // Brak trasy do hosta i nasz timeout znaczą to samo: jesteśmy poza VPN-em.
    throw new SyncOfflineError(error);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) throw new SyncAuthError();
  if (!response.ok) {
    throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
  }
}
