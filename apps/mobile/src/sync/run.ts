/**
 * Jedna wymiana danych: najpierw push, potem pull.
 *
 * Kolejność nie jest dowolna. Push pierwszy sprawia, że własne zmiany dostają
 * `server_seq` **przed** pobraniem paczki, więc nie wracają w niej jako obce
 * wiersze do rozstrzygania. Pull po pushu domyka obieg: urządzenie kończy
 * wymianę ze stanem, który zna serwer.
 *
 * Moduł nie ma żadnych czasomierzy i nie wie, kiedy go wołać — od tego jest
 * `engine.ts`. Tutaj jest wyłącznie to, co się dzieje w trakcie jednej wymiany,
 * dzięki czemu da się to przetestować bez zegara.
 *
 * ## Co z rekordami po pullu
 *
 * Plan wymaga „przeliczania rekordów po każdym pullu". Rekordy indywidualne nie
 * są jednak nigdzie trzymane: liczy je `@alphapump/core` z serii leżących
 * w bazie lokalnej, w chwili rysowania ekranu. Pull zapisuje serie, `useLiveQuery`
 * zauważa zapis i ekran przelicza rekordy sam — bez tabeli pochodnej, która
 * mogłaby się rozjechać z danymi źródłowymi. Tabela cache'ująca rekordy byłaby
 * tu drugim źródłem prawdy o czymś, co i tak liczy się w milisekundach.
 */

import type { SyncResult } from '@alphapump/core';
import type { SqliteDatabase } from '@alphapump/db/sqlite';
import { withTransaction } from '../db/transaction';
import { applyChanges } from './apply';
import { clearThrough, takeBatch } from './outbox';
import { buildPushRequest, isEmptyPush, withoutIncompleteRows } from './payload';
import { markPushed, readSyncState, writeCursor } from './state';
import type { SyncTransport } from './transport';

export interface SyncRunOptions {
  db: SqliteDatabase;
  transport: SyncTransport;
  deviceId: string;
  /**
   * Bezpiecznik pętli pullu. Paczka schodzi po 500 wierszy, więc domyślna
   * wartość przepuszcza pierwsze pobranie całej biblioteki i historii, a wciąż
   * nie pozwala kręcić się w nieskończoność, gdyby serwer przestał przesuwać
   * kursor.
   */
  maxPullBatches?: number;
}

export interface SyncRunResult {
  /** Wiersze wysłane na serwer. */
  pushed: number;
  /** Wiersze zapisane lokalnie z paczek pullu. */
  pulled: number;
  /** Wiersze, których serwer nie przyjął — patrz `SyncResult.reason`. */
  rejected: SyncResult[];
  cursor: number;
}

const DEFAULT_MAX_PULL_BATCHES = 50;

export async function runSync(options: SyncRunOptions): Promise<SyncRunResult> {
  const { db, transport, deviceId } = options;
  const rejected: SyncResult[] = [];

  const pushed = await push(db, transport, deviceId, rejected);
  const { pulled, cursor } = await pull(
    db,
    transport,
    options.maxPullBatches ?? DEFAULT_MAX_PULL_BATCHES,
  );

  return { pushed, pulled, rejected, cursor };
}

/**
 * Wysyła to, co czeka w outboxie.
 *
 * Odpowiedź stosujemy lokalnie tą samą ścieżką co paczkę pullu — serwer przycina
 * znaczniki czasu z przyszłości, więc **przyjęty** wiersz też potrafi wrócić
 * inny, niż pojechał.
 *
 * Wiersze odrzucone przez serwer i tak znikają z kolejki. Zostawienie ich
 * zatrzymałoby outbox na zawsze: skoro serwer odrzucił wiersz z powodu uprawnień
 * albo niespójnych danych, odrzuci go też za dziesiątym razem, a kolejka za nim
 * przestałaby się ruszać.
 */
async function push(
  db: SqliteDatabase,
  transport: SyncTransport,
  deviceId: string,
  rejected: SyncResult[],
): Promise<number> {
  const batch = await takeBatch(db);
  if (batch.rows.length === 0) return 0;

  const request = withoutIncompleteRows(await buildPushRequest(db, deviceId, batch.rows));

  if (isEmptyPush(request)) {
    // Wpisy wskazywały na wiersze, których już nie ma — nie ma czego wysyłać,
    // ale kolejkę trzeba oczyścić, inaczej zostanie w niej martwy ogon.
    await withTransaction(db, () => clearThrough(db, batch.highWater));
    return 0;
  }

  const response = await transport.push(request);
  rejected.push(...response.results.filter((result) => result.decision === 'rejected'));

  const now = new Date(response.serverTime);
  await withTransaction(
    db,
    async () => {
      await applyChanges(db, response.changes);
      await clearThrough(db, batch.highWater);
      await markPushed(db, now);
    },
    { deferForeignKeys: true },
  );

  return batch.rows.length;
}

/**
 * Pobiera zmiany od kursora, paczka po paczce, aż serwer przestanie zgłaszać,
 * że jest jeszcze co pobierać.
 *
 * Każda paczka zapisuje się **razem z kursorem**, w jednej transakcji. Kursor
 * przesunięty osobno mógłby wyprzedzić dane (przy awarii zapisu wiersze
 * przepadłyby bezpowrotnie) albo zostać za nimi (paczka wracałaby w kółko).
 */
async function pull(
  db: SqliteDatabase,
  transport: SyncTransport,
  maxBatches: number,
): Promise<{ pulled: number; cursor: number }> {
  let cursor = (await readSyncState(db)).cursor;
  let pulled = 0;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const response = await transport.pull(cursor);

    const at = new Date(response.serverTime);
    const outcome = await withTransaction(
      db,
      async () => {
        const applied = await applyChanges(db, response.changes);
        await writeCursor(db, response.cursor, at);
        return applied;
      },
      { deferForeignKeys: true },
    );

    pulled += outcome.written;

    // Kursor, który nie ruszył mimo `hasMore`, znaczy, że serwer podaje paczkę
    // bez postępu. Kolejne żądanie przywiozłoby dokładnie to samo.
    const stalled = response.cursor <= cursor;
    cursor = response.cursor;
    if (!response.hasMore || stalled) break;
  }

  return { pulled, cursor };
}
