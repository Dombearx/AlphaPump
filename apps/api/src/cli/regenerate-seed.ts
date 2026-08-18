/**
 * `pnpm --filter api regenerate-seed` — przenosi ręczne zmiany biblioteki
 * wbudowanej z powrotem do pliku seeda.
 *
 * Panel admina edytuje tagi i ćwiczenia konta systemowego przez te same
 * endpointy co telefon (`PATCH /exercises/:id`, `PATCH /tags/:id`) — to
 * prawdziwy zapis do Postgresa. Sync jest globalny dla tagów i ćwiczeń
 * (patrz `sync/pull.ts`), więc taka zmiana dojeżdża do każdego zalogowanego
 * urządzenia bez udziału tego skryptu.
 *
 * Ten skrypt rozwiązuje inny problem: `packages/db/src/seed/data.ts` jest
 * źródłem prawdy tylko dla **startu od zera** (świeży `seedSqlite`/`seedPostgres`
 * na pustej bazie). Bez regeneracji ręczna edycja w adminie żyje wyłącznie
 * w Postgresie — nowy deployment albo świeża instalacja telefonu offline
 * (przed pierwszym zalogowaniem) dalej dostają starą wersję z pliku.
 *
 * Odczyt danych i złożenie pliku są wspólne z endpointem panelu
 * `GET /admin/seed/export` (`../admin/seed-export.js`, `@alphapump/db`'s
 * `renderSeedDataFile`) — ten skrypt tylko woła je z bazy, do której ma
 * bezpośredni dostęp (VPN + `DATABASE_URL`), i pisze wynik prosto na dysk.
 * Panel, działający na produkcji bez repozytorium pod ręką, oddaje tę samą
 * treść do pobrania zamiast zapisywać ją na miejscu — patrz jego opis w
 * `routes/admin.ts`.
 *
 * Workflow: edytuj w panelu admina, potem uruchom ten skrypt i zacommituj
 * diff `data.ts`.
 *
 * ```
 * pnpm --filter api build
 * pnpm --filter api regenerate-seed
 * git diff packages/db/src/seed/data.ts
 * ```
 *
 * Kolejność ćwiczeń w wygenerowanym pliku jest deterministyczna (tag główny,
 * potem nazwa), nie ręcznie ułożona jak w oryginale — to jedyna różnica
 * kosmetyczna, jakiej można się spodziewać w diffie mimo braku zmian
 * treściowych.
 */

import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderSeedDataFile } from '@alphapump/db';
import { loadSeedExport } from '../admin/seed-export.js';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';

const DATA_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/src/seed/data.ts',
);

export async function runRegenerateSeed(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    const { tagNames, exercises, warnings } = await loadSeedExport(connection.db);
    await writeFile(DATA_FILE, renderSeedDataFile({ tagNames, exercises }));

    process.stderr.write(
      `Zregenerowano seed: ${String(tagNames.length)} tagów, ` +
        `${String(exercises.length)} ćwiczeń wbudowanych.\n` +
        `Uruchom "pnpm format" i sprawdź diff — kolejność ćwiczeń w pliku jest teraz ` +
        `deterministyczna (tag główny, potem nazwa), nie ręcznie ułożona.\n`,
    );
    for (const warning of warnings) process.stderr.write(`Uwaga: ${warning}\n`);
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runRegenerateSeed();
}
