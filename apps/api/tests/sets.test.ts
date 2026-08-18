/**
 * CRUD serii — dokładnie to, czego od API wymaga specyfikacja: „API z tokenem
 * pozwala wykonać CRUD serii".
 *
 * Cały przepływ jedzie **tokenem API**, a nie sesją, bo to jest ta droga,
 * z której korzysta bot Discord i to ona ma być potwierdzona.
 */

import { builtInExerciseId, tagId } from '@alphapump/core';
import type { WorkoutSet } from '@alphapump/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BENCH = builtInExerciseId('Flat barbell bench press');
let PLANK: string;
let RUN: string;

describe('serie', () => {
  let harness: Harness;
  let user: TestUser;
  let apiKey: Record<string, string>;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.signUp('serie@example.com');
    apiKey = { 'x-api-key': await harness.createApiKey(user) };

    // Baza domyślna nie ma wbudowanych ćwiczeń „masa ciała + czas" ani
    // „dystans + czas" — te dwa typy logowania testujemy na własnych.
    const plank = await harness.json<{ id: string }>('POST', '/exercises', {
      headers: user.headers,
      body: { name: 'Deska', loggingType: 'bodyweight_time', primaryTagId: tagId('abs') },
    });
    PLANK = plank.body.id;

    const run = await harness.json<{ id: string }>('POST', '/exercises', {
      headers: user.headers,
      body: { name: 'Bieganie', loggingType: 'distance_time', primaryTagId: tagId('quads') },
    });
    RUN = run.body.id;
  });

  afterAll(async () => {
    await harness.close();
  });

  it('przechodzi pełny CRUD tokenem API', async () => {
    const created = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: BENCH,
        performedOn: '2026-08-10',
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        note: 'czuło się lekko',
      },
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ weightG: 80_000, reps: 8, position: 0 });

    const read = await harness.json<WorkoutSet>('GET', `/sets/${created.body.id}`, {
      headers: apiKey,
    });
    expect(read.status).toBe(200);
    expect(read.body.id).toBe(created.body.id);

    const updated = await harness.json<WorkoutSet>('PATCH', `/sets/${created.body.id}`, {
      headers: apiKey,
      body: { reps: 10 },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.reps).toBe(10);
    expect(updated.body.weightG).toBe(80_000);

    const removed = await harness.request(`/sets/${created.body.id}`, {
      method: 'DELETE',
      headers: apiKey,
    });
    expect(removed.status).toBe(204);

    const afterDelete = await harness.json('GET', `/sets/${created.body.id}`, { headers: apiKey });
    expect(afterDelete.status).toBe(404);
  });

  it('usuwa miękko — wiersz zostaje z tombstonem', async () => {
    const created = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: BENCH,
        performedOn: '2026-07-01',
        weightG: 60_000,
        reps: 5,
        durationS: null,
        distanceM: null,
      },
    });
    await harness.request(`/sets/${created.body.id}`, { method: 'DELETE', headers: apiKey });

    const { workoutSets } = await import('../src/schema.js');
    const { eq } = await import('drizzle-orm');
    const [row] = await harness.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.id, created.body.id));

    // Bez tombstone'a usunięcie wykonane na jednym urządzeniu nie miałoby jak
    // dojechać na drugie — zniknięcie wiersza jest nieodróżnialne od braku.
    expect(row?.deletedAt).toBeInstanceOf(Date);
  });

  it('nadaje kolejne pozycje w obrębie dnia i ćwiczenia', async () => {
    const body = {
      exerciseId: BENCH,
      performedOn: '2026-06-01',
      weightG: 70_000,
      reps: 6,
      durationS: null,
      distanceM: null,
    };
    const first = await harness.json<WorkoutSet>('POST', '/sets', { headers: apiKey, body });
    const second = await harness.json<WorkoutSet>('POST', '/sets', { headers: apiKey, body });

    expect(first.body.position).toBe(0);
    expect(second.body.position).toBe(1);
  });

  it('przyjmuje identyfikator nadany na telefonie i nie duplikuje przy powtórce', async () => {
    const id = '0198f0a0-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
    const body = {
      id,
      exerciseId: BENCH,
      performedOn: '2026-05-01',
      weightG: 50_000,
      reps: 12,
      durationS: null,
      distanceM: null,
    };

    const first = await harness.json<WorkoutSet>('POST', '/sets', { headers: apiKey, body });
    expect(first.status).toBe(201);
    expect(first.body.id).toBe(id);

    // Powtórzone wysłanie po zerwanym połączeniu to ta sama seria, nie nowa.
    const again = await harness.json<WorkoutSet>('POST', '/sets', { headers: apiKey, body });
    expect(again.status).toBe(200);
    expect(again.body.id).toBe(id);

    const list = await harness.json<WorkoutSet[]>('GET', '/sets?from=2026-05-01&to=2026-05-01', {
      headers: apiKey,
    });
    expect(list.body).toHaveLength(1);
  });

  it('odrzuca pomiary niepasujące do typu logowania ćwiczenia', async () => {
    // Deska to „masa ciała + czas" — ciężar i powtórzenia w niej nie istnieją.
    const response = await harness.json<{ error: { code: string } }>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: PLANK,
        performedOn: '2026-08-10',
        weightG: 20_000,
        reps: 10,
        durationS: null,
        distanceM: null,
      },
    });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('bad_request');
  });

  it('przyjmuje serię dystansową dla ćwiczenia dystansowego', async () => {
    const response = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: RUN,
        performedOn: '2026-08-09',
        weightG: null,
        reps: null,
        durationS: 1_800,
        distanceM: 5_000,
      },
    });
    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({ distanceM: 5_000, durationS: 1_800 });
  });

  it('waliduje stan po scaleniu, a nie samą łatkę', async () => {
    const created = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: RUN,
        performedOn: '2026-04-01',
        weightG: null,
        reps: null,
        durationS: 600,
        distanceM: 2_000,
      },
    });

    // Sama zmiana ćwiczenia na siłowe jest poprawna jako pole, ale w połączeniu
    // z dystansem daje zestaw, którego typ logowania nie zna.
    const response = await harness.json<{ error: { code: string } }>(
      'PATCH',
      `/sets/${created.body.id}`,
      { headers: apiKey, body: { exerciseId: BENCH } },
    );
    expect(response.status).toBe(400);
  });

  it('filtruje po zakresie dat i ćwiczeniu', async () => {
    const days = ['2026-03-01', '2026-03-05', '2026-03-10'];
    for (const performedOn of days) {
      await harness.json('POST', '/sets', {
        headers: apiKey,
        body: {
          exerciseId: BENCH,
          performedOn,
          weightG: 40_000,
          reps: 10,
          durationS: null,
          distanceM: null,
        },
      });
    }

    const range = await harness.json<WorkoutSet[]>(
      'GET',
      `/sets?from=2026-03-01&to=2026-03-05&exerciseId=${BENCH}`,
      { headers: apiKey },
    );
    expect(range.body.map((set) => set.performedOn)).toEqual(['2026-03-01', '2026-03-05']);
  });

  it('nie pokazuje serii innego użytkownika', async () => {
    const created = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: BENCH,
        performedOn: '2026-02-01',
        weightG: 100_000,
        reps: 1,
        durationS: null,
        distanceM: null,
      },
    });

    const intruder = await harness.signUp('ciekawski@example.com');
    const read = await harness.json('GET', `/sets/${created.body.id}`, {
      headers: intruder.headers,
    });
    expect(read.status).toBe(404);

    // Także administrator nie zagląda w cudzą historię — serie są prywatne.
    const nosyAdmin = await harness.signUp('admin-serie@example.com');
    await harness.promoteToAdmin(nosyAdmin);
    const adminRead = await harness.json('GET', `/sets/${created.body.id}`, {
      headers: nosyAdmin.headers,
    });
    expect(adminRead.status).toBe(404);
  });

  it('odmawia zapisu do nieistniejącego ćwiczenia', async () => {
    const response = await harness.json<{ error: { code: string } }>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: '0198f0a0-1c2d-7e3f-8a9b-000000000000',
        performedOn: '2026-01-01',
        weightG: 10_000,
        reps: 10,
        durationS: null,
        distanceM: null,
      },
    });
    expect(response.status).toBe(404);
  });

  it('zapisuje serię historyczną tak samo jak dzisiejszą', async () => {
    const response = await harness.json<WorkoutSet>('POST', '/sets', {
      headers: apiKey,
      body: {
        exerciseId: BENCH,
        performedOn: '2019-01-15',
        weightG: 55_000,
        reps: 7,
        durationS: null,
        distanceM: null,
      },
    });
    expect(response.status).toBe(201);
    expect(response.body.performedOn).toBe('2019-01-15');
  });
});
