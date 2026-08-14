/**
 * Wysyłka zgłoszenia zwrotnego.
 *
 * Ten sam kształt testów co `remote-read.test.ts`, bo to ta sama rozmowa
 * z API: sesja dochodzi z żądaniem, brak łączności jest `SyncOfflineError`
 * (nie błędem), a 401/403 to `SyncAuthError`. Walidacja tekstu jest sprawdzana
 * osobno — czysta funkcja, bez sieci.
 */

import { describe, expect, it, vi } from 'vitest';
import { feedbackProblem, FEEDBACK_MESSAGE_MAX_LENGTH, submitFeedback } from '../src/feedback';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../src/sync/transport';

const respond = (status: number, body: unknown = { ok: true }) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

const send = (fetchImpl: typeof fetch, message = 'Wykres nie pokazuje wartości.') =>
  submitFeedback({
    baseUrl: 'http://api.test',
    cookie: () => 'sesja=abc',
    message,
    logs: [{ level: 'error', message: 'TypeError: x', at: '2026-08-15T10:00:00.000Z' }],
    fetchImpl,
  });

describe('walidacja tekstu', () => {
  it('wymaga niepustej treści', () => {
    expect(feedbackProblem('   ')).not.toBeNull();
    expect(feedbackProblem('coś się popsuło')).toBeNull();
  });

  it('ogranicza długość', () => {
    expect(feedbackProblem('a'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH))).toBeNull();
    expect(feedbackProblem('a'.repeat(FEEDBACK_MESSAGE_MAX_LENGTH + 1))).not.toBeNull();
  });
});

describe('wysyłka', () => {
  it('woła POST /feedback z treścią, logami i ciasteczkiem sesji', async () => {
    const fetchImpl = respond(201);
    await send(fetchImpl);

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/feedback',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      headers: Record<string, string>;
      body: string;
    };
    expect(init.headers.cookie).toBe('sesja=abc');
    expect(JSON.parse(init.body)).toEqual({
      message: 'Wykres nie pokazuje wartości.',
      logs: [{ level: 'error', message: 'TypeError: x', at: '2026-08-15T10:00:00.000Z' }],
    });
  });

  it('przycina białe znaki z brzegów przed wysyłką', async () => {
    const fetchImpl = respond(201);
    await send(fetchImpl, '  ze spacjami  ');

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      body: string;
    };
    expect((JSON.parse(init.body) as { message: string }).message).toBe('ze spacjami');
  });

  it('brak trasy do serwera znaczy offline, a nie błąd', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(send(fetchImpl)).rejects.toBeInstanceOf(SyncOfflineError);
  });

  it('401/403 znaczy wygasłą sesję', async () => {
    await expect(send(respond(401))).rejects.toBeInstanceOf(SyncAuthError);
    await expect(send(respond(403))).rejects.toBeInstanceOf(SyncAuthError);
  });

  it('inny kod błędu znaczy awarię serwera', async () => {
    await expect(send(respond(500))).rejects.toBeInstanceOf(SyncServerError);
  });
});
