/**
 * Eksport i import danych (etap 14).
 *
 * Kryterium ukończenia etapu brzmi: kopia zostaje odtworzona do **czystej bazy**,
 * a dane po odtworzeniu zgadzają się z oryginałem — łącznie z powiązaniami
 * autorów ćwiczeń i właścicieli serii. Ten plik sprawdza to wprost: stawia drugą,
 * pustą bazę, wgrywa do niej archiwum z pierwszej i porównuje postacie kanoniczne
 * obu eksportów.
 *
 * Osobno sprawdzany jest scenariusz, dla którego istnieje dopasowanie po e-mailu:
 * użytkownik, który po odtworzeniu zalogował się ponownie i dostał **nowy
 * identyfikator**. Bez tłumaczenia identyfikatorów jego dane byłyby osierocone,
 * a jego ćwiczenia — odrzucane przy pierwszej synchronizacji, bo id ćwiczenia
 * wynika z pary autor + nazwa.
 */

import { canonicalArchive, type Archive } from '@alphapump/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BODY_LIMIT_BYTES } from '../src/app.js';
import { exportArchive, importArchive } from '../src/transfer/index.js';
import { exercises, users, workoutSets } from '../src/schema.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

interface Seeded {
  harness: Harness;
  owner: TestUser;
  other: TestUser;
  tagId: string;
  exerciseId: string;
  cycleId: string;
}

/** Baza z danymi dwóch osób: własne ćwiczenie, serie, cykl i seria cudza. */
async function seedData(): Promise<Seeded> {
  const harness = await createHarness();
  const owner = await harness.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
  const other = await harness.signUp('ola@example.com', 'haslo-testowe-123', 'Ola');

  const tag = await harness.json<{ id: string }>('POST', '/tags', {
    body: { name: 'Chwyt szczypcowy' },
    headers: owner.headers,
  });

  const exercise = await harness.json<{ id: string }>('POST', '/exercises', {
    body: {
      name: 'Zwis na jednej ręce',
      loggingType: 'bodyweight_time',
      primaryTagId: tag.body.id,
      note: 'na czas',
    },
    headers: owner.headers,
  });

  for (const [index, day] of ['2026-08-08', '2026-08-10'].entries()) {
    const response = await harness.json('POST', '/sets', {
      body: {
        exerciseId: exercise.body.id,
        performedOn: day,
        durationS: 40 + index * 5,
        weightG: null,
        reps: null,
        distanceM: null,
        bodyweightG: 82_000,
        note: index === 0 ? null : 'mocno',
      },
      headers: owner.headers,
    });
    expect(response.status).toBe(201);
  }

  // Seria cudza — po to, żeby archiwum jednego konta jej nie wywiozło.
  await harness.json('POST', '/sets', {
    body: {
      exerciseId: exercise.body.id,
      performedOn: '2026-08-09',
      durationS: 30,
      weightG: null,
      reps: null,
      distanceM: null,
      bodyweightG: 70_000,
    },
    headers: other.headers,
  });

  const cycle = await harness.json<{ id: string }>('POST', '/cycles', {
    body: {
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      goals: [{ metric: 'duration', target: 600, exerciseId: exercise.body.id, tagId: null }],
    },
    headers: owner.headers,
  });

  return {
    harness,
    owner,
    other,
    tagId: tag.body.id,
    exerciseId: exercise.body.id,
    cycleId: cycle.body.id,
  };
}

describe('eksport', () => {
  let seeded: Seeded;

  beforeAll(async () => {
    seeded = await seedData();
  });

  afterAll(async () => {
    await seeded.harness.close();
  });

  it('archiwum konta niesie własne serie, cykle i dotknięte ćwiczenia', async () => {
    const response = await seeded.harness.json<Archive>('GET', '/export', {
      headers: seeded.owner.headers,
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ format: 'alphapump.archive', version: 1, scope: 'user' });

    expect(response.body.sets).toHaveLength(2);
    expect(response.body.sets.every((set) => set.userId === seeded.owner.id)).toBe(true);
    expect(response.body.cycles).toHaveLength(1);
    expect(response.body.exercises.map((exercise) => exercise.name)).toEqual([
      'Zwis na jednej ręce',
    ]);
    // Tag i autor jadą razem z ćwiczeniem — bez nich plik byłby bezużyteczny
    // wszędzie poza bazą, z której powstał.
    expect(response.body.tags.map((tag) => tag.id)).toEqual([seeded.tagId]);
    expect(response.body.users.map((user) => user.email)).toEqual(['kuba@example.com']);
  });

  it('archiwum konta nie wywozi cudzych serii', async () => {
    const response = await seeded.harness.json<Archive>('GET', '/export', {
      headers: seeded.owner.headers,
    });

    expect(response.body.sets.some((set) => set.userId === seeded.other.id)).toBe(false);
  });

  it('archiwum systemowe jest zastrzeżone dla administratora', async () => {
    const denied = await seeded.harness.json('GET', '/export?scope=system', {
      headers: seeded.owner.headers,
    });
    expect(denied.status).toBe(403);

    await seeded.harness.promoteToAdmin(seeded.owner);
    const allowed = await seeded.harness.json<Archive>('GET', '/export?scope=system', {
      headers: seeded.owner.headers,
    });

    expect(allowed.status).toBe(200);
    expect(allowed.body.scope).toBe('system');
    expect(allowed.body.sets).toHaveLength(3);
    // Cała biblioteka wbudowana i konto systemowe też są w kopii.
    expect(allowed.body.users.map((user) => user.email)).toContain('system@alphapump.local');
    expect(allowed.body.exercises.length).toBeGreaterThan(10);
  });

  it('nazwa pliku niesie datę, tak jak pliki w retencji na Dysku', async () => {
    const response = await seeded.harness.request('/export', { headers: seeded.owner.headers });
    expect(response.headers.get('content-disposition')).toMatch(
      /attachment; filename="alphapump-user-\d{4}-\d{2}-\d{2}\.json"/,
    );
  });
});

describe('odtworzenie do czystej bazy — kryterium etapu 14', () => {
  it('dane po odtworzeniu zgadzają się z oryginałem', async () => {
    const source = await seedData();
    await source.harness.promoteToAdmin(source.owner);

    const archive = await exportArchive(source.harness.db, { kind: 'system' });

    // Czysta baza: migracje i seed, bez ani jednego konta użytkownika.
    const target = await createHarness();
    const report = await importArchive(target.db, archive, {
      actor: {
        id: '00000000-0000-4000-8000-000000000000',
        email: 'restore@example.local',
        role: 'admin',
      },
    });

    expect(report.imported.users).toBe(2);
    expect(report.imported.sets).toBe(3);
    expect(report.imported.cycles).toBe(1);
    // Identyfikatory autorów są w obu bazach te same, więc nie ma czego przeliczać.
    expect(report.remappedExercises).toBe(0);

    const restored = await exportArchive(target.db, { kind: 'system' });
    expect(canonicalArchive(restored)).toEqual(canonicalArchive(archive));

    // Powiązania sprawdzone jeszcze raz wprost, bo to one są w kryterium etapu.
    const [restoredSet] = await target.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.id, archive.sets[0]!.id));
    expect(restoredSet?.userId).toBe(archive.sets[0]!.userId);
    expect(restoredSet?.exerciseId).toBe(archive.sets[0]!.exerciseId);

    await source.harness.close();
    await target.close();
  });

  it('odtworzone wiersze dostają nowy server_seq, więc schodzą na urządzenia', async () => {
    const source = await seedData();
    const archive = await exportArchive(source.harness.db, {
      kind: 'user',
      userId: source.owner.id,
    });

    const target = await createHarness();
    const before = await target.json<{ cursor: number }>('GET', '/sync/pull?since=0', {
      headers: (await target.signUp('kuba@example.com')).headers,
    });

    await importArchive(target.db, archive, {
      actor: { id: 'nieistotne', email: 'admin@example.local', role: 'admin' },
    });

    const [set] = await target.db
      .select({ serverSeq: workoutSets.serverSeq })
      .from(workoutSets)
      .limit(1);
    expect(set?.serverSeq).toBeGreaterThan(before.body.cursor);

    await source.harness.close();
    await target.close();
  });
});

describe('dopasowanie po adresie e-mail', () => {
  it('przelicza identyfikatory ćwiczeń, gdy autor ma w bazie inne id', async () => {
    const source = await seedData();
    const archive = await exportArchive(source.harness.db, {
      kind: 'user',
      userId: source.owner.id,
    });

    // Docelowa baza zna tego samego człowieka pod innym identyfikatorem — tak
    // wygląda odtworzenie po ponownym zalogowaniu się przez Google.
    const target = await createHarness();
    const reborn = await target.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
    expect(reborn.id).not.toBe(source.owner.id);

    const report = await importArchive(target.db, archive, {
      actor: { id: reborn.id, email: reborn.email, role: 'user' },
    });

    expect(report.imported.exercises).toBe(1);
    expect(report.remappedExercises).toBe(1);
    expect(report.imported.sets).toBe(2);

    const [exercise] = await target.db
      .select()
      .from(exercises)
      .where(eq(exercises.name, 'Zwis na jednej ręce'));
    expect(exercise?.authorId).toBe(reborn.id);
    // Identyfikator wynika z **nowej** pary autor + nazwa — inaczej push
    // odrzuciłby to ćwiczenie przy pierwszej synchronizacji.
    expect(exercise?.id).not.toBe(archive.exercises[0]!.id);

    const restoredSets = await target.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.userId, reborn.id));
    expect(restoredSets).toHaveLength(2);
    expect(restoredSets.every((set) => set.exerciseId === exercise?.id)).toBe(true);

    await source.harness.close();
    await target.close();
  });
});

describe('sufit rozmiaru żądania', () => {
  /**
   * Ciało jest parsowane w całości do pamięci, zanim Zod zobaczy pierwsze pole,
   * więc bez limitu jedno żądanie kładzie proces API — a razem z nim panel, bo
   * wychodzi tym samym Caddym. Limit ma dwie wartości i test pilnuje obu:
   * zwykłej trasy i podniesionej dla importu archiwum.
   */
  it('odrzuca ciało większe niż sufit zwykłej trasy', async () => {
    const source = await seedData();

    const response = await source.harness.request('/sets', {
      method: 'POST',
      headers: { ...source.owner.headers, 'content-type': 'application/json' },
      body: 'x'.repeat(BODY_LIMIT_BYTES + 1),
    });

    expect(response.status).toBe(400);
    await source.harness.close();
  });

  it('import archiwum ma własny, wyższy sufit', async () => {
    const source = await seedData();
    await source.harness.promoteToAdmin(source.owner);

    // Ciało większe od limitu zwykłej trasy, mniejsze od limitu importu:
    // ma odbić się dopiero o walidację, a nie o rozmiar.
    const response = await source.harness.request('/import', {
      method: 'POST',
      headers: { ...source.owner.headers, 'content-type': 'application/json' },
      body: JSON.stringify({ nieznane: 'x'.repeat(BODY_LIMIT_BYTES + 1024) }),
    });

    expect(response.status).toBe(400);
    const body = (await response.json()) as { error: { message: string } };
    expect(body.error.message).not.toContain('większe niż');
    await source.harness.close();
  });
});

describe('uprawnienia i odporność importu', () => {
  it('zwykły użytkownik nie wgra archiwum systemowego', async () => {
    const source = await seedData();
    await source.harness.promoteToAdmin(source.owner);
    const archive = await exportArchive(source.harness.db, { kind: 'system' });

    const response = await source.harness.json('POST', '/import', {
      body: archive,
      headers: source.other.headers,
    });

    expect(response.status).toBe(403);
    await source.harness.close();
  });

  it('import użytkownika nie wgrywa cudzych serii', async () => {
    const source = await seedData();
    await source.harness.promoteToAdmin(source.owner);
    const systemArchive = await exportArchive(source.harness.db, { kind: 'system' });

    // Podmieniamy zakres na „user": plik niesie dane dwóch osób, a importuje go
    // jedna. Wiersze cudze muszą zostać pominięte, nie przemycone.
    const archive: Archive = { ...systemArchive, scope: 'user' };

    const target = await createHarness();
    const kuba = await target.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
    const report = await importArchive(target.db, archive, {
      actor: { id: kuba.id, email: kuba.email, role: 'user' },
    });

    expect(report.imported.sets).toBe(2);
    expect(report.skipped.sets).toBe(1);
    expect(report.notes.length).toBeGreaterThan(0);
    // Konta cudzego import użytkownika nie zakłada.
    const accounts = await target.db.select().from(users).where(eq(users.email, 'ola@example.com'));
    expect(accounts).toEqual([]);

    await source.harness.close();
    await target.close();
  });

  it('odrzuca archiwum niespójne, zanim dotknie bazy', async () => {
    const source = await seedData();
    const archive = await exportArchive(source.harness.db, {
      kind: 'user',
      userId: source.owner.id,
    });
    const broken: Archive = { ...archive, exercises: [] };

    const response = await source.harness.json<{ error: { code: string } }>('POST', '/import', {
      body: broken,
      headers: source.owner.headers,
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('bad_request');
    await source.harness.close();
  });

  it('odrzuca plik, który nie jest archiwum AlphaPump', async () => {
    const source = await seedData();
    const response = await source.harness.json('POST', '/import', {
      body: { format: 'cokolwiek', version: 1 },
      headers: source.owner.headers,
    });

    expect(response.status).toBe(400);
    await source.harness.close();
  });

  it('powtórzony import jest nieszkodliwy, a nowszych danych nie cofa', async () => {
    const source = await seedData();
    const archive = await exportArchive(source.harness.db, {
      kind: 'user',
      userId: source.owner.id,
    });

    const first = await source.harness.json<{ imported: { sets: number } }>('POST', '/import', {
      body: archive,
      headers: source.owner.headers,
    });
    expect(first.status).toBe(200);

    // Notatka zmieniona **po** eksporcie: LWW po `updated_at` nie pozwala
    // archiwum cofnąć nowszej wersji wiersza.
    const setId = archive.sets[0]!.id;
    await source.harness.json('PATCH', `/sets/${setId}`, {
      body: { note: 'po eksporcie' },
      headers: source.owner.headers,
    });

    await source.harness.json('POST', '/import', {
      body: archive,
      headers: source.owner.headers,
    });

    const [row] = await source.harness.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.id, setId));
    expect(row?.note).toBe('po eksporcie');

    const all = await source.harness.db.select().from(workoutSets);
    expect(all).toHaveLength(3);

    await source.harness.close();
  });
});
