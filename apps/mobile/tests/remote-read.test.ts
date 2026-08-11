/**
 * Odczyt rekordów globalnych i rankingów.
 *
 * Warstwa jest cienka, ale przechodzi przez nią jedyna w aplikacji ścieżka,
 * która czeka na sieć — więc sprawdzamy dokładnie to, co decyduje o tym, jak
 * ekran się zachowa: że odpowiedź jest walidowana schematem z rdzenia, że brak
 * łączności to `SyncOfflineError` (spokojne „offline"), a nie błąd, i że sesja
 * jedzie z żądaniem.
 */

import { describe, expect, it, vi } from 'vitest';
import { createRemoteReader } from '../src/remote/read-only';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../src/sync/transport';

const EXERCISE = '00000000-0000-7000-8000-000000000001';
const USER = '00000000-0000-7000-8000-00000000000a';

const RECORD = {
  nickname: 'ania',
  performedOn: '2026-08-10',
  note: null,
  weightG: 100_000,
  reps: 5,
  durationS: null,
  distanceM: null,
};

const reader = (fetchImpl: typeof fetch) =>
  createRemoteReader({
    baseUrl: 'http://api.test',
    cookie: () => 'sesja=abc',
    fetchImpl,
  });

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('rekordy globalne', () => {
  it('czyta front ćwiczenia i przepuszcza go przez schemat rdzenia', async () => {
    const fetchImpl = respond({ exerciseId: EXERCISE, records: [RECORD] });

    const records = await reader(fetchImpl).globalRecords(EXERCISE);

    expect(records).toEqual([RECORD]);
    expect(fetchImpl).toHaveBeenCalledWith(
      `http://api.test/exercises/${EXERCISE}/records`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('dokłada sesję do żądania', async () => {
    const fetchImpl = respond({ exerciseId: EXERCISE, records: [] });
    await reader(fetchImpl).globalRecords(EXERCISE);

    const init = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>).cookie).toBe('sesja=abc');
  });

  it('odrzuca odpowiedź o nieznanym kształcie zamiast jej pokazać', async () => {
    const fetchImpl = respond({ records: [{ nickname: 'ania' }] });

    await expect(reader(fetchImpl).globalRecords(EXERCISE)).rejects.toBeInstanceOf(SyncServerError);
  });
});

describe('ranking', () => {
  it('czyta wpisy wybranej metryki', async () => {
    const fetchImpl = respond({
      metric: 'volume',
      entries: [{ userId: USER, nickname: 'ania', value: 640_000, position: 1 }],
    });

    const entries = await reader(fetchImpl).ranking('volume');

    expect(entries).toEqual([{ userId: USER, nickname: 'ania', value: 640_000, position: 1 }]);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/rankings?metric=volume',
      expect.anything(),
    );
  });
});

describe('sytuacje bez odpowiedzi', () => {
  it('brak trasy do serwera znaczy offline, a nie błąd', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;

    await expect(reader(fetchImpl).ranking('volume')).rejects.toBeInstanceOf(SyncOfflineError);
  });

  it('wygasła sesja jest osobnym przypadkiem', async () => {
    const fetchImpl = respond({ error: 'unauthorized' }, 401);

    await expect(reader(fetchImpl).ranking('volume')).rejects.toBeInstanceOf(SyncAuthError);
  });

  it('błąd serwera nie udaje offline', async () => {
    const fetchImpl = respond({ error: 'internal' }, 500);

    await expect(reader(fetchImpl).ranking('records')).rejects.toBeInstanceOf(SyncServerError);
  });
});
