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
import { builtInExerciseId, missingLanguages, tagId, type Translations } from '@alphapump/core';
import { eq } from 'drizzle-orm';
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

  it('daje komplet nazw polskich i angielskich po obu stronach', async () => {
    const byName = (rows: { name: string; translations: Translations | null }[]) =>
      rows
        .map((row) => `${row.name}|${row.translations?.en ?? ''}|${row.translations?.pl ?? ''}`)
        .sort();

    const tagsFromPg = byName(await postgres.db.select().from(pgTags));
    expect(byName(await sqlite.db.select().from(sqliteTags))).toEqual(tagsFromPg);

    const exercisesFromPg = byName(await postgres.db.select().from(pgExercises));
    expect(byName(await sqlite.db.select().from(sqliteExercises))).toEqual(exercisesFromPg);

    // Żadnej luki: brakujące tłumaczenie wbudowanego wiersza pokazałoby się
    // w interfejsie jako nazwa w drugim języku, czyli jako niedokończona zmiana.
    for (const row of [...SEED_TAGS, ...SEED_EXERCISES]) {
      expect(missingLanguages(row.translations)).toEqual([]);
    }
  });

  /**
   * Wiersze wbudowane, które są w bazie **od wcześniej**, seed pomija — wstawia
   * wyłącznie brakujące. Tłumaczenia muszą więc dojść osobnym przebiegiem,
   * inaczej biblioteka sprzed tej zmiany zostałaby bez nazw polskich na zawsze.
   */
  it('uzupełnia tłumaczenia wierszy, które już były w bazie', async () => {
    const [tag] = SEED_TAGS;
    const [exercise] = SEED_EXERCISES;
    if (!tag || !exercise) throw new Error('Pusty seed');

    await postgres.db.update(pgTags).set({ translations: null }).where(eq(pgTags.id, tag.id));
    await postgres.db
      .update(pgExercises)
      .set({ translations: null })
      .where(eq(pgExercises.id, exercise.id));

    await seedPostgres(postgres.db);

    const [tagRow] = await postgres.db.select().from(pgTags).where(eq(pgTags.id, tag.id));
    const [exerciseRow] = await postgres.db
      .select()
      .from(pgExercises)
      .where(eq(pgExercises.id, exercise.id));

    expect(tagRow?.translations).toEqual(tag.translations);
    expect(exerciseRow?.translations).toEqual(exercise.translations);
  });

  /** Nazwa poprawiona ręcznie jest ważniejsza niż ta z seeda — także tutaj. */
  it('nie nadpisuje tłumaczeń, które ktoś już poprawił', async () => {
    const [tag] = SEED_TAGS;
    if (!tag) throw new Error('Pusty seed');

    const custom = { pl: 'moja nazwa', en: 'my name' };
    await postgres.db.update(pgTags).set({ translations: custom }).where(eq(pgTags.id, tag.id));

    await seedPostgres(postgres.db);

    const [row] = await postgres.db.select().from(pgTags).where(eq(pgTags.id, tag.id));
    expect(row?.translations).toEqual(custom);
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
