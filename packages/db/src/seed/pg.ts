/**
 * Seed dla PostgreSQL.
 *
 * Wstawia to, czego brakuje, i **nie nadpisuje tego, co już jest**. Seed bywa
 * uruchamiany na bazie, w której ktoś zdążył już poprawić nazwę albo tagi
 * ćwiczenia wbudowanego — nadpisywanie cofałoby te zmiany przy każdym
 * wdrożeniu, a przy okazji podbijało `updated_at` i wygrywało LWW z edycją
 * użytkownika.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../pg/schema.js';
import { SEED_EXERCISES, SEED_TAGS, SEED_TIMESTAMP, SYSTEM_USER } from './data.js';
import type { SeedSummary } from './data.js';

export type PostgresDatabase = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;

export async function seedPostgres(db: PostgresDatabase): Promise<SeedSummary> {
  await db
    .insert(users)
    .values({
      id: SYSTEM_USER.id,
      name: SYSTEM_USER.name,
      nickname: SYSTEM_USER.nickname,
      email: SYSTEM_USER.email,
      emailVerified: true,
      role: SYSTEM_USER.role,
      createdAt: SEED_TIMESTAMP,
      updatedAt: SEED_TIMESTAMP,
    })
    .onConflictDoNothing();

  await db
    .insert(tags)
    .values(
      SEED_TAGS.map((tag) => ({
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
        color: tag.color,
        translations: tag.translations,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      })),
    )
    .onConflictDoNothing();

  await db
    .insert(exercises)
    .values(
      SEED_EXERCISES.map((exercise) => ({
        id: exercise.id,
        name: exercise.name,
        slug: exercise.slug,
        authorId: exercise.authorId,
        loggingType: exercise.loggingType,
        primaryTagId: exercise.primaryTagId,
        translations: exercise.translations,
        createdAt: SEED_TIMESTAMP,
        updatedAt: SEED_TIMESTAMP,
      })),
    )
    .onConflictDoNothing();

  const links = SEED_EXERCISES.flatMap((exercise) =>
    exercise.additionalTagIds.map((tagId, position) => ({
      exerciseId: exercise.id,
      tagId,
      position,
    })),
  );
  if (links.length > 0) {
    await db.insert(exerciseTags).values(links).onConflictDoNothing();
  }

  await backfillTranslations(db);

  return { tags: SEED_TAGS.length, exercises: SEED_EXERCISES.length };
}

/**
 * Uzupełnienie tłumaczeń wierszy, które są w bazie **od wcześniej**.
 *
 * Seed wstawia wyłącznie brakujące wiersze, więc biblioteka wbudowana istniejąca
 * przed dodaniem pola `translations` zostałaby bez nazw polskich na zawsze.
 * Uzupełniamy wyłącznie `NULL` — nazwa wpisana ręcznie przez administratora ma
 * pierwszeństwo przed tą z seeda, tak samo jak przy reszcie wsadu.
 *
 * `updated_at` zostaje nietknięte celowo: podbicie go przy każdym starcie
 * kazałoby wierszowi wbudowanemu wygrywać LWW z edycją użytkownika.
 */
async function backfillTranslations(db: PostgresDatabase): Promise<void> {
  for (const tag of SEED_TAGS) {
    await db
      .update(tags)
      .set({ translations: tag.translations })
      .where(and(eq(tags.id, tag.id), isNull(tags.translations)));
  }

  for (const exercise of SEED_EXERCISES) {
    await db
      .update(exercises)
      .set({ translations: exercise.translations })
      .where(and(eq(exercises.id, exercise.id), isNull(exercises.translations)));
  }
}

/**
 * Czyści dane domenowe — używane przez testy i przez odtwarzanie z kopii
 * zapasowej. Kolejność jest odwrotna do zależności kluczy obcych.
 */
export async function truncatePostgres(db: PostgresDatabase): Promise<void> {
  await db.delete(cycleGoals);
  await db.delete(cycles);
  await db.delete(workoutSets);
  await db.delete(exerciseTags);
  await db.delete(exercises);
  await db.delete(tags);
  await db.delete(users);
}
