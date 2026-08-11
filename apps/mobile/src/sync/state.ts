/**
 * Kursor i ślad po ostatniej wymianie danych.
 *
 * Kursor `server_seq` musi przeżyć restart aplikacji — urządzenie, które
 * zaczyna od zera przy każdym uruchomieniu, przy każdym uruchomieniu ściąga też
 * całą historię. Trzymamy go w bazie, a nie w magazynie klucz-wartość, bo wtedy
 * przesuwa się **w tej samej transakcji**, w której zapisują się wiersze paczki:
 * przerwany pull nie zostawia kursora ani przed danymi, ani za nimi.
 */

import {
  SYNC_STATE_ID,
  syncState,
  type SqliteDatabase,
  type SyncStateRow,
} from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';

const EMPTY: SyncStateRow = {
  id: SYNC_STATE_ID,
  cursor: 0,
  pulledAt: null,
  pushedAt: null,
  lastError: null,
};

/** Czyta stan; brak wiersza znaczy „to urządzenie jeszcze się nie synchronizowało". */
export async function readSyncState(db: SqliteDatabase): Promise<SyncStateRow> {
  const [row] = await db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).limit(1);
  return row ?? EMPTY;
}

async function upsert(db: SqliteDatabase, patch: Partial<SyncStateRow>): Promise<void> {
  await db
    .insert(syncState)
    .values({ ...EMPTY, ...patch })
    .onConflictDoUpdate({ target: syncState.id, set: patch });
}

/**
 * Przesuwa kursor. Wołane wewnątrz transakcji zapisującej paczkę — kursor przed
 * danymi znaczyłby wiersze pominięte na zawsze, a za danymi ich powtórne
 * pobieranie w kółko.
 */
export async function writeCursor(db: SqliteDatabase, cursor: number, at: Date): Promise<void> {
  await upsert(db, { cursor, pulledAt: at, lastError: null });
}

export async function markPushed(db: SqliteDatabase, at: Date): Promise<void> {
  await upsert(db, { pushedAt: at, lastError: null });
}

/** `null` kasuje ślad po błędzie — pierwsza udana wymiana zamyka sprawę. */
export async function markError(db: SqliteDatabase, message: string | null): Promise<void> {
  await upsert(db, { lastError: message });
}
