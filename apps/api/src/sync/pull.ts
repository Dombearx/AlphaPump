/**
 * Pobieranie zmian kursorem po `server_seq`.
 *
 * Kursor jest **jeden dla wszystkich tabel**, bo `server_seq` pochodzi z jednej
 * sekwencji. Kursor per tabela wyglądałby niewinnie, a otwierałby okno, w którym
 * telefon pobrał ćwiczenia do numeru 100, serie do numeru 90 i nie ma jak
 * zauważyć, że coś między nimi zniknęło mu z widoku.
 *
 * Paczka jest posortowana po `server_seq`, czyli chronologicznie względem
 * zapisu na serwerze — a **nie** topologicznie względem zależności. Ćwiczenie
 * potrafi więc przyjechać przed swoim tagiem, a seria przed swoim ćwiczeniem.
 * Po stronie telefonu domyka to `PRAGMA defer_foreign_keys = ON` w transakcji
 * pullu (etap 7): SQLite przenosi wtedy sprawdzenie więzów na `COMMIT`, więc
 * kolejność wewnątrz paczki przestaje mieć znaczenie, a niespójność, której nie
 * domyka żaden wiersz z tej samej paczki, dalej nie przechodzi.
 *
 * ## Zakres widoczności
 *
 * | Encja      | Co schodzi na telefon                                     |
 * | ---------- | --------------------------------------------------------- |
 * | konta      | wszystkie — nick jest potrzebny przy autorze i rekordach   |
 * | tagi       | wszystkie — lista tagów jest globalna                      |
 * | ćwiczenia  | wszystkie — biblioteka jest wspólna                        |
 * | serie      | **wyłącznie własne** — historia serii jest prywatna         |
 * | cykle      | **wyłącznie własne**                                       |
 *
 * Tombstone'y schodzą razem z resztą. To nie jest efekt uboczny, tylko jedyny
 * sposób, w jaki usunięcie wykonane na jednym urządzeniu dociera na drugie.
 */

import type { SyncChanges, SyncPullQuery, SyncPullResponse } from '@alphapump/core';
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import type { Principal } from '../context.js';
import type { Database } from '../db.js';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../schema.js';
import {
  toSyncedCycleDto,
  toSyncedExerciseDto,
  toSyncedSetDto,
  toSyncedTagDto,
  toSyncedUserDto,
} from './rows.js';

/** Wiersz dowolnej tabeli sprowadzony do tego, co potrzebne do posortowania paczki. */
type Candidate =
  | { kind: 'user'; serverSeq: number; row: typeof users.$inferSelect }
  | { kind: 'tag'; serverSeq: number; row: typeof tags.$inferSelect }
  | { kind: 'exercise'; serverSeq: number; row: typeof exercises.$inferSelect }
  | { kind: 'cycle'; serverSeq: number; row: typeof cycles.$inferSelect }
  | { kind: 'set'; serverSeq: number; row: typeof workoutSets.$inferSelect };

export async function pullChanges(
  db: Database,
  principal: Principal,
  query: SyncPullQuery,
  now: Date,
): Promise<SyncPullResponse> {
  const { since, limit } = query;

  // Każda tabela oddaje o jeden wiersz więcej, niż zmieści się w paczce.
  // Nadmiarowy wiersz jest jedynym pewnym sygnałem, że jest jeszcze co pobierać —
  // bez niego „dokładnie tyle, ile limit" byłoby nie do odróżnienia od „koniec".
  const window = limit + 1;

  const [userRows, tagRows, exerciseRows, cycleRows, setRows] = await Promise.all([
    db
      .select()
      .from(users)
      .where(gt(users.serverSeq, since))
      .orderBy(asc(users.serverSeq))
      .limit(window),
    db
      .select()
      .from(tags)
      .where(gt(tags.serverSeq, since))
      .orderBy(asc(tags.serverSeq))
      .limit(window),
    db
      .select()
      .from(exercises)
      .where(gt(exercises.serverSeq, since))
      .orderBy(asc(exercises.serverSeq))
      .limit(window),
    db
      .select()
      .from(cycles)
      .where(and(eq(cycles.userId, principal.id), gt(cycles.serverSeq, since)))
      .orderBy(asc(cycles.serverSeq))
      .limit(window),
    db
      .select()
      .from(workoutSets)
      .where(and(eq(workoutSets.userId, principal.id), gt(workoutSets.serverSeq, since)))
      .orderBy(asc(workoutSets.serverSeq))
      .limit(window),
  ]);

  const candidates: Candidate[] = [
    ...userRows.map((row) => ({ kind: 'user', serverSeq: row.serverSeq, row }) as const),
    ...tagRows.map((row) => ({ kind: 'tag', serverSeq: row.serverSeq, row }) as const),
    ...exerciseRows.map((row) => ({ kind: 'exercise', serverSeq: row.serverSeq, row }) as const),
    ...cycleRows.map((row) => ({ kind: 'cycle', serverSeq: row.serverSeq, row }) as const),
    ...setRows.map((row) => ({ kind: 'set', serverSeq: row.serverSeq, row }) as const),
  ].sort((a, b) => a.serverSeq - b.serverSeq);

  const batch = candidates.slice(0, limit);
  const hasMore = candidates.length > limit;
  const cursor = batch.length === 0 ? since : (batch[batch.length - 1] as Candidate).serverSeq;

  const changes: SyncChanges = { users: [], tags: [], exercises: [], cycles: [], sets: [] };
  const exerciseIds: string[] = [];
  const cycleIds: string[] = [];

  for (const candidate of batch) {
    switch (candidate.kind) {
      case 'user':
        changes.users.push(toSyncedUserDto(candidate.row, principal.id));
        break;
      case 'tag':
        changes.tags.push(toSyncedTagDto(candidate.row));
        break;
      case 'exercise':
        exerciseIds.push(candidate.row.id);
        break;
      case 'cycle':
        cycleIds.push(candidate.row.id);
        break;
      case 'set':
        changes.sets.push(toSyncedSetDto(candidate.row));
        break;
    }
  }

  // Tagi dodatkowe i pozycje celu jadą z rodzicem, więc dobieramy je dopiero dla
  // wierszy, które faktycznie weszły do paczki.
  const [additionalTags, goals] = await Promise.all([
    exerciseIds.length === 0
      ? []
      : db
          .select()
          .from(exerciseTags)
          .where(inArray(exerciseTags.exerciseId, exerciseIds))
          .orderBy(asc(exerciseTags.position)),
    cycleIds.length === 0
      ? []
      : db
          .select()
          .from(cycleGoals)
          .where(inArray(cycleGoals.cycleId, cycleIds))
          .orderBy(asc(cycleGoals.position)),
  ]);

  const tagsByExercise = groupBy(additionalTags, (row) => row.exerciseId);
  const goalsByCycle = groupBy(goals, (row) => row.cycleId);

  for (const candidate of batch) {
    if (candidate.kind === 'exercise') {
      const additional = (tagsByExercise.get(candidate.row.id) ?? []).map((row) => row.tagId);
      changes.exercises.push(toSyncedExerciseDto(candidate.row, additional));
    }
    if (candidate.kind === 'cycle') {
      changes.cycles.push(
        toSyncedCycleDto(candidate.row, goalsByCycle.get(candidate.row.id) ?? []),
      );
    }
  }

  return { serverTime: now.toISOString(), cursor, hasMore, changes };
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const bucket = grouped.get(key(row));
    if (bucket) bucket.push(row);
    else grouped.set(key(row), [row]);
  }
  return grouped;
}
