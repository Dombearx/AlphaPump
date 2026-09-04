/**
 * Wysyłka zgłoszenia zwrotnego.
 *
 * Ten sam kształt testów co `remote-read.test.ts`, bo to ta sama rozmowa
 * z API: sesja dochodzi z żądaniem, brak łączności jest `SyncOfflineError`
 * (nie błędem), a 401/403 to `SyncAuthError`. Walidacja tekstu jest sprawdzana
 * osobno — czysta funkcja, bez sieci.
 */

import { syncRejections, type SyncRejectionRow } from '@alphapump/db/sqlite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearLogs, recordLog } from '../src/app-log';
import { FEEDBACK_LOG_LIMIT } from '@alphapump/core';
import {
  feedbackLogs,
  feedbackProblem,
  syncReportEntries,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  submitFeedback,
} from '../src/feedback';
import { enqueue } from '../src/sync/outbox';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../src/sync/transport';
import { createLocalDatabase, type LocalDatabase } from './local-database';

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

/**
 * Stan synchronizacji doklejany do zgłoszenia.
 *
 * Powód, dla którego to w ogóle istnieje, jest jednym zgłoszeniem: „nie
 * znalazłem ćwiczenia na twojej liście", przysłanym z pustym logiem. Pierwsze
 * hipotezy dotyczyły synchronizacji i nie było czym ich rozstrzygnąć — a wiersz
 * odrzucony przez regułę serwera nie naprawi się sam ani od czekania, ani od
 * kolejnej wymiany.
 */
describe('diagnostyka synchronizacji w zgłoszeniu', () => {
  const stuck = (patch: Partial<SyncRejectionRow> = {}): SyncRejectionRow => ({
    entity: 'exercise',
    rowId: '4699be01-2289-58eb-934c-33a91eb4f23b',
    reason: 'name_taken',
    reasonDetail: null,
    attempts: 5,
    rejectedAt: new Date('2026-08-15T09:00:00.000Z'),
    retryAfter: new Date('2026-08-16T09:00:00.000Z'),
    ...patch,
  });

  const now = new Date('2026-08-15T10:00:00.000Z');

  it('opisuje wiersz, którego serwer nie przyjął — z powodem i liczbą prób', () => {
    const entries = syncReportEntries(
      {
        pending: 2,
        lastSyncedAt: new Date('2026-08-15T09:55:00.000Z'),
        lastError: null,
        stuck: [stuck()],
      },
      now,
    );

    expect(entries[0]).toMatchObject({ level: 'warn' });
    expect(entries[0]?.message).toContain('2 change(s) queued');
    expect(entries[0]?.message).toContain('1 row(s) rejected by the server');

    expect(entries[1]).toMatchObject({ level: 'error', at: '2026-08-15T09:00:00.000Z' });
    expect(entries[1]?.message).toContain('exercise 4699be01-2289-58eb-934c-33a91eb4f23b');
    expect(entries[1]?.message).toContain('[name_taken]');
    expect(entries[1]?.message).toContain('5 attempt(s)');
  });

  it('bez odrzuceń zostaje jedno zdanie o stanie, a nie cisza', () => {
    const entries = syncReportEntries(
      { pending: 0, lastSyncedAt: null, lastError: null, stuck: [] },
      now,
    );

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ level: 'log' });
    expect(entries[0]?.message).toContain('no rows rejected by the server');
    expect(entries[0]?.message).toContain("This device hasn't synced yet.");
  });

  it('opisuje najwyżej pięć wierszy z osobna, ale liczy wszystkie', () => {
    const rows = Array.from({ length: 9 }, (_, index) => stuck({ rowId: `row-${String(index)}` }));
    const entries = syncReportEntries(
      { pending: 0, lastSyncedAt: null, lastError: null, stuck: rows },
      now,
    );

    expect(entries).toHaveLength(6);
    expect(entries[0]?.message).toContain('9 row(s) rejected by the server');
  });

  describe('czytane z bazy lokalnej', () => {
    let local: LocalDatabase;

    beforeEach(async () => {
      local = await createLocalDatabase();
      clearLogs();
    });

    afterEach(() => {
      local.close();
      clearLogs();
    });

    it('składa diagnostykę z kolejki, kwarantanny i bufora logów', async () => {
      await enqueue(local.db, 'set', 'zestaw-1', now);
      await local.db.insert(syncRejections).values(stuck());
      recordLog('error', ['TypeError: x']);

      const logs = await feedbackLogs(local.db, now);

      expect(logs[0]?.message).toContain('1 change(s) queued');
      expect(logs[1]?.message).toContain('[name_taken]');
      expect(logs.at(-1)?.message).toContain('TypeError: x');
    });

    it('mieści się w limicie, który przyjmuje serwer — kosztem bufora, nie diagnostyki', async () => {
      await local.db.insert(syncRejections).values(stuck());
      for (let index = 0; index < 40; index += 1) recordLog('log', [`wpis ${String(index)}`]);

      const logs = await feedbackLogs(local.db, now);

      expect(logs).toHaveLength(FEEDBACK_LOG_LIMIT);
      expect(logs[1]?.message).toContain('[name_taken]');
      // Bufor ucięty od początku: ostatnie wpisy są tymi, które opisują to, co
      // wydarzyło się przed naciśnięciem „Send feedback".
      expect(logs.at(-1)?.message).toContain('wpis 39');
    });
  });
});
