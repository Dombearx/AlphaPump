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
 * 3. **Trzy tabele istnieją tylko tutaj.** `outbox`, `sync_state`
 *    i `sync_rejections` opisują stan wymiany danych jednego urządzenia —
 *    serwer nie ma o nich pojęcia i mieć nie musi.
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
 * Rozwiązaniem jest **odroczenie**, nie usunięcie: transakcja pullu
 * ustawia `PRAGMA defer_foreign_keys = ON`, przez co SQLite przenosi
 * sprawdzenie na `COMMIT`. Kolejność wewnątrz paczki przestaje mieć znaczenie,
 * a niespójność faktyczna — taka, której nie domyka żaden wiersz z tej samej
 * paczki — dalej nie przechodzi.
 */

import { GOAL_METRICS, LOGGING_TYPES, SYNC_ENTITIES, USER_ROLES } from '@alphapump/core';
import type {
  GoalMetric,
  IsoDate,
  LoggingType,
  SyncEntity,
  SyncRejection,
  UserRole,
} from '@alphapump/core';
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
    // Odpowiednik indeksu z Postgresa. Tabela jest na telefonie mała, ale
    // parzystość schematów jest tu celem samym w sobie: rozjazd, którego nie
    // widać, jest gorszy niż indeks, który nic nie kosztuje.
    index('users_server_seq_idx').on(table.serverSeq),
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
    /**
     * Opcjonalna siłownia — wchodzi w id ćwiczenia (patrz `ids.ts`), więc to
     * samo ćwiczenie może mieć osobny wiersz per siłownia. `NULL` liczy się
     * jako pusty string w unikalności niżej, żeby dwa ćwiczenia bez podanej
     * siłowni dalej się deduplikowały tak jak przed dodaniem tego pola.
     */
    gym: text('gym'),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('exercises_author_slug_gym_unique').on(
      table.authorId,
      table.slug,
      sql`coalesce(${table.gym}, '')`,
    ),
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

/* ------------------------------------------------- tabele wyłącznie lokalne */

/**
 * Outbox — dziennik wierszy, które czekają na wysłanie.
 *
 * Wpis nie niesie treści mutacji, tylko wskazuje **który wiersz** się zmienił.
 * To nie jest oszczędność miejsca, tylko warunek poprawności: paczka pushu
 * wysyła pełny stan wiersza, więc treść zapisana w chwili edycji zdążyłaby się
 * zestarzeć, zanim urządzenie odzyska łączność. Odczyt stanu dopiero przy
 * składaniu paczki gwarantuje, że na serwer jedzie to, co użytkownik widzi na
 * ekranie.
 *
 * Klucz `seq` rośnie monotonicznie i to on domyka wyścig: push zabiera wpisy do
 * zanotowanego `seq`, a edycja wykonana w trakcie wysyłki dokłada wpis
 * z numerem wyższym, więc nie zostanie skasowana wraz z potwierdzoną paczką.
 * Duplikaty w obrębie jednej paczki są nieszkodliwe — składanie żądania grupuje
 * wpisy po parze encja + wiersz.
 *
 * Tabela nie jest synchronizowana i nie ma odpowiednika po stronie serwera:
 * kolejka wysyłki jest sprawą jednego urządzenia. Nie ma też kluczy obcych —
 * wpis musi przeżyć wiersz, do którego się odnosi.
 */
export const outbox = sqliteTable(
  'outbox',
  {
    seq: integer('seq').primaryKey({ autoIncrement: true }),
    entity: text('entity').$type<SyncEntity>().notNull(),
    rowId: text('row_id').notNull(),
    queuedAt: integer('queued_at', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    index('outbox_row_idx').on(table.entity, table.rowId),
    check('outbox_entity_check', oneOf('entity', SYNC_ENTITIES)),
  ],
);

/**
 * Stan synchronizacji urządzenia — dokładnie jeden wiersz, wymuszony `check`iem.
 *
 * Kursor `server_seq` musi przeżyć restart aplikacji: urządzenie, które zaczyna
 * od zera po każdym uruchomieniu, przy każdym starcie ściąga całą historię.
 * Trzymanie go w bazie, a nie w `AsyncStorage`, daje jeszcze jedno — kursor
 * przesuwa się w tej samej transakcji, w której zapisują się wiersze paczki,
 * więc przerwany pull nie zostawia kursora przed danymi ani za nimi.
 */
export const syncState = sqliteTable(
  'sync_state',
  {
    id: integer('id').primaryKey(),
    /** Ostatni `server_seq`, który urządzenie ma u siebie. */
    cursor: integer('cursor').notNull().default(0),
    pulledAt: integer('pulled_at', { mode: 'timestamp_ms' }),
    pushedAt: integer('pushed_at', { mode: 'timestamp_ms' }),
    /** Ostatni błąd; kasowany przy pierwszej udanej wymianie. */
    lastError: text('last_error'),
  },
  () => [check('sync_state_singleton_check', sql.raw('"id" = 1'))],
);

/** Identyfikator jedynego wiersza `sync_state`. */
export const SYNC_STATE_ID = 1;

/**
 * Wiersze, których serwer nie przyjął — kwarantanna, a nie kosz.
 *
 * Odrzucony wiersz schodzi z outboxu, bo inaczej zatrzymałby kolejkę: skoro
 * serwer odmówił raz, odmówi też za dziesiątym razem, a wszystko za nim
 * przestałoby jechać. Samo skasowanie wpisu znaczyłoby jednak, że zapis
 * przepada po cichu — a przepadająca seria treningowa jest najgorszą rzeczą,
 * jaka może się w tej aplikacji wydarzyć.
 *
 * Dlatego odrzucenie zostaje zapisane **tutaj**, razem z powodem i licznikiem
 * prób. Daje to trzy rzeczy, których skasowany wpis dać nie może: `reconcile`
 * wie, czego nie kolejkować od razu z powrotem, użytkownik ma co zobaczyć
 * w statusie synchronizacji, a wiersz odrzucony z powodu, który da się naprawić
 * po stronie serwera (brakujące ćwiczenie wbudowane, cofnięte uprawnienie),
 * wraca do kolejki sam, gdy minie `retry_after`.
 *
 * Odstęp rośnie z każdą próbą, bo powód odrzucenia zwykle nie znika sam.
 * Wiersz naprawdę nie do przyjęcia kosztuje więc jedno wejście do paczki na
 * dobę, a nie jedno na każdą wymianę.
 *
 * Tabela nie jest synchronizowana i nie ma kluczy obcych — wpis musi przeżyć
 * wiersz, którego dotyczy, tak samo jak wpis outboxu.
 */
export const syncRejections = sqliteTable(
  'sync_rejections',
  {
    entity: text('entity').$type<SyncEntity>().notNull(),
    rowId: text('row_id').notNull(),
    /**
     * Kod powodu podany przez serwer. Zdanie buduje z niego aplikacja
     * (`describeRejection`) — serwer nie zna języka, w którym mówi ten ekran.
     */
    reason: text('reason').$type<SyncRejection>(),
    /** Zmienna część komunikatu: lista identyfikatorów, nazwa, typ logowania. */
    reasonDetail: text('reason_detail'),
    attempts: integer('attempts').notNull().default(1),
    rejectedAt: integer('rejected_at', { mode: 'timestamp_ms' }).notNull(),
    /** Do tego czasu `reconcile` nie kolejkuje wiersza ponownie. */
    retryAfter: integer('retry_after', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [
    primaryKey({ name: 'sync_rejections_pk', columns: [table.entity, table.rowId] }),
    check('sync_rejections_entity_check', oneOf('entity', SYNC_ENTITIES)),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;
export type ExerciseTagRow = typeof exerciseTags.$inferSelect;
export type WorkoutSetRow = typeof workoutSets.$inferSelect;
export type CycleRow = typeof cycles.$inferSelect;
export type CycleGoalRow = typeof cycleGoals.$inferSelect;
export type OutboxRow = typeof outbox.$inferSelect;
export type SyncStateRow = typeof syncState.$inferSelect;
export type SyncRejectionRow = typeof syncRejections.$inferSelect;
