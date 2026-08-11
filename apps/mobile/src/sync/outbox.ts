/**
 * Kolejka wysyłki.
 *
 * Każdy lokalny zapis dokłada tu wpis mówiący **który wiersz** się zmienił —
 * nigdy jego treść. Treść odczytujemy dopiero przy składaniu paczki, bo między
 * edycją a odzyskaniem łączności mija dowolnie dużo czasu i wiersz zdąży się
 * zmienić jeszcze kilka razy. Wysyłanie stanu z chwili edycji oznaczałoby
 * wysyłanie wersji, której użytkownik już dawno nie widzi.
 *
 * Numer `seq` domyka wyścig między pushem a edycją: paczka zabiera wpisy do
 * zanotowanego numeru i po potwierdzeniu kasuje **tylko je**. Edycja wykonana
 * w trakcie wysyłki dostaje numer wyższy, więc przeżywa potwierdzenie i pojedzie
 * następną paczką.
 */

import { SYNC_PUSH_LIMIT, type SyncEntity } from '@alphapump/core';
import { outbox, type SqliteDatabase } from '@alphapump/db/sqlite';
import { asc, count, lte } from 'drizzle-orm';

/** Wiersz oczekujący na wysłanie, bez powtórzeń. */
export interface PendingRow {
  entity: SyncEntity;
  rowId: string;
}

export interface OutboxBatch {
  rows: PendingRow[];
  /**
   * Najwyższy numer wpisu objętego paczką. Po potwierdzeniu kasujemy wpisy
   * **do tej wartości włącznie** — nowsze zostają, bo opisują zmiany, których
   * serwer jeszcze nie widział.
   */
  highWater: number;
}

/**
 * Dokłada wpis. Wołane wewnątrz transakcji zapisującej wiersz — inaczej awaria
 * między zapisem a kolejkowaniem zostawiłaby zmianę, która nigdy nie pojedzie.
 */
export async function enqueue(
  db: SqliteDatabase,
  entity: SyncEntity,
  rowId: string,
  now: Date,
): Promise<void> {
  await db.insert(outbox).values({ entity, rowId, queuedAt: now });
}

export async function pendingCount(db: SqliteDatabase): Promise<number> {
  const [row] = await db.select({ total: count() }).from(outbox);
  return row?.total ?? 0;
}

/**
 * Składa paczkę: wpisy w kolejności numerów, sprowadzone do zbioru wierszy.
 *
 * Powtórzenia znikają, bo push wysyła pełny stan wiersza — trzy edycje tej samej
 * serii to dla serwera jeden wiersz do zapisania. Limit obowiązuje **per encja**,
 * bo tak liczy go serwer; po jego wyczerpaniu przerywamy, zamiast przeskakiwać
 * dalej, żeby `highWater` pozostał ciągły.
 */
export async function takeBatch(
  db: SqliteDatabase,
  limit: number = SYNC_PUSH_LIMIT,
): Promise<OutboxBatch> {
  const entries = await db
    .select({ seq: outbox.seq, entity: outbox.entity, rowId: outbox.rowId })
    .from(outbox)
    .orderBy(asc(outbox.seq));

  const rows: PendingRow[] = [];
  const seen = new Set<string>();
  const perEntity = new Map<SyncEntity, number>();
  let highWater = 0;

  for (const entry of entries) {
    const key = `${entry.entity}:${entry.rowId}`;

    if (!seen.has(key)) {
      const taken = perEntity.get(entry.entity) ?? 0;
      if (taken >= limit) break;
      perEntity.set(entry.entity, taken + 1);
      seen.add(key);
      rows.push({ entity: entry.entity, rowId: entry.rowId });
    }

    highWater = entry.seq;
  }

  return { rows, highWater };
}

/** Zdejmuje potwierdzone wpisy. Nowsze zostają — patrz `OutboxBatch.highWater`. */
export async function clearThrough(db: SqliteDatabase, highWater: number): Promise<void> {
  if (highWater <= 0) return;
  await db.delete(outbox).where(lte(outbox.seq, highWater));
}
