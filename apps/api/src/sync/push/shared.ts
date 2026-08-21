/**
 * Wspólny kontekst przyjmowania paczki pushu.
 *
 * Cztery encje przechodzą tę samą drogę — wczytaj stan serwera, rozstrzygnij
 * konflikt, zapisz albo odrzuć, odnotuj wynik — więc różnią się wyłącznie
 * regułami, a nie szkieletem. Szkielet mieszka tutaj, żeby te reguły dało się
 * czytać osobno, po jednym pliku na encję.
 *
 * ## Wszystko w jednej transakcji
 *
 * `applyPush` obejmuje całą paczkę jedną transakcją i to jest zmiana względem
 * pierwszej wersji, w której każdy wiersz szedł osobnym zapisem. Rozstrzyganie
 * **per wiersz** nie wymaga per-wierszowego wycofania: odrzucenie nie jest
 * awarią, tylko wynikiem, a wynik zapisujemy w odpowiedzi, nie w bazie. To, co
 * per-wierszowy zapis naprawdę dawał, to stan częściowy po przerwanym żądaniu —
 * połowa paczki na serwerze, druga połowa nigdzie.
 *
 * Transakcja domyka przy okazji drugą dziurę: między `SELECT` a `UPDATE` wiersz
 * mógł zniknąć (choćby przez zadanie porządkowe tombstone'ów), a `UPDATE`, który
 * nic nie trafił, zwracał `undefined` tam, gdzie kod pisał `row!`. Wychodziło
 * z tego 500 na **całą** paczkę — w handlerze, którego głównym założeniem jest
 * „jeden wiersz nie wywraca paczki".
 */

import {
  isWrite,
  type SyncChanges,
  type SyncDecision,
  type SyncEntity,
  type SyncResult,
  type SyncRevision,
} from '@alphapump/core';
import type { Principal } from '../../context.js';
import type { Database } from '../../db.js';
import { nextServerSeq } from '../../sync-columns.js';
import type { AffectedScope } from '../derived.js';

/**
 * Uchwyt do bazy wewnątrz transakcji.
 *
 * Ten sam typ co poza nią: transakcja Drizzle jest podtypem bazy, a dzięki temu
 * predykaty w rodzaju `isTagInUse` działają w obu kontekstach bez rozgałęziania.
 */
export type Tx = Database;

export interface PushContext {
  tx: Tx;
  principal: Principal;
  deviceId: string;
  /** Zegar serwera — do przycięcia znaczników z przyszłości. */
  now: Date;
  isAdmin: boolean;
  results: SyncResult[];
  changes: SyncChanges;
  scope: AffectedScope;
  /** Podbija najwyższy `server_seq` nadany w tej paczce. */
  advance(serverSeq: number): void;
  record(entity: SyncEntity, id: string, decision: SyncDecision, reason?: string): void;
}

/** Pola, po których jedzie rozstrzyganie konfliktu, wyjęte z wiersza paczki. */
export function incomingRevision(
  row: { createdAt: string; updatedAt: string; deletedAt: string | null },
  deviceId: string,
): SyncRevision {
  return { ...row, deviceId };
}

/** Znacznik zapisu wiersza przyjętego z synchronizacji. */
export function stampFrom(revision: SyncRevision, deviceId: string) {
  return {
    createdAt: new Date(revision.createdAt),
    updatedAt: new Date(revision.updatedAt),
    deletedAt: revision.deletedAt === null ? null : new Date(revision.deletedAt),
    deviceId,
    serverSeq: nextServerSeq(),
  };
}

/** Część znacznika wspólna dla każdego zapisu — bez pól, które zależą od decyzji. */
export function writeStamp(stamp: ReturnType<typeof stampFrom>) {
  return { deviceId: stamp.deviceId, serverSeq: stamp.serverSeq };
}

export { isWrite };
