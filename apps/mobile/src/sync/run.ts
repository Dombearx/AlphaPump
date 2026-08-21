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

import type { SyncPushRequest, SyncResult } from '@alphapump/core';
import type { SqliteDatabase } from '@alphapump/db/sqlite';
import { withTransaction } from '../db/transaction';
import { applyChanges } from './apply';
import { clearThrough, enqueue, takeBatch, type PendingRow } from './outbox';
import { buildPushRequest, isEmptyPush, rowExists, withoutIncompleteRows } from './payload';
import { reconcile, recordRejections } from './reconcile';
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
  /** Wiersze wstawione z powrotem do kolejki przez `reconcile`. */
  requeued: number;
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
  // Dopiero po pullu: to on dowozi `server_seq` wierszom, które serwer już zna,
  // więc przebieg przed nim kolejkowałby bibliotekę, która właśnie przyjechała.
  const requeued = await reconcile(db, new Date());

  return { pushed, pulled, rejected, requeued, cursor };
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
 * przestałaby się ruszać. Nie znaczy to, że wiersz przepada — odrzucenie idzie
 * do kwarantanny (`reconcile.ts`), skąd wraca do kolejki, gdy minie odstęp.
 *
 * ## Wiersze, które **nie pojechały**, wracają do kolejki
 *
 * Paczka bywa przycięta jeszcze przed wysłaniem: `withoutIncompleteRows` odsiewa
 * cykl bez pozycji celu, a `withDependencies` — serie i cykle, których zależność
 * nie zmieściła się w limicie. Takiego wiersza serwer nigdy nie widział, więc nie
 * ma go ani w odpowiedzi, ani w kwarantannie.
 *
 * `clearThrough` kasował mimo to **cały** odcinek kolejki do `highWater`, razem
 * z jego wpisem. Bezpiecznik `reconcile` tego nie łapał, bo szuka wyłącznie
 * wierszy z pustym `server_seq` — czyli takich, o których serwer nigdy nie
 * słyszał. Edycja wiersza **już potwierdzonego**, odsiana przy składaniu paczki,
 * przepadała więc po cichu i na zawsze.
 *
 * Dlatego odsiane wiersze wracają do kolejki w tej samej transakcji, w której
 * odcinek jest kasowany. Dostają nowy numer, więc pojadą następną paczką — a że
 * `push` zwraca liczbę wierszy, które **faktycznie** pojechały, silnik nie
 * zapętla się na paczce, z której nie da się wysłać niczego.
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
  const sent = rowsInRequest(request);
  const dropped = batch.rows.filter((row) => !sent.has(`${row.entity}:${row.rowId}`));

  if (isEmptyPush(request)) {
    // Wpisy wskazywały na wiersze, których już nie ma albo których nie da się
    // w tej chwili wysłać. Kolejkę trzeba oczyścić, inaczej zostanie w niej
    // martwy ogon — ale to, co da się jeszcze wysłać, wraca do niej z nowym
    // numerem.
    await withTransaction(db, async () => {
      await clearThrough(db, batch.highWater);
      await requeue(db, dropped, new Date());
    });
    return 0;
  }

  const response = await transport.push(request);
  const refused = response.results.filter((result) => result.decision === 'rejected');
  rejected.push(...refused);

  const now = new Date(response.serverTime);
  await withTransaction(
    db,
    async () => {
      await applyChanges(db, response.changes);
      await recordRejections(db, refused, now);
      await clearThrough(db, batch.highWater);
      await requeue(db, dropped, now);
      await markPushed(db, now);
    },
    { deferForeignKeys: true },
  );

  return batch.rows.length - dropped.length;
}

/** Klucze wierszy, które faktycznie weszły do paczki. */
function rowsInRequest(request: SyncPushRequest): Set<string> {
  return new Set([
    ...request.tags.map((row) => `tag:${row.id}`),
    ...request.exercises.map((row) => `exercise:${row.id}`),
    ...request.cycles.map((row) => `cycle:${row.id}`),
    ...request.sets.map((row) => `set:${row.id}`),
  ]);
}

/**
 * Wstawia z powrotem do kolejki wiersze, które z paczki wypadły.
 *
 * Wiersz, którego już nie ma w bazie, nie wraca: `buildPushRequest` pomija
 * wiersze usunięte trwale, a kolejkowanie ich w kółko dałoby wpis, który nigdy
 * nie zejdzie.
 */
async function requeue(db: SqliteDatabase, rows: readonly PendingRow[], now: Date): Promise<void> {
  for (const row of rows) {
    if (await rowExists(db, row)) await enqueue(db, row.entity, row.rowId, now);
  }
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
