/**
 * Seed dla SQLite.
 *
 * Ten sam wsad danych co po stronie serwera — te same identyfikatory, te same
 * kolory tagów, ta sama data wierszy. Telefon dostaje bibliotekę wbudowaną od
 * razu przy pierwszym uruchomieniu, bez czekania na pierwszą synchronizację,
 * i nie zduplikuje jej po pullu, bo id po obu stronach są identyczne.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { BaseSQLiteDatabase } from 'drizzle-orm/sqlite-core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  outbox,
  syncRejections,
  syncState,
  tags,
  users,
  workoutSets,
} from '../sqlite/schema.js';
import { SEED_EXERCISES, SEED_TAGS, SEED_TIMESTAMP, SYSTEM_USER } from './data.js';
import type { SeedSummary } from './data.js';

/** Pokrywa zarówno `better-sqlite3` (tryb `sync`), jak i `expo-sqlite` (`async`). */
export type SqliteDatabase = BaseSQLiteDatabase<'sync' | 'async', unknown, Record<string, unknown>>;

export async function seedSqlite(db: SqliteDatabase): Promise<SeedSummary> {
  await db
    .insert(users)
    .values({
      id: SYSTEM_USER.id,
      email: SYSTEM_USER.email,
      nickname: SYSTEM_USER.nickname,
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
async function backfillTranslations(db: SqliteDatabase): Promise<void> {
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

export async function truncateSqlite(db: SqliteDatabase): Promise<void> {
  // Kolejka wysyłki, kwarantanna odrzuceń i kursor idą razem z danymi. Outbox
  // wskazujący na wiersze, których już nie ma, wysłałby przy najbliższym pushu
  // paczkę bez treści.
  await db.delete(outbox);
  await db.delete(syncRejections);
  await db.delete(syncState);
  await db.delete(cycleGoals);
  await db.delete(cycles);
  await db.delete(workoutSets);
  await db.delete(exerciseTags);
  await db.delete(exercises);
  await db.delete(tags);
  await db.delete(users);
}
