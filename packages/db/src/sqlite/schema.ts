/**
 * Schemat SQLite — strona telefonu.
 *
 * Tabele domenowe są kolumna w kolumnę takie same jak w dialekcie PostgreSQL
 * (pilnuje tego `tests/schema-parity.test.ts`). Różnice są dwie i obie wynikają
 * z tego, że telefon jest klientem, a nie źródłem prawdy:
 *
 * 1. **Użytkownicy to cache.** Bez haseł, sesji i kluczy API — telefon
 *    potrzebuje wyłącznie nicków do rekordów globalnych.
 * 2. **`server_seq` bywa pusty.** Wiersz utworzony offline nie dostał jeszcze
 *    numeru z sekwencji serwera; dostanie go po pierwszym udanym pushu.
 *
 * Czas jest trzymany jako liczba milisekund (`timestamp_ms`), a dzień
 * treningowy jako tekst `YYYY-MM-DD` — tak samo jak po stronie serwera, gdzie
 * są to `timestamptz` i `date`. Po obu stronach czyta się je jako `Date`
 * i `IsoDate`.
 *
 * ## Klucze obce a kolejność wierszy w pullu
 *
 * Komplet kluczy obcych jest tu taki sam jak na serwerze — i to jest warunek,
 * którego kod synchronizacji musi dotrzymać, a nie problem do obejścia przez
 * zdejmowanie więzów.
 *
 * Rzecz w tym, że pull przywozi wiersze posortowane po `server_seq`, czyli
 * **chronologicznie względem zapisu na serwerze**, a nie topologicznie względem
 * zależności. Ćwiczenie potrafi więc przyjechać przed swoim tagiem, a seria
 * przed swoim ćwiczeniem. Przy natychmiastowym sprawdzaniu więzów taki wiersz
 * zostałby odrzucony — a to znaczy albo wywróconą transakcję pullu i kursor,
 * który nigdy nie rusza do przodu, albo cicho zgubiony wiersz.
 *
 * Rozwiązaniem jest **odroczenie**, nie usunięcie: transakcja pullu (etap 7)
 * ustawia `PRAGMA defer_foreign_keys = ON`, przez co SQLite przenosi
 * sprawdzenie na `COMMIT`. Kolejność wewnątrz paczki przestaje mieć znaczenie,
 * a niespójność faktyczna — taka, której nie domyka żaden wiersz z tej samej
 * paczki — dalej nie przechodzi.
 */

import { GOAL_METRICS, LOGGING_TYPES, USER_ROLES } from '@alphapump/core';
import type { GoalMetric, IsoDate, LoggingType, UserRole } from '@alphapump/core';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

/* ------------------------------------------------------------------ wspólne */

const syncColumns = () => ({
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
  /** Tombstone. Wiersz usunięty offline musi mieć jak dojechać na serwer. */
  deletedAt: integer('deleted_at', { mode: 'timestamp_ms' }),
  /** Pusty do czasu, aż serwer potwierdzi wiersz i nada mu numer z sekwencji. */
  serverSeq: integer('server_seq'),
  /** Urządzenie ostatniego zapisu — rozstrzyga remis `updated_at` przy LWW. */
  deviceId: text('device_id'),
});

const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(', ')})`);

/* ---------------------------------------------------------------- użytkownik */

/**
 * Cache użytkowników — tylko to, co potrzebne do pokazania cudzego nicku.
 *
 * `email` jest pusty dla wszystkich poza właścicielem telefonu. Adresy
 * pozostałych osób nie są potrzebne do niczego, co robi aplikacja, a pull
 * jedzie do każdego urządzenia w grupie — nie ma powodu ich tam rozsyłać.
 */
export const users = sqliteTable(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email'),
    nickname: text('nickname').notNull(),
    role: text('role').$type<UserRole>().notNull().default('user'),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    check('users_role_check', oneOf('role', USER_ROLES)),
  ],
);

/* ----------------------------------------------------------------------- tag */

export const tags = sqliteTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    color: text('color').notNull(),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('tags_slug_unique').on(table.slug),
    index('tags_server_seq_idx').on(table.serverSeq),
  ],
);

/* ----------------------------------------------------------------- ćwiczenie */

export const exercises = sqliteTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Autor bywa kimś innym niż właściciel telefonu — biblioteka jest wspólna. */
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    loggingType: text('logging_type').$type<LoggingType>().notNull(),
    primaryTagId: text('primary_tag_id')
      .notNull()
      .references(() => tags.id),
    note: text('note'),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('exercises_author_slug_unique').on(table.authorId, table.slug),
    index('exercises_primary_tag_idx').on(table.primaryTagId),
    index('exercises_server_seq_idx').on(table.serverSeq),
    check('exercises_logging_type_check', oneOf('logging_type', LOGGING_TYPES)),
  ],
);

export const exerciseTags = sqliteTable(
  'exercise_tags',
  {
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    primaryKey({ name: 'exercise_tags_pk', columns: [table.exerciseId, table.tagId] }),
    index('exercise_tags_tag_idx').on(table.tagId),
  ],
);

/* --------------------------------------------------------------------- seria */

export const workoutSets = sqliteTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    /** Zawsze właściciel telefonu: pull nie przywozi cudzych serii, bo są prywatne. */
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    performedOn: text('performed_on').$type<IsoDate>().notNull(),
    position: integer('position').notNull().default(0),
    weightG: integer('weight_g'),
    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: integer('distance_m'),
    bodyweightG: integer('bodyweight_g'),
    note: text('note'),
    ...syncColumns(),
  },
  (table) => [
    index('workout_sets_user_day_idx').on(table.userId, table.performedOn),
    index('workout_sets_user_exercise_idx').on(table.userId, table.exerciseId),
    index('workout_sets_exercise_idx').on(table.exerciseId),
    index('workout_sets_server_seq_idx').on(table.serverSeq),
    check(
      'workout_sets_measurements_check',
      sql.raw(
        '"weight_g" >= 0 AND "reps" > 0 AND "duration_s" > 0 AND "distance_m" > 0 AND "bodyweight_g" >= 0',
      ),
    ),
    check('workout_sets_position_check', sql.raw('"position" >= 0')),
  ],
);

/* ---------------------------------------------------------------------- cykl */

export const cycles = sqliteTable(
  'cycles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    startsOn: text('starts_on').$type<IsoDate>().notNull(),
    endsOn: text('ends_on').$type<IsoDate>(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
    ...syncColumns(),
  },
  (table) => [
    index('cycles_user_idx').on(table.userId),
    index('cycles_server_seq_idx').on(table.serverSeq),
    check('cycles_range_check', sql.raw('"ends_on" IS NULL OR "ends_on" >= "starts_on"')),
  ],
);

export const cycleGoals = sqliteTable(
  'cycle_goals',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    metric: text('metric').$type<GoalMetric>().notNull(),
    target: integer('target').notNull(),
    exerciseId: text('exercise_id').references(() => exercises.id),
    tagId: text('tag_id').references(() => tags.id),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('cycle_goals_cycle_idx').on(table.cycleId),
    check('cycle_goals_metric_check', oneOf('metric', GOAL_METRICS)),
    check('cycle_goals_target_check', sql.raw('"target" > 0')),
    check('cycle_goals_scope_check', sql.raw('("exercise_id" IS NULL) <> ("tag_id" IS NULL)')),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;
export type ExerciseTagRow = typeof exerciseTags.$inferSelect;
export type WorkoutSetRow = typeof workoutSets.$inferSelect;
export type CycleRow = typeof cycles.$inferSelect;
export type CycleGoalRow = typeof cycleGoals.$inferSelect;
