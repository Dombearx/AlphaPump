/**
 * `pnpm --filter api import <plik>` — odtworzenie danych z archiwum.
 *
 * Ostatnie ogniwo odtwarzania z kopii zapasowej:
 *
 * ```
 * age -d -i klucz.txt alphapump-2026-08-10.json.gz.age | gunzip > backup.json
 * pnpm --filter api import backup.json
 * ```
 *
 * Bez argumentu czyta ze standardowego wejścia, więc powyższe da się zapisać
 * jednym potokiem, bez pliku pośredniego.
 *
 * Import z linii poleceń działa jako **administrator**: odtwarza cudze serie
 * i zakłada brakujące konta, czego nie wolno zwykłemu użytkownikowi. Tożsamość
 * bierze z konta systemowego, bo cron nie ma i nie powinien mieć niczyich
 * poświadczeń — a uruchomienie tego skryptu wymaga dostępu do bazy, czyli
 * uprawnień szerszych niż jakakolwiek rola w aplikacji.
 */

import { readFile } from 'node:fs/promises';
import { SYSTEM_USER } from '@alphapump/db';
import { parseArchive } from '@alphapump/core';
import { seedPostgres } from '@alphapump/db/pg';
import { loadConfig } from '../config.js';
import { createDatabase, runMigrations } from '../db.js';
import { importArchive } from '../transfer/index.js';

async function readInput(path: string | undefined): Promise<string> {
  if (path !== undefined) return readFile(path, 'utf8');

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function runImport(path = process.argv[2]): Promise<void> {
  const config = loadConfig();
  const raw = await readInput(path);
  const archive = parseArchive(JSON.parse(raw));

  const connection = createDatabase(config.databaseUrl);
  try {
    // Migracje i seed **przed** importem: odtwarzanie po awarii celuje w bazę
    // pustą, w której nie ma jeszcze ani schematu, ani konta systemowego —
    // a to ono jest autorem ćwiczeń wbudowanych. Oba kroki są idempotentne,
    // więc import do bazy działającej niczego nie rusza.
    await runMigrations(connection);
    await seedPostgres(connection.db);

    const report = await importArchive(connection.db, archive, {
      actor: { id: SYSTEM_USER.id, email: SYSTEM_USER.email, role: 'admin' },
    });

    process.stderr.write(
      `Zaimportowano: ${String(report.imported.users)} kont, ` +
        `${String(report.imported.tags)} tagów, ${String(report.imported.exercises)} ćwiczeń, ` +
        `${String(report.imported.sets)} serii, ${String(report.imported.cycles)} cykli.\n`,
    );
    if (report.remappedExercises > 0) {
      process.stderr.write(
        `Przeliczono identyfikatory ${String(report.remappedExercises)} ćwiczeń — ` +
          'ich autorzy mają w tej bazie inne identyfikatory niż w archiwum.\n',
      );
    }
    for (const note of report.notes) process.stderr.write(`Uwaga: ${note}\n`);
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runImport();
}
