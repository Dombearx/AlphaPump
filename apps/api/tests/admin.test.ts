/**
 * Endpointy panelu administracyjnego (etap 13).
 *
 * Kryterium ukończenia etapu brzmi: administrator wykonuje wszystkie operacje
 * z zakresu specyfikacji **bez sięgania do bazy**. Testy przechodzą więc kolejno
 * przez ten zakres — konta, ćwiczenia, tagi, wgląd w dane — i pilnują dwóch
 * blokad, które chronią administratora od siebie samego: nie da się zablokować
 * ani zdegradować własnego konta, a konta systemowego nie da się ruszyć w ogóle.
 */

import { SYSTEM_USER } from '@alphapump/db';
import type { AdminUser, FeedbackTriageReport, SystemStats } from '@alphapump/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { conflict } from '../src/errors.js';
import type { TriageClient } from '../src/triage.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

describe('panel administracyjny', () => {
  let harness: Harness;
  let admin: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    admin = await harness.signUp('admin@example.com', 'haslo-testowe-123', 'Szef');
    member = await harness.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
    await harness.promoteToAdmin(admin);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('lista kont jest zastrzeżona dla administratora', async () => {
    const denied = await harness.json('GET', '/admin/users', { headers: member.headers });
    expect(denied.status).toBe(403);
  });

  it('lista kont niesie blokadę i liczby, po których widać użycie konta', async () => {
    const response = await harness.json<{ users: AdminUser[] }>('GET', '/admin/users', {
      headers: admin.headers,
    });

    expect(response.status).toBe(200);
    const emails = response.body.users.map((user) => user.email);
    expect(emails).toEqual(expect.arrayContaining(['admin@example.com', 'kuba@example.com']));

    const kuba = response.body.users.find((user) => user.email === 'kuba@example.com');
    expect(kuba).toMatchObject({ role: 'user', banned: false, setCount: 0, exerciseCount: 0 });

    // Konto systemowe jest autorem całej biblioteki wbudowanej.
    const system = response.body.users.find((user) => user.id === SYSTEM_USER.id);
    expect(system?.exerciseCount).toBeGreaterThan(0);
  });

  it('administrator nadaje i odbiera rolę', async () => {
    const promoted = await harness.json<AdminUser>('PATCH', `/admin/users/${member.id}`, {
      body: { role: 'admin' },
      headers: admin.headers,
    });
    expect(promoted.body.role).toBe('admin');

    const demoted = await harness.json<AdminUser>('PATCH', `/admin/users/${member.id}`, {
      body: { role: 'user' },
      headers: admin.headers,
    });
    expect(demoted.body.role).toBe('user');
  });

  it('blokada zabiera dostęp do API, a jej zdjęcie oddaje', async () => {
    const banned = await harness.json<AdminUser>('PATCH', `/admin/users/${member.id}`, {
      body: { banned: true, banReason: 'nadużycia' },
      headers: admin.headers,
    });
    expect(banned.body).toMatchObject({ banned: true, banReason: 'nadużycia' });

    const blocked = await harness.json('GET', '/me', { headers: member.headers });
    expect(blocked.status).toBe(403);

    const unbanned = await harness.json<AdminUser>('PATCH', `/admin/users/${member.id}`, {
      body: { banned: false },
      headers: admin.headers,
    });
    // Powód blokady, której nie ma, byłby tylko śmieciem — znika razem z blokadą.
    expect(unbanned.body).toMatchObject({ banned: false, banReason: null });

    const allowed = await harness.json('GET', '/me', { headers: member.headers });
    expect(allowed.status).toBe(200);
  });

  it('zmienia nick, bo to on jest widoczny w rankingach', async () => {
    const response = await harness.json<AdminUser>('PATCH', `/admin/users/${member.id}`, {
      body: { nickname: 'Kubaa' },
      headers: admin.headers,
    });
    expect(response.body.nickname).toBe('Kubaa');
  });

  it('nie pozwala odciąć sobie drogi powrotu', async () => {
    const selfBan = await harness.json('PATCH', `/admin/users/${admin.id}`, {
      body: { banned: true },
      headers: admin.headers,
    });
    expect(selfBan.status).toBe(409);

    const selfDemote = await harness.json('PATCH', `/admin/users/${admin.id}`, {
      body: { role: 'user' },
      headers: admin.headers,
    });
    expect(selfDemote.status).toBe(409);
  });

  it('nie rusza konta systemowego', async () => {
    const response = await harness.json('PATCH', `/admin/users/${SYSTEM_USER.id}`, {
      body: { nickname: 'Cokolwiek' },
      headers: admin.headers,
    });
    expect(response.status).toBe(403);
  });

  it('odmawia zmiany konta, którego nie ma, i żądania bez zmian', async () => {
    const missing = await harness.json(
      'PATCH',
      '/admin/users/11111111-1111-4111-8111-111111111111',
      {
        body: { nickname: 'Nikt' },
        headers: admin.headers,
      },
    );
    expect(missing.status).toBe(404);

    const empty = await harness.json('PATCH', `/admin/users/${member.id}`, {
      body: {},
      headers: admin.headers,
    });
    expect(empty.status).toBe(400);
  });

  it('daje wgląd w dane systemowe bez sięgania do bazy', async () => {
    const tag = await harness.json<{ id: string }>('POST', '/tags', {
      body: { name: 'Back' },
      headers: admin.headers,
    });
    const exercise = await harness.json<{ id: string }>('POST', '/exercises', {
      body: { name: 'Deadlift', loggingType: 'weight_reps', primaryTagId: tag.body.id },
      headers: member.headers,
    });
    await harness.json('POST', '/sets', {
      body: {
        exerciseId: exercise.body.id,
        performedOn: '2026-08-10',
        weightG: 140_000,
        reps: 5,
        durationS: null,
        distanceM: null,
      },
      headers: member.headers,
    });

    const stats = await harness.json<SystemStats>('GET', '/admin/stats', {
      headers: admin.headers,
    });

    expect(stats.status).toBe(200);
    expect(stats.body.users.total).toBeGreaterThanOrEqual(3);
    expect(stats.body.users.admins).toBeGreaterThanOrEqual(1);
    expect(stats.body.library.builtInExercises).toBeGreaterThan(0);
    expect(stats.body.training).toMatchObject({ sets: 1, lastPerformedOn: '2026-08-10' });
    // Rekord globalny jest przeliczany po zapisie serii — cache, nie źródło prawdy.
    expect(stats.body.derived.globalRecords).toBe(1);
    // Warstwa semantyczna jest w tym teście wyłączona i panel ma to widzieć.
    expect(stats.body.duplicates).toMatchObject({
      semanticEnabled: false,
      rerankerEnabled: false,
      embeddings: 0,
    });
  });

  it('administrator zmienia i usuwa cudze ćwiczenie oraz tag — bez osobnych endpointów', async () => {
    // Tag spoza seeda: identyfikator tagu wynika ze sluga nazwy, więc „Przedramiona"
    // trafiłoby w tag wbudowany, którego używa ćwiczenie wbudowane — i usunięcie
    // słusznie by odmówiło.
    const tag = await harness.json<{ id: string }>('POST', '/tags', {
      body: { name: 'Chwyt szczypcowy' },
      headers: member.headers,
    });
    const exercise = await harness.json<{ id: string }>('POST', '/exercises', {
      body: {
        name: 'Zwis na jednej ręce',
        loggingType: 'bodyweight_time',
        primaryTagId: tag.body.id,
      },
      headers: member.headers,
    });

    const renamed = await harness.json<{ name: string }>(
      'PATCH',
      `/exercises/${exercise.body.id}`,
      { body: { name: 'Zwis jednoręczny' }, headers: admin.headers },
    );
    expect(renamed.status).toBe(200);
    expect(renamed.body.name).toBe('Zwis jednoręczny');

    // Tag używany przez ćwiczenie nie znika — to reguła biznesowa, nie brak
    // uprawnień, więc nie zmienia jej nawet rola administratora.
    const inUse = await harness.json('DELETE', `/tags/${tag.body.id}`, { headers: admin.headers });
    expect(inUse.status).toBe(409);

    const removedExercise = await harness.json('DELETE', `/exercises/${exercise.body.id}`, {
      headers: admin.headers,
    });
    expect(removedExercise.status).toBe(204);

    const removedTag = await harness.json('DELETE', `/tags/${tag.body.id}`, {
      headers: admin.headers,
    });
    expect(removedTag.status).toBe(204);
  });

  it('odmawia ręcznego przeglądu zgłoszeń, gdy triage nie jest skonfigurowany', async () => {
    const response = await harness.json('POST', '/admin/feedback/run', {
      headers: admin.headers,
    });
    expect(response.status).toBe(503);
  });

  it('eksport seeda jest zastrzeżony dla administratora', async () => {
    const denied = await harness.json('GET', '/admin/seed/export', { headers: member.headers });
    expect(denied.status).toBe(403);
  });

  it('eksport seeda odtwarza aktualną bibliotekę konta systemowego bez ostrzeżeń', async () => {
    const response = await harness.json<{
      fileName: string;
      content: string;
      tags: number;
      exercises: number;
      warnings: string[];
    }>('GET', '/admin/seed/export', { headers: admin.headers });

    expect(response.status).toBe(200);
    expect(response.body.fileName).toBe('data.ts');
    expect(response.body.exercises).toBeGreaterThan(0);
    expect(response.body.content).toContain('export const SEED_TAGS');
    expect(response.body.content).toContain('export const SEED_EXERCISES');
    expect(response.body.content).toContain("name: 'Barbell bench press'");
    // Nic w bibliotece nie zostało jeszcze zmienione po utworzeniu, więc
    // identyfikatory wyliczone z nazwy dalej zgadzają się z bazą.
    expect(response.body.warnings).toEqual([]);
  });

  it('eksport seeda ostrzega, gdy ćwiczenie wbudowane zostało przemianowane', async () => {
    const builtIn = await harness.json<{ id: string; name: string }[]>('GET', '/exercises', {
      headers: admin.headers,
    });
    const benchPress = builtIn.body.find((exercise) => exercise.name === 'Barbell bench press');
    if (!benchPress) throw new Error('Seed nie zawiera „Barbell bench press"');

    const renamed = await harness.json('PATCH', `/exercises/${benchPress.id}`, {
      body: { name: 'Barbell bench press (flat)' },
      headers: admin.headers,
    });
    expect(renamed.status).toBe(200);

    const response = await harness.json<{ warnings: string[] }>('GET', '/admin/seed/export', {
      headers: admin.headers,
    });

    expect(response.body.warnings).toHaveLength(1);
    expect(response.body.warnings[0]).toContain('Barbell bench press (flat)');

    // Reszta testów w tym pliku dzieli jedną instancję harnessu — zmiana wraca,
    // żeby nie wyciekała do kolejnych testów w tym `describe`.
    await harness.json('PATCH', `/exercises/${benchPress.id}`, {
      body: { name: 'Barbell bench press' },
      headers: admin.headers,
    });
  });
});

describe('ręczny przegląd zgłoszeń zwrotnych', () => {
  class FakeTriageClient implements TriageClient {
    calls = 0;
    nextError: Error | null = null;
    report: FeedbackTriageReport = {
      scanned: 2,
      bugs: 1,
      changeRequests: 1,
      duplicates: 0,
      failures: [],
    };

    async runDaily(): Promise<FeedbackTriageReport> {
      this.calls += 1;
      if (this.nextError) throw this.nextError;
      return this.report;
    }
  }

  let harness: Harness;
  let admin: TestUser;
  let member: TestUser;
  let triage: FakeTriageClient;

  beforeAll(async () => {
    triage = new FakeTriageClient();
    harness = await createHarness({ triage });
    admin = await harness.signUp('szef@example.com', 'haslo-testowe-123', 'Szef');
    member = await harness.signUp('kuba2@example.com', 'haslo-testowe-123', 'Kuba');
    await harness.promoteToAdmin(admin);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('jest zastrzeżony dla administratora', async () => {
    const response = await harness.json('POST', '/admin/feedback/run', {
      headers: member.headers,
    });
    expect(response.status).toBe(403);
    expect(triage.calls).toBe(0);
  });

  it('wyzwala przegląd i oddaje podsumowanie', async () => {
    const response = await harness.json<FeedbackTriageReport>('POST', '/admin/feedback/run', {
      headers: admin.headers,
    });
    expect(response.status).toBe(200);
    expect(response.body).toEqual(triage.report);
    expect(triage.calls).toBe(1);
  });

  it('oddaje 409, gdy usługa triage mówi, że przegląd już trwa', async () => {
    triage.nextError = conflict('Przegląd zgłoszeń już trwa — spróbuj ponownie za chwilę');

    const response = await harness.json('POST', '/admin/feedback/run', {
      headers: admin.headers,
    });
    expect(response.status).toBe(409);

    triage.nextError = null;
  });
});
