/**
 * Eksport i import w aplikacji — etap 14 od strony telefonu.
 *
 * Testy jadą po prawdziwym schemacie lokalnym i **nigdy nie dotykają sieci**: to
 * jest główna zaleta tej ścieżki względem `GET /export`. Telefon ma u siebie całą
 * historię właściciela, więc „wyjmij moje dane" działa w trybie samolotowym.
 *
 * Sprawdzane są trzy rzeczy, z których każda odpowiada realnej awarii:
 *
 * 1. **Pętla eksport → import na czystej bazie odtwarza stan.** To samo
 *    kryterium co po stronie serwera, tylko na SQLite.
 * 2. **Import kolejkuje wysyłkę.** Bez wpisów w outboxie odtworzone dane
 *    zniknęłyby przy pierwszym pullu, bo serwer nigdy by o nich nie usłyszał.
 * 3. **Import nie cofa danych nowszych niż plik.** Reguła jest ta sama co przy
 *    synchronizacji, bo rozstrzyga ją ten sam `resolveSyncConflict`.
 */

import { canonicalArchive, tagId, type Archive } from '@alphapump/core';
import { cycles, exercises, outbox, users, workoutSets } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../src/db/cycles';
import { createExercise } from '../src/db/library';
import { createSet, deleteSet, updateSet, type SetValues } from '../src/db/sets';
import { archiveFileName, exportLocalArchive } from '../src/transfer/export';
import { ArchiveRejectedError, importLocalArchive } from '../src/transfer/import';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a', role: 'user' } as const;
const NOW = new Date('2026-08-11T10:00:00Z');

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

/** Baza z danymi właściciela: własne ćwiczenie, dwie serie i cykl. */
async function seedOwnData(local: LocalDatabase): Promise<{ exerciseId: string }> {
  const saved = await createExercise(local.db, {
    ...AUTHOR,
    name: 'Zwis na jednej ręce',
    loggingType: 'weight_reps',
    primaryTagId: tagId('Forearms'),
    additionalTagIds: [],
    note: 'na czas',
    gym: null,
  });

  await createSet(local.db, {
    ...AUTHOR,
    exerciseId: saved.id,
    performedOn: '2026-08-08',
    values: reps(20, 5),
  });
  await createSet(local.db, {
    ...AUTHOR,
    exerciseId: EXERCISES.bench!.id,
    performedOn: '2026-08-10',
    values: reps(100, 3),
  });

  await createCycle(local.db, {
    ...AUTHOR,
    name: 'Sierpień',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    goals: [{ metric: 'sets', target: 20, exerciseId: saved.id, tagId: null }],
  });

  return { exerciseId: saved.id };
}

const owner = { userId: TEST_USER.id, email: TEST_USER.email, deviceId: 'device-b' };

describe('eksport z bazy lokalnej', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => {
    local.close();
  });

  it('działa bez sieci i niesie serie, cykle oraz dotknięte ćwiczenia', async () => {
    await seedOwnData(local);
    const archive = await exportLocalArchive(local.db, TEST_USER.id, NOW);

    expect(archive).toMatchObject({
      format: 'alphapump.archive',
      version: 1,
      scope: 'user',
      exportedAt: '2026-08-11T10:00:00.000Z',
    });
    expect(archive.sets).toHaveLength(2);
    expect(archive.cycles).toHaveLength(1);
    // Ćwiczenie własne i ćwiczenie wbudowane, którego dotyka druga seria.
    expect(archive.exercises.map((exercise) => exercise.name).sort()).toEqual([
      'Barbell bench press',
      'Zwis na jednej ręce',
    ]);
    // Tagi tych ćwiczeń jadą razem z nimi — bez nich plik byłby bezużyteczny
    // wszędzie poza bazą, z której powstał.
    expect(archive.tags.length).toBeGreaterThan(0);
  });

  it('nie wywozi serii usuniętych — archiwum odtwarza stan, nie historię', async () => {
    const { exerciseId } = await seedOwnData(local);
    const [set] = await local.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.exerciseId, exerciseId));
    await deleteSet(local.db, set!.id, AUTHOR);

    const archive = await exportLocalArchive(local.db, TEST_USER.id, NOW);
    expect(archive.sets).toHaveLength(1);
    expect(archive.sets.every((row) => row.deletedAt === null)).toBe(true);
  });

  it('niesie konto właściciela, bo bez niego powiązania wskazywałyby w próżnię', async () => {
    await seedOwnData(local);
    const archive = await exportLocalArchive(local.db, TEST_USER.id, NOW);

    expect(archive.users.map((user) => user.email)).toContain(TEST_USER.email);
  });

  it('nazwa pliku niesie datę', () => {
    expect(archiveFileName(NOW)).toBe('alphapump-2026-08-11.json');
  });
});

describe('import do czystej bazy lokalnej', () => {
  let source: LocalDatabase;
  let target: LocalDatabase;
  let archive: Archive;

  beforeEach(async () => {
    source = await createLocalDatabase();
    await insertTestUser(source.db);
    await seedOwnData(source);
    archive = await exportLocalArchive(source.db, TEST_USER.id, NOW);

    target = await createLocalDatabase();
    await insertTestUser(target.db);
  });

  afterEach(() => {
    source.close();
    target.close();
  });

  it('odtwarza stan zgodny z oryginałem', async () => {
    const report = await importLocalArchive(target.db, archive, owner);

    expect(report.imported.sets).toBe(2);
    expect(report.imported.cycles).toBe(1);
    expect(report.remappedExercises).toBe(0);

    const restored = await exportLocalArchive(target.db, TEST_USER.id, NOW);
    expect(canonicalArchive(restored)).toEqual(canonicalArchive(archive));
  });

  it('kolejkuje wysyłkę, bo inaczej serwer nigdy by o tych danych nie usłyszał', async () => {
    await importLocalArchive(target.db, archive, owner);

    const queued = await target.db.select().from(outbox);
    const entities = new Set(queued.map((row) => row.entity));

    expect(entities).toContain('set');
    expect(entities).toContain('cycle');
    expect(entities).toContain('exercise');
    expect(queued.filter((row) => row.entity === 'set')).toHaveLength(2);
  });

  it('nie kolejkuje cudzych ćwiczeń — serwer i tak by je odrzucił', async () => {
    await importLocalArchive(target.db, archive, owner);

    const queued = await target.db.select().from(outbox);
    const builtIn = queued.find(
      (row) => row.entity === 'exercise' && row.rowId === EXERCISES.bench!.id,
    );
    expect(builtIn).toBeUndefined();
  });

  it('powtórzony import nie tworzy duplikatów', async () => {
    await importLocalArchive(target.db, archive, owner);
    await importLocalArchive(target.db, archive, owner);

    expect(await target.db.select().from(workoutSets)).toHaveLength(2);
    expect(await target.db.select().from(cycles)).toHaveLength(1);
  });

  it('nie cofa serii zmienionej po eksporcie', async () => {
    await importLocalArchive(target.db, archive, owner);

    const [set] = await target.db.select().from(workoutSets).limit(1);
    await updateSet(target.db, {
      ...AUTHOR,
      setId: set!.id,
      values: { ...reps(120, 1), note: 'po eksporcie' },
    });

    await importLocalArchive(target.db, archive, owner);

    const [after] = await target.db.select().from(workoutSets).where(eq(workoutSets.id, set!.id));
    expect(after?.note).toBe('po eksporcie');
  });

  it('odrzuca archiwum niespójne, zanim dotknie bazy', async () => {
    const broken: Archive = { ...archive, exercises: [] };

    await expect(importLocalArchive(target.db, broken, owner)).rejects.toBeInstanceOf(
      ArchiveRejectedError,
    );
    expect(await target.db.select().from(workoutSets)).toEqual([]);
  });
});

describe('dopasowanie konta po adresie e-mail', () => {
  it('przelicza identyfikatory ćwiczeń, gdy właściciel ma tu inne id', async () => {
    const source = await createLocalDatabase();
    await insertTestUser(source.db);
    const { exerciseId } = await seedOwnData(source);
    const archive = await exportLocalArchive(source.db, TEST_USER.id, NOW);

    // Ten sam człowiek, inne konto: tak wygląda telefon po ponownym zalogowaniu
    // się przez Google.
    const target = await createLocalDatabase();
    const rebornId = '22222222-2222-4222-8222-222222222222';
    await target.db.insert(users).values({
      id: rebornId,
      email: TEST_USER.email,
      nickname: TEST_USER.nickname,
      role: 'user',
      createdAt: NOW,
      updatedAt: NOW,
    });

    const report = await importLocalArchive(target.db, archive, {
      userId: rebornId,
      email: TEST_USER.email,
      deviceId: 'device-c',
    });

    expect(report.remappedExercises).toBe(1);
    expect(report.imported.sets).toBe(2);

    const [restored] = await target.db
      .select()
      .from(exercises)
      .where(eq(exercises.name, 'Zwis na jednej ręce'));
    expect(restored?.authorId).toBe(rebornId);
    // Identyfikator wynika z **nowej** pary autor + nazwa — inaczej push
    // odrzuciłby to ćwiczenie przy pierwszej synchronizacji.
    expect(restored?.id).not.toBe(exerciseId);

    const restoredSets = await target.db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.exerciseId, restored!.id));
    expect(restoredSets).toHaveLength(1);

    source.close();
    target.close();
  });
});
