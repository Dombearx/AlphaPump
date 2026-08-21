/**
 * Parzystość seeda. Wymaganie wprost:
 *
 * > seed daje po obu stronach identyczne identyfikatory ćwiczeń wbudowanych.
 *
 * Rzecz nie jest kosmetyczna. Gdyby telefon i serwer wyliczyły dla „Martwego
 * ciągu" różne id, pierwszy pull zrobiłby z jednego ćwiczenia dwa, a serie
 * zapisane offline wskazywałyby na wiersz, którego serwer nie zna.
 */

import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { builtInExerciseId, tagId } from '@alphapump/core';
import {
  exerciseTags as pgExerciseTags,
  exercises as pgExercises,
  tags as pgTags,
} from '../src/pg/schema.js';
import {
  exerciseTags as sqliteExerciseTags,
  exercises as sqliteExercises,
  tags as sqliteTags,
} from '../src/sqlite/schema.js';
import { SEED_EXERCISES, SEED_TAGS } from '../src/seed/data.js';
import { seedPostgres } from '../src/seed/pg.js';
import { seedSqlite } from '../src/seed/sqlite.js';
import {
  createTestPostgres,
  createTestSqlite,
  type TestPostgres,
  type TestSqlite,
} from './databases.js';

describe('parzystość seeda między dialektami', () => {
  let postgres: TestPostgres;
  let sqlite: TestSqlite;

  beforeAll(async () => {
    postgres = await createTestPostgres();
    sqlite = createTestSqlite();
    await seedPostgres(postgres.db);
    await seedSqlite(sqlite.db);
  });

  afterAll(async () => {
    await postgres.close();
    sqlite.close();
  });

  it('daje identyczne identyfikatory ćwiczeń wbudowanych', async () => {
    const fromPg = (await postgres.db.select().from(pgExercises)).map((row) => row.id).sort();
    const fromSqlite = (await sqlite.db.select().from(sqliteExercises)).map((row) => row.id).sort();

    expect(fromSqlite).toEqual(fromPg);
    expect(fromPg).toHaveLength(SEED_EXERCISES.length);
  });

  it('daje identyczne identyfikatory i kolory tagów', async () => {
    const byId = (rows: { id: string; slug: string; color: string }[]) =>
      rows.map((row) => `${row.id}|${row.slug}|${row.color}`).sort();

    const fromPg = byId(await postgres.db.select().from(pgTags));
    const fromSqlite = byId(await sqlite.db.select().from(sqliteTags));

    expect(fromSqlite).toEqual(fromPg);
    expect(fromPg).toHaveLength(SEED_TAGS.length);
  });

  it('wiąże ćwiczenia z tagami dodatkowymi tak samo po obu stronach', async () => {
    const asKeys = (rows: { exerciseId: string; tagId: string; position: number }[]) =>
      rows.map((row) => `${row.exerciseId}|${row.tagId}|${row.position}`).sort();

    expect(asKeys(await sqlite.db.select().from(sqliteExerciseTags))).toEqual(
      asKeys(await postgres.db.select().from(pgExerciseTags)),
    );
  });

  it('identyfikatory w bazie zgadzają się z tym, co wyliczy klient offline', async () => {
    const rows = await postgres.db.select().from(pgExercises);
    const byName = new Map(rows.map((row) => [row.name, row.id]));

    // Telefon tworzący ćwiczenie bez sieci liczy id tą samą funkcją — jeśli
    // trafi na nazwę ćwiczenia wbudowanego, wyjdzie mu ten sam wiersz.
    for (const exercise of SEED_EXERCISES) {
      expect(byName.get(exercise.name)).toBe(builtInExerciseId(exercise.name));
    }

    const tagRows = await postgres.db.select().from(pgTags);
    for (const tag of tagRows) {
      expect(tag.id).toBe(tagId(tag.name));
    }
  });
});
