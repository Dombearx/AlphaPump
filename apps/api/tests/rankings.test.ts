/**
 * Rekordy globalne i rankingi — kryterium ukończenia etapu 11.
 *
 * Sprawdzane są trzy rzeczy, wszystkie wprost z planu:
 *
 * 1. Rankingi zgadzają się z **niezależnym przeliczeniem z surowych serii** —
 *    liczonym tutaj z odpowiedzi API o własnych seriach każdego konta, a nie
 *    z tego samego zapytania, które liczy ranking.
 * 2. Historia serii pozostaje niedostępna dla innych użytkowników — rekord
 *    globalny oddaje wyłącznie wartość, nick, datę i notatkę.
 * 3. Zapis serii przez `POST /sync/push` przelicza rekordy globalne dotkniętych
 *    ćwiczeń, czyli lista przeliczeń w `derived.ts` przestała być pusta.
 */

import {
  builtInExerciseId,
  newDeviceId,
  newSetId,
  setVolume,
  tagId,
  type GlobalRecordsResponse,
  type RankingResponse,
  type WorkoutSet,
} from '@alphapump/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BENCH = builtInExerciseId('Flat barbell bench press');
const SQUAT = builtInExerciseId('Barbell squat');
let RUN: string;

const DAY = '2026-08-10';

interface SetInput {
  exerciseId?: string;
  performedOn?: string;
  weightG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  distanceM?: number | null;
  note?: string | null;
}

const body = (input: SetInput) => ({
  exerciseId: input.exerciseId ?? BENCH,
  performedOn: input.performedOn ?? DAY,
  weightG: input.weightG ?? null,
  reps: input.reps ?? null,
  durationS: input.durationS ?? null,
  distanceM: input.distanceM ?? null,
  note: input.note ?? null,
});

describe('rekordy globalne i rankingi', () => {
  let harness: Harness;
  let ania: TestUser;
  let bartek: TestUser;

  /** Zapis serii zwykłym CRUD-em — tą drogą chodzi bot Discord. */
  const log = async (user: TestUser, input: SetInput) => {
    const response = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: user.headers,
      body: body(input),
    });
    expect(response.status).toBe(201);
    return response.body;
  };

  const records = async (user: TestUser, exerciseId: string) => {
    const response = await harness.json<GlobalRecordsResponse>(
      'GET',
      `/exercises/${exerciseId}/records`,
      { headers: user.headers },
    );
    expect(response.status).toBe(200);
    return response.body.records;
  };

  const ranking = async (user: TestUser, metric: string) => {
    const response = await harness.json<RankingResponse>('GET', `/rankings?metric=${metric}`, {
      headers: user.headers,
    });
    expect(response.status).toBe(200);
    return response.body.entries;
  };

  beforeEach(async () => {
    harness = await createHarness();
    ania = await harness.signUp('ania@example.com', 'haslo-testowe-123', 'ania');
    bartek = await harness.signUp('bartek@example.com', 'haslo-testowe-123', 'bartek');

    // Baza domyślna nie ma wbudowanego ćwiczenia „dystans + czas" — testujemy
    // na własnym.
    const run = await harness.json<{ id: string }>('POST', '/exercises', {
      headers: ania.headers,
      body: { name: 'Bieganie', loggingType: 'distance_time', primaryTagId: tagId('quads') },
    });
    RUN = run.body.id;
  });

  afterEach(async () => {
    await harness.close();
  });

  /* ---------------------------------------------------------- rekordy globalne */

  describe('rekordy globalne', () => {
    it('liczy front Pareto z serii wszystkich użytkowników', async () => {
      await log(ania, { weightG: 100_000, reps: 5 });
      await log(bartek, { weightG: 80_000, reps: 12 });
      // Zdominowana przez własną serię Ani — cięższa i na więcej powtórzeń.
      await log(ania, { weightG: 90_000, reps: 5 });

      const front = await records(ania, BENCH);

      expect(front).toHaveLength(2);
      expect(front.map((record) => record.nickname).sort()).toEqual(['ania', 'bartek'].sort());
      expect(front.map((record) => [record.weightG, record.reps])).toContainEqual([100_000, 5]);
      expect(front.map((record) => [record.weightG, record.reps])).toContainEqual([80_000, 12]);
    });

    it('oddaje wyłącznie wartość, nick, datę i notatkę', async () => {
      await log(ania, { weightG: 100_000, reps: 5, note: 'ostatnia siła' });

      const [record] = await records(bartek, BENCH);

      expect(record).toEqual({
        nickname: 'ania',
        performedOn: DAY,
        note: 'ostatnia siła',
        weightG: 100_000,
        reps: 5,
        durationS: null,
        distanceM: null,
      });
    });

    it('nie daje wejścia w cudzą historię serii', async () => {
      const cudza = await log(ania, { weightG: 100_000, reps: 5 });

      const single = await harness.json('GET', `/sets/${cudza.id}`, { headers: bartek.headers });
      const list = await harness.json<WorkoutSet[]>('GET', '/sets', { headers: bartek.headers });

      expect(single.status).toBe(404);
      expect(list.body).toEqual([]);
    });

    it('przelicza od zera po usunięciu serii — zdominowany rekord wraca', async () => {
      const mocniejsza = await log(ania, { weightG: 100_000, reps: 10 });
      await log(bartek, { weightG: 90_000, reps: 8 });

      expect(await records(ania, BENCH)).toHaveLength(1);

      await harness.request(`/sets/${mocniejsza.id}`, {
        method: 'DELETE',
        headers: ania.headers,
      });

      const front = await records(ania, BENCH);
      expect(front).toHaveLength(1);
      expect(front[0]?.nickname).toBe('bartek');
    });

    it('rusza rekordy po obu stronach przeniesienia serii między ćwiczeniami', async () => {
      const seria = await log(ania, { weightG: 100_000, reps: 5 });

      await harness.json('PATCH', `/sets/${seria.id}`, {
        headers: ania.headers,
        body: { exerciseId: SQUAT },
      });

      expect(await records(ania, BENCH)).toHaveLength(0);
      expect(await records(ania, SQUAT)).toHaveLength(1);
    });

    it('odmawia dla nieistniejącego ćwiczenia', async () => {
      const response = await harness.json(
        'GET',
        '/exercises/00000000-0000-7000-8000-000000000999/records',
        { headers: ania.headers },
      );
      expect(response.status).toBe(404);
    });
  });

  /* ------------------------------------------------- przeliczanie po synchronizacji */

  describe('zapis przez synchronizację', () => {
    it('przelicza rekordy globalne dotkniętych ćwiczeń', async () => {
      const deviceId = newDeviceId();
      const stamp = '2026-08-10T08:00:00.000Z';

      const push = await harness.json('POST', '/sync/push', {
        headers: ania.headers,
        body: {
          deviceId,
          sets: [
            {
              id: newSetId(),
              exerciseId: BENCH,
              performedOn: DAY,
              position: 0,
              weightG: 120_000,
              reps: 3,
              durationS: null,
              distanceM: null,
              bodyweightG: null,
              note: null,
              createdAt: stamp,
              updatedAt: stamp,
              deletedAt: null,
            },
          ],
        },
      });
      expect(push.status).toBe(200);

      const front = await records(bartek, BENCH);
      expect(front).toEqual([
        expect.objectContaining({ nickname: 'ania', weightG: 120_000, reps: 3 }),
      ]);
    });
  });

  /* ------------------------------------------------------------------ rankingi */

  describe('rankingi', () => {
    /** Suma objętości policzona z surowych serii konta — niezależnie od rankingu. */
    const ownVolume = async (user: TestUser) => {
      const { body: sets } = await harness.json<WorkoutSet[]>('GET', '/sets', {
        headers: user.headers,
      });
      return sets.reduce((sum, set) => sum + setVolume(set), 0);
    };

    beforeEach(async () => {
      await log(ania, { weightG: 100_000, reps: 5 });
      await log(ania, { weightG: 80_000, reps: 10 });
      await log(bartek, { weightG: 60_000, reps: 10 });
      await log(ania, { exerciseId: RUN, distanceM: 5000, durationS: 1500 });
      await log(bartek, { exerciseId: RUN, distanceM: 12_000, durationS: 3900 });
    });

    it('objętość zgadza się z niezależnym przeliczeniem z surowych serii', async () => {
      const entries = await ranking(ania, 'volume');

      expect(entries.map((entry) => entry.nickname)).toEqual(['ania', 'bartek']);
      expect(entries[0]?.value).toBe(await ownVolume(ania));
      expect(entries[1]?.value).toBe(await ownVolume(bartek));
      expect(entries.map((entry) => entry.position)).toEqual([1, 2]);
    });

    it('dystans liczy sumę metrów wszystkich biegów', async () => {
      const entries = await ranking(ania, 'distance');

      expect(entries).toEqual([
        expect.objectContaining({ nickname: 'bartek', value: 12_000, position: 1 }),
        expect.objectContaining({ nickname: 'ania', value: 5000, position: 2 }),
      ]);
    });

    it('liczba rekordów zgadza się z frontami ćwiczeń', async () => {
      const entries = await ranking(ania, 'records');
      const posiadane = new Map(entries.map((entry) => [entry.nickname, entry.value]));

      const front = [...(await records(ania, BENCH)), ...(await records(ania, RUN))];
      for (const [nickname, value] of posiadane) {
        expect(front.filter((record) => record.nickname === nickname)).toHaveLength(value);
      }
      expect([...posiadane.values()].reduce((sum, value) => sum + value, 0)).toBe(front.length);
    });

    it('nie pokazuje kont bez wyniku w danej konkurencji', async () => {
      const niebiegajacy = await harness.signUp(
        'celina@example.com',
        'haslo-testowe-123',
        'celina',
      );
      await log(niebiegajacy, { weightG: 50_000, reps: 5 });

      const dystans = await ranking(ania, 'distance');
      const objetosc = await ranking(ania, 'volume');

      expect(dystans.map((entry) => entry.nickname)).not.toContain('celina');
      expect(objetosc.map((entry) => entry.nickname)).toContain('celina');
    });

    it('maleje po usunięciu serii', async () => {
      const przed = await ranking(ania, 'volume');
      const { body: sets } = await harness.json<WorkoutSet[]>('GET', '/sets?exerciseId=' + BENCH, {
        headers: ania.headers,
      });

      await harness.request(`/sets/${sets[0]?.id ?? ''}`, {
        method: 'DELETE',
        headers: ania.headers,
      });

      const po = await ranking(ania, 'volume');
      expect(po[0]?.value).toBeLessThan(przed[0]?.value ?? 0);
      expect(po[0]?.value).toBe(await ownVolume(ania));
    });

    it('odrzuca nieznaną metrykę', async () => {
      const response = await harness.json('GET', '/rankings?metric=przysiady', {
        headers: ania.headers,
      });
      expect(response.status).toBe(400);
    });
  });
});
