/**
 * Migracje PostgreSQL na czystej bazie — pierwsza połowa kryterium ukończenia
 * czystej bazy.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SERVER_SEQ_SEQUENCE, SYNCED_TABLES, SYNC_COLUMNS } from '../src/tables.js';
import { exercises, tags, workoutSets } from '../src/pg/schema.js';
import { seedPostgres } from '../src/seed/pg.js';
import { SEED_EXERCISES, SEED_TAGS, SYSTEM_USER } from '../src/seed/data.js';
import { createTestPostgres, type TestPostgres } from './databases.js';

describe('migracje PostgreSQL', () => {
  let postgres: TestPostgres;

  beforeAll(async () => {
    postgres = await createTestPostgres();
  });

  afterAll(async () => {
    await postgres.close();
  });

  it('tworzy wszystkie tabele synchronizowane', async () => {
    const result = await postgres.db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const tableNames = result.rows.map((row) => row.table_name);

    for (const table of [...SYNCED_TABLES, 'users']) {
      expect(tableNames).toContain(table);
    }
  });

  it('każda tabela synchronizowana ma komplet kolumn synchronizacyjnych', async () => {
    for (const table of SYNCED_TABLES) {
      // `exercise_tags` i `cycle_goals` jadą razem ze swoim rodzicem, więc nie
      // mają własnych kolumn synchronizacyjnych — patrz komentarz w schemacie.
      if (table === 'exercise_tags' || table === 'cycle_goals') continue;

      const result = await postgres.db.execute<{ column_name: string }>(
        sql`SELECT column_name FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = ${table}`,
      );
      const columns = result.rows.map((row) => row.column_name);
      expect(columns, table).toEqual(expect.arrayContaining([...SYNC_COLUMNS]));
    }
  });

  it('zakłada sekwencję, z której serwer nadaje server_seq', async () => {
    const result = await postgres.db.execute<{ sequence_name: string }>(
      sql`SELECT sequence_name FROM information_schema.sequences WHERE sequence_schema = 'public'`,
    );
    expect(result.rows.map((row) => row.sequence_name)).toContain(SERVER_SEQ_SEQUENCE);
  });

  it('server_seq rośnie przy każdym wstawieniu, w poprzek tabel', async () => {
    await seedPostgres(postgres.db);

    const [firstTag] = await postgres.db
      .select({ serverSeq: tags.serverSeq })
      .from(tags)
      .orderBy(tags.serverSeq)
      .limit(1);
    const [lastExercise] = await postgres.db
      .select({ serverSeq: exercises.serverSeq })
      .from(exercises)
      .orderBy(sql`${exercises.serverSeq} DESC`)
      .limit(1);

    expect(firstTag?.serverSeq).toBeGreaterThan(0);
    // Jedna sekwencja dla wszystkich tabel: ćwiczenia wstawione po tagach mają
    // wyższe numery, więc pull jednym kursorem nie przegapi żadnego wiersza.
    expect(lastExercise?.serverSeq).toBeGreaterThan(firstTag?.serverSeq ?? 0);
  });

  it('seed wstawia konto systemowe, tagi i ćwiczenia wbudowane', async () => {
    const summary = await seedPostgres(postgres.db);
    expect(summary).toEqual({ tags: SEED_TAGS.length, exercises: SEED_EXERCISES.length });

    const tagRows = await postgres.db.select().from(tags);
    expect(tagRows).toHaveLength(SEED_TAGS.length);

    const exerciseRows = await postgres.db.select().from(exercises);
    expect(exerciseRows).toHaveLength(SEED_EXERCISES.length);
    expect(exerciseRows.every((row) => row.authorId === SYSTEM_USER.id)).toBe(true);
  });

  it('seed uruchomiony drugi raz niczego nie duplikuje ani nie nadpisuje', async () => {
    await seedPostgres(postgres.db);
    const before = await postgres.db.select().from(exercises);

    await seedPostgres(postgres.db);
    const after = await postgres.db.select().from(exercises);

    expect(after).toHaveLength(before.length);
    expect(after.map((row) => row.updatedAt)).toEqual(before.map((row) => row.updatedAt));
  });

  it('odrzuca typ logowania spoza listy', async () => {
    await seedPostgres(postgres.db);
    const [tag] = await postgres.db.select().from(tags).limit(1);

    // Zapytanie surowe, bo typy Drizzle nie przepuściłyby tej wartości — a
    // sprawdzamy tu ostatnią linię obrony, czyli CHECK po stronie bazy.
    await expect(
      postgres.db.execute(sql`
        INSERT INTO exercises (id, name, slug, author_id, logging_type, primary_tag_id)
        VALUES ('nie-istniejacy-typ', 'Ćwiczenie z kosmosu', 'cwiczenie-z-kosmosu',
                ${SYSTEM_USER.id}, 'teleportacja', ${tag?.id ?? ''})
      `),
    ).rejects.toThrow();
  });

  it('odrzuca serię o niedodatniej liczbie powtórzeń', async () => {
    await seedPostgres(postgres.db);
    const [exercise] = await postgres.db.select().from(exercises).limit(1);

    await expect(
      postgres.db.insert(workoutSets).values({
        id: 'seria-zero-powtorzen',
        userId: SYSTEM_USER.id,
        exerciseId: exercise?.id ?? '',
        performedOn: '2026-08-10',
        weightG: 60_000,
        reps: 0,
      }),
    ).rejects.toThrow();
  });

  it('odrzuca intensywność ćwiczenia spoza listy, ale przepuszcza pustą', async () => {
    await seedPostgres(postgres.db);
    const [tag] = await postgres.db.select().from(tags).limit(1);

    // Nazwa musi być inna w każdej próbie — para „autor + slug" jest unikalna.
    const insert = (intensity: string | null) => {
      const name = `Bieg ${intensity ?? 'bez intensywności'}`;
      return postgres.db.execute(sql`
        INSERT INTO exercises (id, name, slug, author_id, logging_type, primary_tag_id, intensity)
        VALUES (${name}, ${name}, ${name},
                ${SYSTEM_USER.id}, 'distance_time', ${tag?.id ?? ''}, ${intensity})
      `);
    };

    await expect(insert('katorznicza')).rejects.toThrow();
    await expect(insert(null)).resolves.toBeDefined();
    await expect(insert('high')).resolves.toBeDefined();
  });

  describe('pozycja celu cyklu', () => {
    const insertGoal = (columns: string, values: ReturnType<typeof sql>) =>
      postgres.db.execute(
        sql`INSERT INTO cycle_goals (id, cycle_id, metric, ${sql.raw(columns)})
            VALUES (${crypto.randomUUID()}, 'cykl-testowy', 'duration', ${values})`,
      );

    beforeAll(async () => {
      await seedPostgres(postgres.db);
      await postgres.db.execute(sql`
        INSERT INTO cycles (id, user_id, name, starts_on)
        VALUES ('cykl-testowy', ${SYSTEM_USER.id}, 'Testowy', '2026-08-01')
        ON CONFLICT DO NOTHING
      `);
    });

    it('przyjmuje zakres intensywnościowy', async () => {
      await expect(insertGoal('target, intensity', sql`9000, 'moderate'`)).resolves.toBeDefined();
    });

    it('odrzuca pozycję z dwoma zakresami naraz', async () => {
      const [tag] = await postgres.db.select().from(tags).limit(1);
      await expect(
        insertGoal('target, tag_id, intensity', sql`9000, ${tag?.id ?? ''}, 'moderate'`),
      ).rejects.toThrow();
    });

    it('odrzuca pozycję bez żadnego zakresu', async () => {
      await expect(insertGoal('target', sql`9000`)).rejects.toThrow();
    });

    it('odrzuca próg wyższy nie większy od minimalnego', async () => {
      await expect(
        insertGoal('target, stretch_target, intensity', sql`9000, 9000, 'moderate'`),
      ).rejects.toThrow();
      await expect(
        insertGoal('target, stretch_target, intensity', sql`9000, 18000, 'moderate'`),
      ).resolves.toBeDefined();
    });
  });
});
