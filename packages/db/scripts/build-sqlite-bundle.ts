/**
 * Zapieczętowanie migracji SQLite w module TypeScript.
 *
 * Na telefonie nie ma systemu plików, z którego migrator mógłby czytać katalog
 * z SQL-em — bundler musi zobaczyć te zapytania jako zwykły kod. Drizzle-kit
 * potrafi wypluć taki plik przy okazji generowania nowej migracji, ale **tylko
 * wtedy**: przy niezmienionym schemacie kończy na „nothing to migrate" i pliku
 * nie dotyka. Bundle wyliczony osobno jest zawsze aktualny względem katalogu
 * migracji, a `tests/sqlite-bundle.test.ts` pilnuje, że nikt nie zapomniał go
 * przegenerować.
 *
 * Alternatywą był `babel-plugin-inline-import` z `.sql` w `sourceExts` Metro —
 * czyli dwie konfiguracje bundlera do utrzymania po to, żeby dostać to samo.
 *
 * Uruchamianie: `pnpm --filter @alphapump/db generate:bundle`.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const MIGRATIONS = fileURLToPath(new URL('../migrations/sqlite', import.meta.url));
const OUTPUT = fileURLToPath(new URL('../src/sqlite/migrations-bundle.ts', import.meta.url));

interface JournalEntry {
  idx: number;
  when: number;
  tag: string;
  breakpoints: boolean;
}

export interface MigrationBundle {
  journal: { entries: JournalEntry[] };
  /** Klucz `m0000`, `m0001`, … — takiego układu oczekuje migrator Drizzle. */
  migrations: Record<string, string>;
}

/** Czyta katalog migracji i składa bundle w pamięci. */
export function readSqliteBundle(directory: string = MIGRATIONS): MigrationBundle {
  const journal = JSON.parse(
    readFileSync(join(directory, 'meta', '_journal.json'), 'utf8'),
  ) as MigrationBundle['journal'];

  const files = new Set(readdirSync(directory).filter((name) => name.endsWith('.sql')));
  const migrations: Record<string, string> = {};

  for (const entry of journal.entries) {
    const file = `${entry.tag}.sql`;
    if (!files.has(file)) throw new Error(`Brak pliku migracji ${file} wskazanego w dzienniku`);
    migrations[`m${String(entry.idx).padStart(4, '0')}`] = readFileSync(
      join(directory, file),
      'utf8',
    );
  }

  return { journal, migrations };
}

export function renderBundle(bundle: MigrationBundle): string {
  const entries = Object.entries(bundle.migrations)
    .map(([key, sql]) => `  ${key}: ${JSON.stringify(sql)},`)
    .join('\n');

  return `/**
 * Migracje SQLite w formie, którą widzi bundler aplikacji mobilnej.
 *
 * PLIK GENEROWANY — nie edytuj ręcznie. Powstaje z katalogu
 * \`migrations/sqlite\` poleceniem \`pnpm --filter @alphapump/db generate:bundle\`,
 * a test \`tests/sqlite-bundle.test.ts\` sprawdza, że jest aktualny.
 */

export interface SqliteMigrationBundle {
  journal: {
    entries: {
      idx: number;
      when: number;
      tag: string;
      breakpoints: boolean;
      [key: string]: unknown;
    }[];
    [key: string]: unknown;
  };
  /** Klucz \`m0000\`, \`m0001\`, … — takiego układu oczekuje migrator Drizzle. */
  migrations: Record<string, string>;
}

export const sqliteMigrationBundle: SqliteMigrationBundle = {
  journal: ${JSON.stringify(bundle.journal, null, 2).replace(/\n/g, '\n  ')},
  migrations: {
${entries}
  },
};

export default sqliteMigrationBundle;
`;
}

function main(): void {
  const bundle = readSqliteBundle();
  writeFileSync(OUTPUT, renderBundle(bundle), 'utf8');
  // eslint-disable-next-line no-console -- skrypt narzędziowy raportuje wynik
  console.log(`Zapisano ${Object.keys(bundle.migrations).length} migracji do ${OUTPUT}`);
}

/** Uruchomienie jako skrypt zapisuje plik; import w teście tylko udostępnia funkcje. */
if (import.meta.filename === process.argv[1]) main();
