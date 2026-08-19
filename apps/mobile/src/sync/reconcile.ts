/**
 * Bezpiecznik kolejki wysyłki: żaden zapis nie znika po cichu.
 *
 * ## Problem
 *
 * Outbox jest kolejką **zmian**, a nie stanu. Wpis z niej schodzi po tym, jak
 * paczka wróci z serwera — i schodzi także wtedy, gdy serwer wiersza nie
 * przyjął. Musi, bo inaczej jedna zatruta mutacja zatrzymałaby synchronizację
 * urządzenia na zawsze. Cena jest jednak taka, że każde odrzucenie i każde
 * odsianie wiersza przy składaniu paczki (`withoutIncompleteRows`, przycięcie
 * zależności do limitu) to zapis, o którym nikt już nigdy nie wróci — a zapis
 * to tutaj seria treningowa.
 *
 * Dokładnie to wydarzyło się z seriami zapisanymi na ćwiczeniach wbudowanych na
 * serwerze bez seeda: serwer odrzucał je z „Ćwiczenie serii nie istnieje",
 * telefon zdejmował je z kolejki i nic ich już nie dosyłało.
 *
 * ## Rozwiązanie
 *
 * Baza lokalna niesie odpowiedź na pytanie „czy serwer o tym wierszu wie":
 * `server_seq` jest pusty dokładnie do chwili, w której serwer wiersz
 * potwierdzi (i dostaje go nawet wiersz, który przegrał LWW — patrz `apply.ts`).
 * Wiersz żywy, bez `server_seq` i bez wpisu w outboxie, jest więc zapisem
 * zgubionym — niezależnie od tego, na którym kroku się zgubił.
 *
 * `reconcile` szuka takich wierszy po każdej udanej wymianie i wstawia je
 * z powrotem do kolejki. Dzięki temu wszystkie ścieżki „ten wiersz tym razem
 * nie pojedzie" wolno mieć: najgorsze, co się może stać, to jedna wymiana
 * opóźnienia.
 *
 * Przebieg leci **po pullu**, nie przed: pull dowozi `server_seq` wierszom,
 * które serwer zna (choćby całej bibliotece wbudowanej po zaseedowaniu
 * serwera), więc przebieg po nim nie kolejkuje niczego, co i tak jest na
 * miejscu.
 *
 * ## Dlaczego to nie kręci się w kółko
 *
 * Wiersz, którego serwer nie chce z powodu, który sam nie minie (cudze
 * ćwiczenie, niespójne dane), wracałby do kolejki przy każdej wymianie.
 * Dlatego odrzucenia lądują w `sync_rejections` z rosnącym odstępem: minuta,
 * pięć, pół godziny, dwie godziny, doba. Wiersz nie do przyjęcia kosztuje więc
 * jedno miejsce w paczce na dobę, a wiersz, którego powód odrzucenia da się
 * naprawić po stronie serwera, wraca sam, gdy odstęp minie.
 */

import { SYNC_ENTITIES, type SyncEntity, type SyncResult } from '@alphapump/core';
import {
  cycles,
  exercises,
  outbox,
  syncRejections,
  tags,
  workoutSets,
  type SqliteDatabase,
  type SyncRejectionRow,
} from '@alphapump/db/sqlite';
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { withTransaction } from '../db/transaction';
import { enqueue } from './outbox';

/**
 * Odstęp przed kolejną próbą, po pierwszym, drugim… odrzuceniu. Ostatnia
 * wartość obowiązuje dalej — powód, który przetrwał dobę, nie zniknie od
 * częstszego pukania.
 */
const BACKOFF_MS = [60_000, 5 * 60_000, 30 * 60_000, 2 * 3_600_000, 24 * 3_600_000] as const;

const TABLES = {
  tag: tags,
  exercise: exercises,
  cycle: cycles,
  set: workoutSets,
} as const;

/** Kolumny, których potrzebuje przebieg — te same w każdej tabeli domenowej. */
type SyncedColumns = (typeof TABLES)[SyncEntity];

const key = (entity: SyncEntity, rowId: string): string => `${entity}:${rowId}`;

function backoffFor(attempts: number): number {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
}

/**
 * Zapisuje odrzucenia z jednej wymiany. Wiersz odrzucony ponownie dostaje
 * dłuższy odstęp, a nie nowy wpis — inaczej licznik prób nigdy by nie urósł.
 */
export async function recordRejections(
  db: SqliteDatabase,
  results: readonly SyncResult[],
  now: Date,
): Promise<void> {
  if (results.length === 0) return;

  const seen = await db.select().from(syncRejections);
  const attemptsOf = new Map(seen.map((row) => [key(row.entity, row.rowId), row.attempts]));

  for (const result of results) {
    const attempts = (attemptsOf.get(key(result.entity, result.id)) ?? 0) + 1;
    const values = {
      entity: result.entity,
      rowId: result.id,
      reason: result.reason,
      attempts,
      rejectedAt: now,
      retryAfter: new Date(now.getTime() + backoffFor(attempts)),
    };

    await db
      .insert(syncRejections)
      .values(values)
      .onConflictDoUpdate({
        target: [syncRejections.entity, syncRejections.rowId],
        set: values,
      });
  }
}

/** Wiersze, których serwer nie przyjął i które wciąż czekają na kolejną próbę. */
export async function stuckRows(db: SqliteDatabase): Promise<SyncRejectionRow[]> {
  return await db.select().from(syncRejections);
}

/**
 * Wstawia do kolejki wiersze, o których serwer nie wie, a które nigdzie nie
 * czekają. Zwraca, ile ich było — zero jest normalnym wynikiem.
 */
export async function reconcile(db: SqliteDatabase, now: Date): Promise<number> {
  await forgetSettled(db);

  const queued = await db
    .select({ entity: outbox.entity, rowId: outbox.rowId })
    .from(outbox)
    .groupBy(outbox.entity, outbox.rowId);
  const waiting = new Set(queued.map((row) => key(row.entity, row.rowId)));

  const held = await db
    .select({ entity: syncRejections.entity, rowId: syncRejections.rowId })
    .from(syncRejections)
    .where(gt(syncRejections.retryAfter, now));
  for (const row of held) waiting.add(key(row.entity, row.rowId));

  const missing: { entity: SyncEntity; rowId: string }[] = [];
  for (const entity of SYNC_ENTITIES) {
    const table: SyncedColumns = TABLES[entity];
    // Wiersz usunięty lokalnie i nigdy niepotwierdzony nie ma po co jechać:
    // serwer nigdy o nim nie słyszał, więc nie ma czego u siebie kasować.
    const rows = await db
      .select({ id: table.id })
      .from(table)
      .where(and(isNull(table.serverSeq), isNull(table.deletedAt)));

    for (const row of rows) {
      if (!waiting.has(key(entity, row.id))) missing.push({ entity, rowId: row.id });
    }
  }

  if (missing.length === 0) return 0;

  await withTransaction(db, async () => {
    for (const row of missing) await enqueue(db, row.entity, row.rowId, now);
  });

  return missing.length;
}

/**
 * Sprząta kwarantannę z wierszy, dla których nie ma już czego ponawiać: serwer
 * je w końcu przyjął, użytkownik je skasował albo zniknęły z bazy lokalnej.
 * Bez tego licznik „serwer nie przyjął" pokazywałby historię zamiast stanu.
 */
async function forgetSettled(db: SqliteDatabase): Promise<void> {
  const records = await db.select().from(syncRejections);
  if (records.length === 0) return;

  const settled: { entity: SyncEntity; rowId: string }[] = [];

  for (const entity of SYNC_ENTITIES) {
    const ids = records.filter((row) => row.entity === entity).map((row) => row.rowId);
    if (ids.length === 0) continue;

    const table: SyncedColumns = TABLES[entity];
    const alive = await db
      .select({ id: table.id })
      .from(table)
      .where(and(inArray(table.id, ids), isNull(table.serverSeq), isNull(table.deletedAt)));
    const pending = new Set(alive.map((row) => row.id));

    for (const id of ids) if (!pending.has(id)) settled.push({ entity, rowId: id });
  }

  for (const row of settled) {
    await db
      .delete(syncRejections)
      .where(and(eq(syncRejections.entity, row.entity), eq(syncRejections.rowId, row.rowId)));
  }
}
