/**
 * `pnpm --filter api export` — archiwum systemowe na standardowe wyjście.
 *
 * To pierwsze ogniwo kopii zapasowej:
 *
 * ```
 * pnpm --filter api export | gzip | age -r age1... > alphapump-$(date +%F).json.gz.age
 * ```
 *
 * Stąd wynikają dwie decyzje. Archiwum idzie na **stdout**, żeby dało się je
 * wpuścić w potok bez pliku tymczasowego — plik tymczasowy z pełną historią
 * treningową wszystkich osób leżałby niezaszyfrowany na dysku minipc. A wszystkie
 * komunikaty idą na **stderr**, bo inaczej wylądowałyby w środku JSON-a
 * i zaszyfrowana kopia byłaby nie do sparsowania.
 *
 * Skrypt nie ma uwierzytelnienia i mieć nie powinien: uruchamia go cron na
 * maszynie, która ma dostęp do bazy, a więc i tak może wszystko. Uprawnienia
 * pilnuje endpoint `GET /export`, przez który idą ludzie.
 */

import { archiveSummary } from '@alphapump/core';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';
import { exportArchive } from '../transfer/index.js';

export async function runExport(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    const archive = await exportArchive(connection.db, { kind: 'system' });
    const summary = archiveSummary(archive);

    process.stdout.write(`${JSON.stringify(archive)}\n`);
    process.stderr.write(
      `Wyeksportowano: ${String(summary.users)} kont, ${String(summary.tags)} tagów, ` +
        `${String(summary.exercises)} ćwiczeń, ${String(summary.sets)} serii, ` +
        `${String(summary.cycles)} cykli.\n`,
    );
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runExport();
}
