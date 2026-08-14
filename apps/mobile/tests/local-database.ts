/**
 * Baza lokalna dla testów.
 *
 * Testy jadą po **prawdziwym** schemacie: biorą bundle migracji, który trafia do
 * aplikacji, i uruchamiają go na czystej bazie SQLite. Atrapa schematu
 * sprawdzałaby atrapę, a różnice między nią a schematem wyszłyby dopiero na
 * urządzeniu.
 *
 * Klucze obce są włączone tak samo jak w aplikacji (`PRAGMA foreign_keys = ON`)
 * — inaczej testy synchronizacji przepuściłyby wiersz wskazujący na nic.
 */

import { builtInExerciseId, tagId, type LoggingType } from '@alphapump/core';
import { seedSqlite, users, type SqliteDatabase } from '@alphapump/db/sqlite';
import migrations from '@alphapump/db/sqlite-migrations';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';

export interface LocalDatabase {
  db: SqliteDatabase;
  close: () => void;
}

/** Czysta baza z migracjami i seedem — tak jak po pierwszym uruchomieniu aplikacji. */
export async function createLocalDatabase(): Promise<LocalDatabase> {
  const client = new BetterSqlite3(':memory:');
  client.pragma('foreign_keys = ON');

  for (const entry of migrations.journal.entries) {
    const sql = migrations.migrations[`m${String(entry.idx).padStart(4, '0')}`] as string;
    for (const statement of sql.split('--> statement-breakpoint')) client.exec(statement);
  }

  const db = drizzle(client) as unknown as SqliteDatabase;
  await seedSqlite(db);

  return { db, close: () => client.close() };
}

export const TEST_USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'kuba@example.com',
  nickname: 'Kuba',
} as const;

export async function insertTestUser(db: SqliteDatabase, at = new Date('2026-08-01T08:00:00Z')) {
  await db
    .insert(users)
    .values({ ...TEST_USER, role: 'user', createdAt: at, updatedAt: at })
    .onConflictDoNothing();

  return TEST_USER;
}

/** Ćwiczenia wbudowane, których używają testy — identyfikatory liczone tak jak w seedzie. */
export const EXERCISES: Record<string, { id: string; loggingType: LoggingType }> = {
  bench: { id: builtInExerciseId('Barbell bench press'), loggingType: 'weight_reps' },
  pullUps: { id: builtInExerciseId('Pull-up'), loggingType: 'bodyweight_reps' },
  // Tag główny „Chest", dodatkowy „Triceps" — jedyne wbudowane ćwiczenie z
  // rozjazdem między tagiem liczącym się do cyklu a tagiem, po którym też je
  // znajdzie filtr biblioteki.
  dips: { id: builtInExerciseId('Dips'), loggingType: 'bodyweight_reps' },
};

export const TAGS = {
  chest: tagId('Chest'),
} as const;
