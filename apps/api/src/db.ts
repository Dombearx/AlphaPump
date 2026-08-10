/**
 * Połączenie z bazą.
 *
 * Migracje uruchamiane są z paczki `@alphapump/db`, a nie z kopii w aplikacji —
 * ten sam zestaw plików SQL przechodzi w testach, w CI i na minipc.
 *
 * `Database` jest celowo typem bazowym Drizzle, a nie typem konkretnego
 * sterownika: produkcja jedzie po `node-postgres`, a testy integracyjne po
 * PGlite. Jeden typ dla obu znaczy, że testy sprawdzają dokładnie ten kod,
 * który pojedzie na serwerze.
 */

import { pgMigrationsFolder } from '@alphapump/db/migrations';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { schema, type Schema } from './schema.js';

export type Database = PgDatabase<PgQueryResultHKT, Schema>;

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export function createDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  const db = drizzle(pool, { schema });
  return { db: db as unknown as Database, close: () => pool.end() };
}

/** Migracje po stronie `node-postgres`; testy wołają migrator swojego sterownika. */
export async function runMigrations(connection: DatabaseConnection): Promise<void> {
  await migrate(connection.db as unknown as Parameters<typeof migrate>[0], {
    migrationsFolder: pgMigrationsFolder,
  });
}
