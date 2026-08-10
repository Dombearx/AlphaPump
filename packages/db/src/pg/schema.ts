/**
 * Schemat PostgreSQL — strona serwerowa.
 *
 * Różnice względem dialektu SQLite są celowe i sprowadzają się do trzech rzeczy:
 *
 * 1. **Użytkownicy.** Tu mieszka pełna tabela kont, zgodna z układem pól
 *    better-auth (etap 3 dokłada do niej sesje, konta OAuth i klucze API).
 *    Telefon trzyma jedynie okrojony cache użytkowników, bo potrzebuje nicków
 *    do rekordów globalnych, a nie danych logowania.
 * 2. **`server_seq`.** Na serwerze jest `NOT NULL` i nadawany z sekwencji — to
 *    on jest kursorem pobierania. Na telefonie bywa pusty, bo wiersz utworzony
 *    offline jeszcze go nie dostał.
 * 3. **Klucze obce do użytkowników.** Serwer je egzekwuje; telefon nie, bo
 *    kolejność przychodzenia wierszy w pullu nie jest gwarantowana.
 *
 * Reszta — tabele, kolumny, typy i sens pól — jest identyczna po obu stronach
 * i pilnuje tego test parzystości.
 */

import { GOAL_METRICS, LOGGING_TYPES, USER_ROLES } from '@alphapump/core';
import type { GoalMetric, IsoDate, LoggingType, UserRole } from '@alphapump/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { SERVER_SEQ_SEQUENCE } from '../tables.js';

/* ------------------------------------------------------------------ wspólne */

/**
 * Jedna sekwencja dla wszystkich tabel synchronizowanych. `nextval` jako
 * `DEFAULT` obsługuje wyłącznie wstawienie — przy każdej aktualizacji wiersza
 * serwer musi podbić `server_seq` jawnie, inaczej zmiana nie zostanie pobrana
 * przez klientów, których kursor jest już za nią.
 */
export const serverSeqSequence = pgSequence(SERVER_SEQ_SEQUENCE);

const nextServerSeq = sql`nextval('${sql.raw(SERVER_SEQ_SEQUENCE)}')`;

const syncColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  /** Tombstone. Wiersz usunięty nigdy nie znika — inaczej pull nie miałby czego przywieźć. */
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(nextServerSeq),
});

/** `x IN ('a', 'b')` z listy stałych domenowych — wartości wchodzą do migracji. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(', ')})`);

/* ---------------------------------------------------------------- użytkownik */

/**
 * Konto użytkownika.
 *
 * Układ pól odpowiada temu, czego oczekuje better-auth wraz z pluginem `admin`
 * (`role`, `banned`, `ban_reason`, `ban_expires`). `nickname` jest polem
 * dodatkowym: to on — a nie `name` — pokazuje się przy rekordach globalnych
 * i w rankingach, więc jest wymagany.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Publiczny nick — jedyna dana osobowa wychodząca na zewnątrz przy rekordach. */
    nickname: text('nickname').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').$type<UserRole>().notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    check('users_role_check', oneOf('role', USER_ROLES)),
  ],
);

/* ----------------------------------------------------------------------- tag */

/**
 * Tag jest bytem globalnym: id wylicza się z samego sluga, więc „biceps",
 * „Biceps" i „BICEPS" to jeden wiersz niezależnie od tego, kto go utworzył
 * i czy miał w tym momencie sieć.
 */
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Wyliczany z hasha sluga — serwer nigdy go nie koryguje. */
    color: text('color').notNull(),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('tags_slug_unique').on(table.slug),
    index('tags_server_seq_idx').on(table.serverSeq),
  ],
);

/* ----------------------------------------------------------------- ćwiczenie */

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    /** Ustalany raz przy tworzeniu; zmiana wymaga nowego ćwiczenia. */
    loggingType: text('logging_type').$type<LoggingType>().notNull(),
    /** Dokładnie jeden — to on decyduje o zaliczaniu serii do cykli tagowych. */
    primaryTagId: text('primary_tag_id')
      .notNull()
      .references(() => tags.id),
    note: text('note'),
    ...syncColumns(),
  },
  (table) => [
    /** Unikalność „nazwa + autor" ze specyfikacji; id i tak wylicza się z tej pary. */
    uniqueIndex('exercises_author_slug_unique').on(table.authorId, table.slug),
    index('exercises_primary_tag_idx').on(table.primaryTagId),
    index('exercises_server_seq_idx').on(table.serverSeq),
    check('exercises_logging_type_check', oneOf('logging_type', LOGGING_TYPES)),
  ],
);

/**
 * Tagi dodatkowe ćwiczenia.
 *
 * Osobna tabela, a nie tablica w wierszu, bo tagi są bytem współdzielonym i
 * chcemy po nich klucz obcy. Przy synchronizacji zestaw tagów jedzie razem
 * z ćwiczeniem i jest podmieniany w całości — dlatego wiersze tej tabeli nie
 * mają własnych kolumn synchronizacyjnych i kasują się kaskadowo.
 */
export const exerciseTags = pgTable(
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

/**
 * Seria treningowa — podstawowa jednostka zapisu.
 *
 * Wszystkie pomiary są liczbami całkowitymi (gramy, powtórzenia, sekundy,
 * metry). Front Pareto porównuje wartości na równość, a na liczbach
 * zmiennoprzecinkowych „dokładny remis" — który zgodnie ze specyfikacją nie
 * pokazuje komunikatu o rekordzie — zaczynałby losowo wyskakiwać jako rekord.
 *
 * `performed_on` jest dniem kalendarzowym **bez strefy czasowej**, osobno od
 * `created_at`. Inaczej seria zapisana o 23:00 podczas wyjazdu wylądowałaby po
 * synchronizacji w innym dniu niż ten, w którym użytkownik ją wykonał.
 */
export const workoutSets = pgTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    performedOn: date('performed_on', { mode: 'string' }).$type<IsoDate>().notNull(),
    /** Kolejność w obrębie dnia; użytkownik może ją zmieniać. */
    position: integer('position').notNull().default(0),
    weightG: integer('weight_g'),
    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: integer('distance_m'),
    /** Zapisywana przy ćwiczeniach na masę ciała, ale nieliczona do rekordów. */
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

export const cycles = pgTable(
  'cycles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** Reset cyklu to przesunięcie tej daty — historia realizacji zostaje w seriach. */
    startsOn: date('starts_on', { mode: 'string' }).$type<IsoDate>().notNull(),
    endsOn: date('ends_on', { mode: 'string' }).$type<IsoDate>(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...syncColumns(),
  },
  (table) => [
    index('cycles_user_idx').on(table.userId),
    index('cycles_server_seq_idx').on(table.serverSeq),
    check('cycles_range_check', sql.raw('"ends_on" IS NULL OR "ends_on" >= "starts_on"')),
  ],
);

/**
 * Pozycja celu cyklu.
 *
 * Wskazuje **albo** ćwiczenie, **albo** tag — nigdy oba i nigdy żadnego.
 * Pilnuje tego `cycle_goals_scope_check`, bo pozycja bez zakresu nie miałaby
 * czego zliczać, a z dwoma zakresami liczyłaby dwa razy.
 */
export const cycleGoals = pgTable(
  'cycle_goals',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    metric: text('metric').$type<GoalMetric>().notNull(),
    /** Liczba serii, sekundy albo metry — zależnie od metryki. */
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
