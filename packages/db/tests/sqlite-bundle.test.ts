/**
 * Bundle migracji dla telefonu.
 *
 * Aplikacja mobilna nie czyta katalogu migracji z dysku — dostaje je jako
 * moduł, który widzi bundler. Ten test pilnuje dwóch rzeczy, których nie widać
 * inaczej niż na urządzeniu:
 *
 * 1. **Bundle jest aktualny.** Nowa migracja bez przegenerowania bundle'a
 *    znaczy telefon, który zostaje ze starym schematem i wywala się przy
 *    pierwszym zapisie do nieistniejącej kolumny.
 * 2. **Bundle daje ten sam schemat co pliki.** Gdyby dziennik i katalog
 *    rozjechały się kolejnością albo treścią, baza lokalna różniłaby się od
 *    tej, na której przechodzą testy migracji.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import BetterSqlite3 from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { readSqliteBundle, renderBundle } from '../scripts/build-sqlite-bundle.js';
import { sqliteMigrationBundle } from '../src/sqlite/migrations-bundle.js';
import { SYNCED_TABLES } from '../src/tables.js';
import { createTestSqlite } from './databases.js';

const GENERATED = fileURLToPath(new URL('../src/sqlite/migrations-bundle.ts', import.meta.url));

/** Uruchamia bundle tak, jak zrobi to migrator Drizzle na telefonie. */
function applyBundle(client: BetterSqlite3.Database): void {
  for (const entry of sqliteMigrationBundle.journal.entries) {
    const sql = sqliteMigrationBundle.migrations[`m${String(entry.idx).padStart(4, '0')}`];
    expect(sql, entry.tag).toBeTypeOf('string');
    for (const statement of (sql as string).split('--> statement-breakpoint')) {
      client.exec(statement);
    }
  }
}

function tableNames(client: BetterSqlite3.Database): string[] {
  return client
    .prepare<[], { name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((row) => row.name)
    .sort();
}

function columnNames(client: BetterSqlite3.Database, table: string): string[] {
  return client
    .prepare<[], { name: string }>(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => row.name)
    .sort();
}

describe('bundle migracji SQLite', () => {
  it('jest aktualny względem katalogu migracji', () => {
    // Czerwony test znaczy jedno: `pnpm --filter @alphapump/db generate:bundle`.
    expect(readFileSync(GENERATED, 'utf8')).toBe(renderBundle(readSqliteBundle()));
  });

  it('zawiera każdy wpis dziennika', () => {
    const keys = Object.keys(sqliteMigrationBundle.migrations).sort();
    expect(keys).toHaveLength(sqliteMigrationBundle.journal.entries.length);
    for (const entry of sqliteMigrationBundle.journal.entries) {
      expect(keys).toContain(`m${String(entry.idx).padStart(4, '0')}`);
    }
  });

  it('daje na czystej bazie ten sam schemat co migracje z plików', () => {
    const fromFiles = createTestSqlite();
    const client = new BetterSqlite3(':memory:');

    try {
      applyBundle(client);

      expect(tableNames(client)).toEqual(
        tableNames(fromFiles.client).filter((name) => name !== '__drizzle_migrations'),
      );
      for (const table of [...SYNCED_TABLES, 'users']) {
        expect(columnNames(client, table), table).toEqual(columnNames(fromFiles.client, table));
      }
    } finally {
      client.close();
      fromFiles.close();
    }
  });
});
