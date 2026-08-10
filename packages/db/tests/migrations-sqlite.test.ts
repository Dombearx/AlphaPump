/**
 * Migracje SQLite na czystym pliku — druga połowa kryterium ukończenia etapu 2.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SYNCED_TABLES, SYNC_COLUMNS } from '../src/tables.js';
import { exercises, tags, workoutSets } from '../src/sqlite/schema.js';
import { SEED_EXERCISES, SEED_TAGS, SYSTEM_USER } from '../src/seed/data.js';
import { seedSqlite } from '../src/seed/sqlite.js';
import { createTestSqlite, type TestSqlite } from './databases.js';

describe('migracje SQLite', () => {
  let sqlite: TestSqlite;

  beforeEach(() => {
    sqlite = createTestSqlite();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('tworzy wszystkie tabele synchronizowane', () => {
    const rows = sqlite.client
      .prepare<[], { name: string }>("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all();
    const tableNames = rows.map((row) => row.name);

    for (const table of [...SYNCED_TABLES, 'users']) {
      expect(tableNames).toContain(table);
    }
  });

  it('każda tabela synchronizowana ma komplet kolumn synchronizacyjnych', () => {
    for (const table of SYNCED_TABLES) {
      if (table === 'exercise_tags' || table === 'cycle_goals') continue;

      const columns = sqlite.client
        .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => row.name);
      expect(columns, table).toEqual(expect.arrayContaining([...SYNC_COLUMNS]));
    }
  });

  it('server_seq jest pusty do czasu potwierdzenia przez serwer', async () => {
    await seedSqlite(sqlite.db);
    const rows = await sqlite.db.select().from(tags);
    expect(rows.every((row) => row.serverSeq === null)).toBe(true);
  });

  it('seed wstawia konto systemowe, tagi i ćwiczenia wbudowane', async () => {
    const summary = await seedSqlite(sqlite.db);
    expect(summary).toEqual({ tags: SEED_TAGS.length, exercises: SEED_EXERCISES.length });

    expect(await sqlite.db.select().from(tags)).toHaveLength(SEED_TAGS.length);
    const exerciseRows = await sqlite.db.select().from(exercises);
    expect(exerciseRows).toHaveLength(SEED_EXERCISES.length);
    expect(exerciseRows.every((row) => row.authorId === SYSTEM_USER.id)).toBe(true);
  });

  it('seed uruchomiony drugi raz niczego nie duplikuje', async () => {
    await seedSqlite(sqlite.db);
    await seedSqlite(sqlite.db);
    expect(await sqlite.db.select().from(exercises)).toHaveLength(SEED_EXERCISES.length);
  });

  it('odrzuca typ logowania spoza listy', async () => {
    await seedSqlite(sqlite.db);
    const [tag] = await sqlite.db.select().from(tags).limit(1);

    // Zapytanie surowe, bo typy Drizzle nie przepuściłyby tej wartości — a
    // sprawdzamy tu ostatnią linię obrony, czyli CHECK po stronie bazy.
    expect(() =>
      sqlite.client
        .prepare(
          `INSERT INTO exercises (id, name, slug, author_id, logging_type, primary_tag_id, created_at, updated_at)
           VALUES ('nie-istniejacy-typ', 'Ćwiczenie z kosmosu', 'cwiczenie-z-kosmosu', ?, 'teleportacja', ?, 0, 0)`,
        )
        .run(SYSTEM_USER.id, tag?.id ?? ''),
    ).toThrow();
  });

  it('odrzuca serię o niedodatniej liczbie powtórzeń', async () => {
    await seedSqlite(sqlite.db);
    const [exercise] = await sqlite.db.select().from(exercises).limit(1);

    await expect(async () =>
      sqlite.db.insert(workoutSets).values({
        id: 'seria-zero-powtorzen',
        userId: SYSTEM_USER.id,
        exerciseId: exercise?.id ?? '',
        performedOn: '2026-08-10',
        weightG: 60_000,
        reps: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).rejects.toThrow();
  });

  it('trzyma dzień treningowy jako tekst YYYY-MM-DD, bez strefy czasowej', async () => {
    await seedSqlite(sqlite.db);
    const [exercise] = await sqlite.db.select().from(exercises).limit(1);

    await sqlite.db.insert(workoutSets).values({
      id: 'seria-o-2300',
      userId: SYSTEM_USER.id,
      exerciseId: exercise?.id ?? '',
      performedOn: '2026-08-10',
      weightG: 60_000,
      reps: 8,
      createdAt: new Date('2026-08-10T23:00:00.000Z'),
      updatedAt: new Date('2026-08-10T23:00:00.000Z'),
    });

    const [row] = sqlite.client
      .prepare<[], { performed_on: string }>('SELECT performed_on FROM workout_sets')
      .all();
    expect(row?.performed_on).toBe('2026-08-10');
  });
});
