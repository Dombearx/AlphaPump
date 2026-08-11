/**
 * Rozszerzenia PostgreSQL — trzy listy, które muszą się pokrywać.
 *
 * Rozszerzenie występuje w projekcie w trzech miejscach: jako stała
 * `PG_EXTENSIONS` w schemacie, jako `CREATE EXTENSION` w migracji i jako moduł
 * wkompilowany do PGlite w testach. Rozjazd między nimi daje awarię, która
 * wygląda na przypadkową: migracja przechodzi na minipc i wywala się w CI albo
 * odwrotnie. Ten test zamienia ją w czytelną porażkę na liście nazw.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pgMigrationsFolder } from '../src/migrations.js';
import { PG_EXTENSIONS } from '../src/tables.js';
import { PGLITE_EXTENSIONS } from './databases.js';

const migrationSql = readdirSync(pgMigrationsFolder)
  .filter((entry) => entry.endsWith('.sql'))
  .map((entry) => readFileSync(join(pgMigrationsFolder, entry), 'utf8'))
  .join('\n');

describe('rozszerzenia PostgreSQL', () => {
  it.each(PG_EXTENSIONS)('migracje włączają rozszerzenie %s', (name) => {
    expect(migrationSql).toMatch(new RegExp(`CREATE EXTENSION IF NOT EXISTS ${name}\\b`));
  });

  it('testy ładują dokładnie te rozszerzenia, których wymaga schemat', () => {
    expect(Object.keys(PGLITE_EXTENSIONS).sort()).toEqual([...PG_EXTENSIONS].sort());
  });
});
