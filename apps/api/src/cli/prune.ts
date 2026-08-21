/**
 * `pnpm --filter api prune` — zadania porządkowe, które inaczej nikt nie odpala.
 *
 * Dwie rzeczy rosną w tej bazie bez końca i obie mają już endpoint w panelu:
 * tombstone'y (`POST /sync/tombstones/prune`) i cache odpowiedzi re-rankera
 * (`POST /admin/duplicate-cache/prune`). Endpoint wymaga jednak, żeby ktoś
 * pamiętał o kliknięciu — a objawem zapomnienia jest baza pełna wierszy, których
 * nikt już nigdy nie zobaczy, zauważona po fakcie.
 *
 * Stąd CLI obok endpointów, a nie zamiast nich: cron na minipc woła je tą samą
 * drogą co eksport kopii (`docker compose exec -T api …`), bez sesji i bez roli,
 * bo maszyna z dostępem do bazy i tak może wszystko. Uprawnień pilnują endpointy,
 * przez które idą ludzie.
 *
 * Okno retencji tombstone'ów **nie jest** parametrem kosmetycznym — patrz
 * `src/sync/tombstones.ts`. Urządzenie offline dłużej niż okno nigdy nie dowie
 * się o usunięciu, więc wartość domyślna jest z dużym zapasem i zmienia się ją
 * świadomie, argumentem.
 */

import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';
import { DEFAULT_CACHE_RETENTION_DAYS, pruneCache } from '../duplicates/index.js';
import {
  DEFAULT_TOMBSTONE_RETENTION_DAYS,
  pruneTombstones,
  retentionCutoff,
} from '../sync/tombstones.js';

/** Liczba dni z argumentu wiersza poleceń albo wartość domyślna. */
export function retentionDays(argument: string | undefined, fallback: number): number {
  if (argument === undefined) return fallback;
  const parsed = Number.parseInt(argument, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`Okno retencji musi być dodatnią liczbą dni, jest: ${argument}`);
  }
  return parsed;
}

export async function runPrune(argv: readonly string[] = process.argv.slice(2)): Promise<void> {
  const tombstoneDays = retentionDays(argv[0], DEFAULT_TOMBSTONE_RETENTION_DAYS);
  const cacheDays = retentionDays(argv[1], DEFAULT_CACHE_RETENTION_DAYS);

  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    const removed = await pruneTombstones(
      connection.db,
      retentionCutoff(tombstoneDays, new Date()),
    );
    const cached = await pruneCache(connection.db, cacheDays);

    process.stdout.write(
      `Zdjęto tombstone'y starsze niż ${String(tombstoneDays)} dni: ` +
        `${String(removed.sets)} serii, ${String(removed.cycles)} cykli, ` +
        `${String(removed.exercises)} ćwiczeń, ${String(removed.tags)} tagów.\n` +
        `Zdjęto wpisy cache'u re-rankera starsze niż ${String(cacheDays)} dni: ` +
        `${String(cached)}.\n`,
    );
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runPrune();
}
