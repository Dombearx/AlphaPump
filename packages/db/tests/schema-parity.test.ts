/**
 * Parzystość schematów — „jeden opis schematu, dwa dialekty" sprawdzane, a nie
 * deklarowane.
 *
 * Schemat jest fizycznie napisany dwa razy, bo buildery Drizzle są osobne dla
 * każdego dialektu. Rozjazd między nimi jest łatwy do popełnienia (dodana
 * kolumna po jednej stronie) i trudny do zauważenia — ujawniłby się dopiero
 * przy synchronizacji, jako cicho gubione pole.
 */

import { getTableConfig as getPgTableConfig } from 'drizzle-orm/pg-core';
import { getTableConfig as getSqliteTableConfig } from 'drizzle-orm/sqlite-core';
import { describe, expect, it } from 'vitest';
import * as pg from '../src/pg/schema.js';
import * as sqlite from '../src/sqlite/schema.js';
import { SYNCED_TABLES, type SyncedTable } from '../src/tables.js';

const PG_TABLES = {
  tags: pg.tags,
  exercises: pg.exercises,
  exercise_tags: pg.exerciseTags,
  workout_sets: pg.workoutSets,
  cycles: pg.cycles,
  cycle_goals: pg.cycleGoals,
} as const satisfies Record<SyncedTable, unknown>;

const SQLITE_TABLES = {
  tags: sqlite.tags,
  exercises: sqlite.exercises,
  exercise_tags: sqlite.exerciseTags,
  workout_sets: sqlite.workoutSets,
  cycles: sqlite.cycles,
  cycle_goals: sqlite.cycleGoals,
} as const satisfies Record<SyncedTable, unknown>;

describe('parzystość schematów PostgreSQL i SQLite', () => {
  it.each(SYNCED_TABLES)('tabela %s ma te same kolumny po obu stronach', (table) => {
    const fromPg = getPgTableConfig(PG_TABLES[table])
      .columns.map((column) => column.name)
      .sort();
    const fromSqlite = getSqliteTableConfig(SQLITE_TABLES[table])
      .columns.map((column) => column.name)
      .sort();

    expect(fromSqlite).toEqual(fromPg);
  });

  it.each(SYNCED_TABLES)('tabela %s ma te same kolumny wymagane', (table) => {
    const required = (names: { name: string; notNull: boolean }[]) =>
      names
        .filter((column) => column.notNull)
        .map((column) => column.name)
        .sort();

    const fromPg = required(getPgTableConfig(PG_TABLES[table]).columns);
    const fromSqlite = required(getSqliteTableConfig(SQLITE_TABLES[table]).columns);

    // Jedyny dopuszczony wyjątek: `server_seq` nadaje serwer, więc na telefonie
    // bywa pusty — wiersz utworzony offline jeszcze go nie dostał.
    expect(fromSqlite).toEqual(fromPg.filter((column) => column !== 'server_seq'));
  });

  it('tabela użytkowników jest po stronie telefonu świadomie węższa', () => {
    const server = getPgTableConfig(pg.users).columns.map((column) => column.name);
    const phone = getSqliteTableConfig(sqlite.users).columns.map((column) => column.name);

    // Telefon potrzebuje nicków do rekordów globalnych, a nie danych logowania.
    expect(phone).toEqual(expect.arrayContaining(['id', 'email', 'nickname', 'role']));
    expect(phone).not.toContain('email_verified');
    expect(server).toEqual(expect.arrayContaining(['banned', 'ban_reason', 'ban_expires']));
  });
});
