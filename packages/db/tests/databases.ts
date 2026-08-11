/**
 * Bazy testowe — czysty Postgres i czysty plik SQLite, stawiane od zera.
 *
 * Postgres jest tu PGlite: prawdziwy silnik Postgresa skompilowany do WASM,
 * uruchamiany w procesie testu. Dzięki temu „migracje przechodzą na czystej
 * bazie Postgres" jest sprawdzane w CI przy każdym PR-ze, bez usługi obok
 * — a sprawdzane jest tym samym SQL-em, który pojedzie na minipc.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';
import BetterSqlite3 from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { migrate as migrateSqlite } from 'drizzle-orm/better-sqlite3/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/pglite';
import { migrate as migratePg } from 'drizzle-orm/pglite/migrator';
import { pgMigrationsFolder, sqliteMigrationsFolder } from '../src/migrations.js';

export interface TestPostgres {
  db: ReturnType<typeof drizzlePg>;
  client: PGlite;
  close: () => Promise<void>;
}

/**
 * Rozszerzenia ładowane do PGlite.
 *
 * PGlite nie ma menedżera pakietów — rozszerzenie musi być wkompilowane przy
 * tworzeniu instancji, a `CREATE EXTENSION` w migracji jedynie je **włącza**.
 * Pominięcie któregoś tutaj daje błąd w pierwszej migracji, która go używa, więc
 * lista i lista `PG_EXTENSIONS` w schemacie muszą się pokrywać — pilnuje tego
 * `tests/extensions.test.ts`.
 */
export const PGLITE_EXTENSIONS = { vector, pg_trgm } as const;

/** Świeża baza Postgres w pamięci, z uruchomionym kompletem migracji. */
export async function createTestPostgres(): Promise<TestPostgres> {
  const client = new PGlite({ extensions: PGLITE_EXTENSIONS });
  const db = drizzlePg(client);
  await migratePg(db, { migrationsFolder: pgMigrationsFolder });
  return { db, client, close: () => client.close() };
}

export interface TestSqlite {
  db: ReturnType<typeof drizzleSqlite>;
  client: BetterSqlite3.Database;
  path: string;
  close: () => void;
}

/**
 * Świeży **plik** SQLite, nie baza w pamięci — telefon też trzyma bazę
 * w pliku, a różnice bywają dokładnie w tym miejscu.
 */
export function createTestSqlite(): TestSqlite {
  const directory = mkdtempSync(join(tmpdir(), 'alphapump-sqlite-'));
  const path = join(directory, 'alphapump.db');
  const client = new BetterSqlite3(path);
  client.pragma('foreign_keys = ON');

  const db = drizzleSqlite(client);
  migrateSqlite(db, { migrationsFolder: sqliteMigrationsFolder });

  return {
    db,
    client,
    path,
    close: () => {
      client.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
