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
 *
 * ## Paczka jest domknięta referencyjnie
 *
 * Outbox zawiera wyłącznie to, co użytkownik zmienił — a seria potrafi wskazywać
 * na wiersz, którego nikt nie zmieniał i którego serwer nigdy nie widział.
 * Najczęstszy przypadek to biblioteka wbudowana: telefon dostaje ją z własnego
 * seeda przy pierwszym uruchomieniu, więc nigdy nie przechodzi ona przez
 * kolejkę wysyłki. Seria zapisana na takim ćwiczeniu jechałaby na serwer sama
 * i wracała odrzucona z „Ćwiczenie serii nie istnieje".
 *
 * Dlatego paczka bierze ze sobą **wiersze, na które wskazuje, a których serwer
 * jeszcze nie potwierdził** (`server_seq` pusty): ćwiczenia serii i celów, a za
 * nimi tagi tych ćwiczeń. Serwer przetwarza encje w kolejności tagi → ćwiczenia
 * → cykle → serie, więc zależność jest zapisana zanim ktokolwiek na nią
 * wskaże. Wierszy potwierdzonych paczka nie powtarza — serwer ma je u siebie,
 * a niepotrzebne wiersze to tylko rachunek za transfer.
 */

import { SYNC_PUSH_LIMIT, type SyncPushRequest } from '@alphapump/core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  workoutSets,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import { asc, inArray, isNull, and } from 'drizzle-orm';
import type { PendingRow } from './outbox';

const instant = (value: Date): string => value.toISOString();
const nullableInstant = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

function idsOf(rows: readonly PendingRow[], entity: PendingRow['entity']): string[] {
  return rows.filter((row) => row.entity === entity).map((row) => row.rowId);
}

type PushTag = SyncPushRequest['tags'][number];
type PushExercise = SyncPushRequest['exercises'][number];

/** Wiersze tagów w kształcie pushu. `onlyUnacknowledged` zawęża do nieznanych serwerowi. */
async function readTags(
  db: SqliteDatabase,
  ids: readonly string[],
  onlyUnacknowledged = false,
): Promise<PushTag[]> {
  if (ids.length === 0) return [];

  const where = onlyUnacknowledged
    ? and(inArray(tags.id, [...ids]), isNull(tags.serverSeq))
    : inArray(tags.id, [...ids]);
  const rows = await db.select().from(tags).where(where);

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  }));
}

async function readExercises(
  db: SqliteDatabase,
  ids: readonly string[],
  onlyUnacknowledged = false,
): Promise<PushExercise[]> {
  if (ids.length === 0) return [];

  const where = onlyUnacknowledged
    ? and(inArray(exercises.id, [...ids]), isNull(exercises.serverSeq))
    : inArray(exercises.id, [...ids]);
  const rows = await db.select().from(exercises).where(where);
  if (rows.length === 0) return [];

  const links = await db
    .select()
    .from(exerciseTags)
    .where(
      inArray(
        exerciseTags.exerciseId,
        rows.map((row) => row.id),
      ),
    )
    .orderBy(asc(exerciseTags.position));

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    authorId: row.authorId,
    loggingType: row.loggingType,
    primaryTagId: row.primaryTagId,
    additionalTagIds: links.filter((link) => link.exerciseId === row.id).map((link) => link.tagId),
    note: row.note,
    gym: row.gym,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  }));
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
    tags: await readTags(db, idsOf(pending, 'tag')),
    exercises: await readExercises(db, idsOf(pending, 'exercise')),
    cycles: [],
    sets: [],
  };

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

  return await withDependencies(db, request);
}

/**
 * Dokłada wiersze, na które paczka wskazuje, a których serwer nie potwierdził.
 *
 * Limit `SYNC_PUSH_LIMIT` obowiązuje per encja i jest sprawdzany przez serwer,
 * więc zależności też muszą się w nim zmieścić. Gdy się nie mieszczą — a do tego
 * potrzeba ponad pięciuset nieznanych serwerowi ćwiczeń naraz — z paczki wypada
 * wiersz, którego zależność nie weszła. Nie jest to strata: `reconcile`
 * zauważy przy następnej wymianie, że wiersz wciąż nie ma `server_seq`,
 * i wstawi go z powrotem do kolejki.
 */
async function withDependencies(
  db: SqliteDatabase,
  request: SyncPushRequest,
): Promise<SyncPushRequest> {
  /* ---------------------------------------------------- ćwiczenia serii i celów */

  const inBatch = new Set(request.exercises.map((exercise) => exercise.id));
  const referenced = new Set<string>();
  for (const set of request.sets) referenced.add(set.exerciseId);
  for (const cycle of request.cycles) {
    for (const goal of cycle.goals) if (goal.exerciseId !== null) referenced.add(goal.exerciseId);
  }

  const missing = await readExercises(
    db,
    [...referenced].filter((id) => !inBatch.has(id)),
    true,
  );
  const room = Math.max(0, SYNC_PUSH_LIMIT - request.exercises.length);
  const exercisesOut = [...request.exercises, ...missing.slice(0, room)];
  const droppedExercises = new Set(missing.slice(room).map((exercise) => exercise.id));

  /* ------------------------------------------------------- tagi tych ćwiczeń */

  const tagsInBatch = new Set(request.tags.map((tag) => tag.id));
  const referencedTags = new Set<string>();
  for (const exercise of exercisesOut) {
    referencedTags.add(exercise.primaryTagId);
    for (const id of exercise.additionalTagIds) referencedTags.add(id);
  }

  const missingTags = await readTags(
    db,
    [...referencedTags].filter((id) => !tagsInBatch.has(id)),
    true,
  );
  const tagRoom = Math.max(0, SYNC_PUSH_LIMIT - request.tags.length);
  const tagsOut = [...request.tags, ...missingTags.slice(0, tagRoom)];
  const droppedTags = new Set(missingTags.slice(tagRoom).map((tag) => tag.id));

  /* ------------------------------------- odsianie wierszy bez swojej zależności */

  if (droppedExercises.size === 0 && droppedTags.size === 0) {
    return { ...request, tags: tagsOut, exercises: exercisesOut };
  }

  const orphaned = new Set(droppedExercises);
  const exercisesKept = exercisesOut.filter((exercise) => {
    const complete =
      !droppedTags.has(exercise.primaryTagId) &&
      !exercise.additionalTagIds.some((id) => droppedTags.has(id));
    if (!complete) orphaned.add(exercise.id);
    return complete;
  });

  return {
    ...request,
    tags: tagsOut,
    exercises: exercisesKept,
    cycles: request.cycles.filter((cycle) =>
      cycle.goals.every((goal) => goal.exerciseId === null || !orphaned.has(goal.exerciseId)),
    ),
    sets: request.sets.filter((set) => !orphaned.has(set.exerciseId)),
  };
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
