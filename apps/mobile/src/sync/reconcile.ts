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
 *
 * Jeden powód jest z tego wyjęty. Serwer przysyła teraz **kod**, a nie zdanie,
 * więc telefon widzi różnicę między „ta reguła cię nie wpuści" a „wiersz zniknął
 * mi między odczytem a zapisem". To drugie jest wyścigiem, nie rozstrzygnięciem:
 * przy następnej wymianie serwer zastanie inny stan, więc czekanie minuty jest
 * czystą stratą. Dwie takie próby pod rząd i wiersz wraca do normalnego odstępu —
 * wyścig przegrany dwa razy z rzędu przestaje być wyścigiem.
 */

import {
  SYNC_ENTITIES,
  isRetryableRejection,
  type SyncEntity,
  type SyncRejection,
  type SyncResult,
} from '@alphapump/core';
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

/**
 * Ile prób pod rząd wolno ponowić od razu, zanim wiersz wejdzie w normalny
 * odstęp. Wyścig przegrany dwa razy z rzędu przestaje być wyścigiem.
 */
const IMMEDIATE_RETRIES = 2;

function backoffFor(attempts: number, reason: SyncRejection | null): number {
  // Wiersz, który zniknął serwerowi między odczytem a zapisem, nie ma na co
  // czekać: przy następnej wymianie zastanie już inny stan. Reszta kodów jest
  // rozstrzygnięciem reguły — ten sam wiersz odbije się tak samo, więc odstęp
  // rośnie, żeby nie zajmował miejsca w każdej paczce.
  if (reason !== null && isRetryableRejection(reason) && attempts <= IMMEDIATE_RETRIES) return 0;
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1] ?? BACKOFF_MS[0];
}

/**
 * Zapisuje wynik jednej wymiany. Wiersz odrzucony ponownie dostaje dłuższy
 * odstęp, a nie nowy wpis — inaczej licznik prób nigdy by nie urósł.
 *
 * Bierze **wszystkie** wyniki, nie tylko odmowy: wiersz, o którym serwer tym
 * razem wypowiedział się bez odmowy, przestaje na cokolwiek czekać, więc jego
 * wpis w kwarantannie znika. Inaczej licznik „serwer nie przyjął" pokazywałby
 * odmowę jeszcze długo po tym, jak ten sam wiersz w końcu wszedł.
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
    if (result.decision !== 'rejected') {
      await db
        .delete(syncRejections)
        .where(and(eq(syncRejections.entity, result.entity), eq(syncRejections.rowId, result.id)));
      continue;
    }

    const attempts = (attemptsOf.get(key(result.entity, result.id)) ?? 0) + 1;
    const values = {
      entity: result.entity,
      rowId: result.id,
      reason: result.reason,
      reasonDetail: result.reasonDetail,
      attempts,
      rejectedAt: now,
      retryAfter: new Date(now.getTime() + backoffFor(attempts, result.reason)),
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
  await forgetSettled(db, now);

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
 * Sprząta kwarantannę z wierszy, dla których nie ma już czego ponawiać:
 * użytkownik je skasował albo zniknęły z bazy lokalnej.
 *
 * Wiersz, o którym serwer **wie** (`server_seq` niepusty), do kolejki już nie
 * wróci — `reconcile` szuka wyłącznie wierszy nieznanych serwerowi, a jego
 * lokalną wersję zastąpiła wersja serwerowa oddana przy odmowie (`authority.ts`).
 * Jego wpis nie znika jednak od razu, tylko wraz z upływem odstępu: wcześniej
 * kasował go ten sam przebieg, który go stworzył, więc odmowa nie zdążyła
 * pokazać się w pigułce statusu i **żadna** odmowa dotycząca biblioteki nie była
 * dla użytkownika widoczna.
 */
async function forgetSettled(db: SqliteDatabase, now: Date): Promise<void> {
  const records = await db.select().from(syncRejections);
  if (records.length === 0) return;

  const settled: { entity: SyncEntity; rowId: string }[] = [];

  for (const entity of SYNC_ENTITIES) {
    const held = records.filter((row) => row.entity === entity);
    if (held.length === 0) continue;

    const table: SyncedColumns = TABLES[entity];
    const rows = await db
      .select({ id: table.id, serverSeq: table.serverSeq, deletedAt: table.deletedAt })
      .from(table)
      .where(
        inArray(
          table.id,
          held.map((row) => row.rowId),
        ),
      );
    const byId = new Map(rows.map((row) => [row.id, row]));

    for (const record of held) {
      const row = byId.get(record.rowId);
      const gone = row === undefined || row.deletedAt !== null;
      const acknowledged = row !== undefined && row.serverSeq !== null;
      if (gone || (acknowledged && record.retryAfter <= now)) {
        settled.push({ entity, rowId: record.rowId });
      }
    }
  }

  for (const row of settled) {
    await db
      .delete(syncRejections)
      .where(and(eq(syncRejections.entity, row.entity), eq(syncRejections.rowId, row.rowId)));
  }
}
