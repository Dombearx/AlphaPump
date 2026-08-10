/**
 * Cykle — CRUD i prywatność.
 *
 * Zliczanie postępu nie jest tu testowane, bo API go nie liczy: postęp jest
 * daną pochodną, wyznaczaną z serii przez `computeCycleProgress` w rdzeniu.
 * Testy tej reguły siedzą w `packages/core`, gdzie mieszka algorytm.
 */

import { builtInExerciseId, tagId } from '@alphapump/core';
import type { Cycle } from '@alphapump/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BICEPS = tagId('Biceps');
const RUN = builtInExerciseId('Bieg');

describe('cykle', () => {
  let harness: Harness;
  let user: TestUser;
  let other: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    user = await harness.signUp('cykle@example.com');
    other = await harness.signUp('cudze-cykle@example.com');
  });

  afterAll(async () => {
    await harness.close();
  });

  const sampleCycle = {
    name: 'Sierpień na biceps',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    goals: [
      { metric: 'sets' as const, target: 12, exerciseId: null, tagId: BICEPS },
      { metric: 'distance' as const, target: 10_000, exerciseId: RUN, tagId: null },
    ],
  };

  it('tworzy cykl z wieloma pozycjami celu', async () => {
    const response = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    expect(response.status).toBe(201);
    expect(response.body.goals).toHaveLength(2);
    expect(response.body.goals.map((goal) => goal.metric)).toEqual(['sets', 'distance']);
    expect(response.body.archivedAt).toBeNull();
  });

  it('odrzuca pozycję celu wskazującą i ćwiczenie, i tag', async () => {
    const response = await harness.json<{ error: { code: string } }>('POST', '/cycles', {
      headers: user.headers,
      body: {
        ...sampleCycle,
        goals: [{ metric: 'sets', target: 5, exerciseId: RUN, tagId: BICEPS }],
      },
    });
    expect(response.status).toBe(400);
  });

  it('odrzuca pozycję celu bez żadnego zakresu', async () => {
    const response = await harness.json('POST', '/cycles', {
      headers: user.headers,
      body: {
        ...sampleCycle,
        goals: [{ metric: 'sets', target: 5, exerciseId: null, tagId: null }],
      },
    });
    expect(response.status).toBe(400);
  });

  it('odrzuca koniec cyklu wcześniejszy niż początek', async () => {
    const response = await harness.json('POST', '/cycles', {
      headers: user.headers,
      body: { ...sampleCycle, startsOn: '2026-08-31', endsOn: '2026-08-01' },
    });
    expect(response.status).toBe(400);
  });

  it('podmienia komplet pozycji przy edycji', async () => {
    const created = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    const updated = await harness.json<Cycle>('PATCH', `/cycles/${created.body.id}`, {
      headers: user.headers,
      body: { goals: [{ metric: 'sets', target: 20, exerciseId: null, tagId: BICEPS }] },
    });

    expect(updated.status).toBe(200);
    expect(updated.body.goals).toHaveLength(1);
    expect(updated.body.goals[0]?.target).toBe(20);
  });

  it('reset cyklu to przesunięcie daty początku', async () => {
    const created = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    const reset = await harness.json<Cycle>('PATCH', `/cycles/${created.body.id}`, {
      headers: user.headers,
      body: { startsOn: '2026-09-01', endsOn: '2026-09-30' },
    });

    expect(reset.body.startsOn).toBe('2026-09-01');
    // Historia zostaje w seriach, więc poprzednią realizację da się przeliczyć
    // w każdej chwili — reset niczego nie kasuje.
    expect(reset.body.id).toBe(created.body.id);
  });

  it('archiwizuje i przywraca cykl', async () => {
    const created = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    const archived = await harness.json<Cycle>('PATCH', `/cycles/${created.body.id}`, {
      headers: user.headers,
      body: { archived: true },
    });
    expect(archived.body.archivedAt).not.toBeNull();

    const active = await harness.json<Cycle[]>('GET', '/cycles', { headers: user.headers });
    expect(active.body.map((cycle) => cycle.id)).not.toContain(created.body.id);

    const all = await harness.json<Cycle[]>('GET', '/cycles?includeArchived=true', {
      headers: user.headers,
    });
    expect(all.body.map((cycle) => cycle.id)).toContain(created.body.id);

    const restored = await harness.json<Cycle>('PATCH', `/cycles/${created.body.id}`, {
      headers: user.headers,
      body: { archived: false },
    });
    expect(restored.body.archivedAt).toBeNull();
  });

  it('usuwa cykl miękko', async () => {
    const created = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    const removed = await harness.json('DELETE', `/cycles/${created.body.id}`, {
      headers: user.headers,
    });
    expect(removed.status).toBe(204);

    const read = await harness.json('GET', `/cycles/${created.body.id}`, {
      headers: user.headers,
    });
    expect(read.status).toBe(404);
  });

  it('nie pokazuje cykli innego użytkownika', async () => {
    const created = await harness.json<Cycle>('POST', '/cycles', {
      headers: user.headers,
      body: sampleCycle,
    });

    const read = await harness.json('GET', `/cycles/${created.body.id}`, {
      headers: other.headers,
    });
    expect(read.status).toBe(404);

    const list = await harness.json<Cycle[]>('GET', '/cycles', { headers: other.headers });
    expect(list.body).toHaveLength(0);
  });
});
