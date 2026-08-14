/**
 * Składanie paczki pushu ze stanu bazy lokalnej.
 *
 * Outbox mówi tylko, **które** wiersze się zmieniły. Ich treść czytamy dopiero
 * tutaj, w chwili wysyłki, żeby na serwer pojechało to, co użytkownik widzi na
 * ekranie, a nie stan sprzed trzech edycji zrobionych w tunelu.
 *
 * Wiersze, których w bazie już nie ma, po prostu wypadają. To nie jest błąd —
 * usunięcie jest miękkie, więc znikający wiersz może oznaczać wyłącznie
 * czyszczenie bazy lokalnej albo wpis osierocony przez awarię. Wysyłanie pustego
 * miejsca nie ma jak pomóc.
 */

import type { SyncPushRequest } from '@alphapump/core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  workoutSets,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import { asc, inArray } from 'drizzle-orm';
import type { PendingRow } from './outbox';

const instant = (value: Date): string => value.toISOString();
const nullableInstant = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

function idsOf(rows: readonly PendingRow[], entity: PendingRow['entity']): string[] {
  return rows.filter((row) => row.entity === entity).map((row) => row.rowId);
}

/**
 * Buduje żądanie pushu. Pusta paczka jest poprawna i oznacza „nie mam nic do
 * wysłania" — wołający decyduje, czy w ogóle warto ruszać sieć.
 */
export async function buildPushRequest(
  db: SqliteDatabase,
  deviceId: string,
  pending: readonly PendingRow[],
): Promise<SyncPushRequest> {
  const request: SyncPushRequest = {
    deviceId,
    tags: [],
    exercises: [],
    cycles: [],
    sets: [],
  };

  const tagIds = idsOf(pending, 'tag');
  if (tagIds.length > 0) {
    const rows = await db.select().from(tags).where(inArray(tags.id, tagIds));
    request.tags = rows.map((row) => ({
      id: row.id,
      name: row.name,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: nullableInstant(row.deletedAt),
    }));
  }

  const exerciseIds = idsOf(pending, 'exercise');
  if (exerciseIds.length > 0) {
    const rows = await db.select().from(exercises).where(inArray(exercises.id, exerciseIds));
    const links = await db
      .select()
      .from(exerciseTags)
      .where(inArray(exerciseTags.exerciseId, exerciseIds))
      .orderBy(asc(exerciseTags.position));

    request.exercises = rows.map((row) => ({
      id: row.id,
      name: row.name,
      authorId: row.authorId,
      loggingType: row.loggingType,
      primaryTagId: row.primaryTagId,
      additionalTagIds: links
        .filter((link) => link.exerciseId === row.id)
        .map((link) => link.tagId),
      note: row.note,
      gym: row.gym,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: nullableInstant(row.deletedAt),
    }));
  }

  const cycleIds = idsOf(pending, 'cycle');
  if (cycleIds.length > 0) {
    const rows = await db.select().from(cycles).where(inArray(cycles.id, cycleIds));
    const goals = await db
      .select()
      .from(cycleGoals)
      .where(inArray(cycleGoals.cycleId, cycleIds))
      .orderBy(asc(cycleGoals.position));

    request.cycles = rows.map((row) => ({
      id: row.id,
      name: row.name,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      archivedAt: nullableInstant(row.archivedAt),
      goals: goals
        .filter((goal) => goal.cycleId === row.id)
        .map((goal) => ({
          id: goal.id,
          metric: goal.metric,
          target: goal.target,
          exerciseId: goal.exerciseId,
          tagId: goal.tagId,
        })),
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: nullableInstant(row.deletedAt),
    }));
  }

  const setIds = idsOf(pending, 'set');
  if (setIds.length > 0) {
    const rows = await db.select().from(workoutSets).where(inArray(workoutSets.id, setIds));
    request.sets = rows.map((row) => ({
      id: row.id,
      exerciseId: row.exerciseId,
      performedOn: row.performedOn,
      position: row.position,
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceM: row.distanceM,
      bodyweightG: row.bodyweightG,
      note: row.note,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: nullableInstant(row.deletedAt),
    }));
  }

  return request;
}

/** Czy paczka niesie cokolwiek — pusty push to żądanie sieciowe bez treści. */
export function isEmptyPush(request: SyncPushRequest): boolean {
  return (
    request.tags.length === 0 &&
    request.exercises.length === 0 &&
    request.cycles.length === 0 &&
    request.sets.length === 0
  );
}

/**
 * Cykl bez pozycji celu nie przejdzie walidacji serwera (`goals` ma minimum
 * jeden element), a odrzucony wiersz zostawałby w outboxie w kółko. Odsiewamy
 * go już tutaj — to stan przejściowy, który powstaje wyłącznie wtedy, gdy pull
 * skasował pozycje celu tuż przed wysyłką.
 */
export function withoutIncompleteRows(request: SyncPushRequest): SyncPushRequest {
  return { ...request, cycles: request.cycles.filter((cycle) => cycle.goals.length > 0) };
}
