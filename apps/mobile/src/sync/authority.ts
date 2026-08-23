/**
 * Kiedy wersja serwera jest **rozstrzygająca**, a kiedy ustępuje wersji lokalnej.
 *
 * ## Problem
 *
 * `apply.ts` przepuszczał **każdy** przychodzący wiersz przez `resolveSyncConflict`,
 * także ten, który przyszedł w odpowiedzi na własny push. Powód był dobry: między
 * złożeniem paczki a zapisaniem odpowiedzi użytkownik zdąży edytować ten sam
 * wiersz, a nadpisanie cofnęłoby mu zmianę na ekranie. LWW jest jednak
 * **złym przybliżeniem** tego pytania i myli się w obie strony:
 *
 * | Sytuacja                                   | Co robiło LWW                          |
 * | ------------------------------------------ | -------------------------------------- |
 * | serwer **odrzucił** wiersz i oddał swój    | lokalny nowszy → zostaje wersja odrzucona |
 * | serwer **przyciął** znacznik z przyszłości | przycięty jest starszy → zostaje przyszły |
 * | serwer **poprawił** kolor tagu             | remis `updated_at` → zostaje kolor lokalny |
 *
 * Każdy z tych trzech przypadków kończy się tak samo: baza telefonu i baza
 * serwera trzymają różną treść tego samego wiersza, **żadna wymiana już tego nie
 * naprawia** (numer wiersza jest za kursorem, więc pull go nie przywiezie),
 * a użytkownik nie widzi żadnego błędu. Dokładnie tak wygląda ćwiczenie
 * z tagiem głównym „legs" na telefonie i „quads" w panelu.
 *
 * ## Reguła
 *
 * Wersja lokalna ma pierwszeństwo dokładnie wtedy, gdy **niesie coś, czego serwer
 * jeszcze nie widział**. Telefon wie o tym wprost, bez zgadywania z zegara:
 *
 * - przy pushu — wpis w kolejce z numerem **wyższym niż wysłana paczka**
 *   (`highWater`), czyli edycja zrobiona w trakcie wymiany,
 * - przy pullu — jakikolwiek wpis w kolejce albo wiersz czekający
 *   w kwarantannie odrzuceń, czyli zmiana, która dopiero pojedzie.
 *
 * Poza tymi przypadkami wiersz serwera jest rozstrzygający i wchodzi do bazy
 * bez rozstrzygania konfliktu. Zegar telefonu przestaje mieć tu cokolwiek do
 * powiedzenia — a to on był źródłem rozjazdów, których nic nie domykało.
 *
 * LWW nie znika: dalej rozstrzyga wiersze **cudze**, przywiezione pullem, które
 * spotykają się z lokalną zmianą czekającą w kolejce. Tam jest na miejscu, bo
 * obie wersje są prawdziwymi zapisami dwóch urządzeń.
 */

import type { SyncChanges, SyncEntity } from '@alphapump/core';
import { outbox, syncRejections, type SqliteDatabase } from '@alphapump/db/sqlite';
import { gt } from 'drizzle-orm';

/** Klucz wiersza w paczce — encja i identyfikator, bo same id bywają wspólne. */
export const rowKey = (entity: SyncEntity, id: string): string => `${entity}:${id}`;

/** Wszystkie wiersze paczki, w kluczach. */
export function keysOf(changes: SyncChanges): Set<string> {
  const keys = new Set<string>();
  for (const row of changes.tags) keys.add(rowKey('tag', row.id));
  for (const row of changes.exercises) keys.add(rowKey('exercise', row.id));
  for (const row of changes.cycles) keys.add(rowKey('cycle', row.id));
  for (const row of changes.sets) keys.add(rowKey('set', row.id));
  return keys;
}

/**
 * Wiersze odpowiedzi pushu, dla których wersja serwera jest rozstrzygająca.
 *
 * Odpada z nich to, co użytkownik zmienił **w trakcie** wymiany: taki wpis ma
 * numer wyższy niż paczka, więc pojedzie następną i to on jest świeższy.
 */
export async function authorityAfterPush(
  db: SqliteDatabase,
  changes: SyncChanges,
  highWater: number,
): Promise<Set<string>> {
  const edited = await db
    .select({ entity: outbox.entity, rowId: outbox.rowId })
    .from(outbox)
    .where(gt(outbox.seq, highWater));

  return without(
    keysOf(changes),
    edited.map((row) => rowKey(row.entity, row.rowId)),
  );
}

/**
 * Wiersze paczki pullu, dla których wersja serwera jest rozstrzygająca.
 *
 * Odpada z nich wszystko, co czeka na wysłanie — w kolejce albo w kwarantannie
 * odrzuceń. Kwarantanna liczy się tak samo jak kolejka: wiersz, który ma wrócić
 * do wysyłki po odstępie, dalej niesie zmianę użytkownika.
 */
export async function authorityAfterPull(
  db: SqliteDatabase,
  changes: SyncChanges,
): Promise<Set<string>> {
  // Z `groupBy`, bo kolejka trzyma wpis na **zmianę**, nie na wiersz: telefon
  // poza VPN-em przez miesiąc ma ich dziesiątki tysięcy, a interesuje nas
  // wyłącznie zbiór wierszy, które na coś czekają.
  const queued = await db
    .select({ entity: outbox.entity, rowId: outbox.rowId })
    .from(outbox)
    .groupBy(outbox.entity, outbox.rowId);
  const held = await db
    .select({ entity: syncRejections.entity, rowId: syncRejections.rowId })
    .from(syncRejections);

  return without(
    keysOf(changes),
    [...queued, ...held].map((row) => rowKey(row.entity, row.rowId)),
  );
}

function without(keys: Set<string>, excluded: readonly string[]): Set<string> {
  for (const key of excluded) keys.delete(key);
  return keys;
}
