/**
 * Eksport danych do archiwum JSON.
 *
 * Ten sam kod obsługuje funkcję użytkownika („wyjmij moje dane") i systemową
 * kopię zapasową („wyjmij wszystko"). Różnica jest jednym parametrem, i to jest
 * cała sztuczka: ścieżka odtwarzania z kopii jest przechodzona przy normalnym
 * korzystaniu z aplikacji, więc nie ma jak zardzewieć niezauważona.
 *
 * ## Co wchodzi do archiwum jednego konta
 *
 * Serie i cykle właściciela — to jasne. Do tego **ćwiczenia, których te dane
 * dotykają**, i tagi tych ćwiczeń, choć jedno i drugie jest własnością wspólną.
 * Bez nich archiwum byłoby listą identyfikatorów wskazujących na bibliotekę,
 * której w miejscu odtworzenia może nie być — a wtedy „eksport moich danych"
 * dawałby plik bezużyteczny wszędzie poza bazą, z której powstał.
 *
 * Wchodzą też ćwiczenia **autorstwa** właściciela, nawet nieużywane w żadnej
 * serii: wymyślone ćwiczenie jest jego danymi, nie danymi biblioteki.
 *
 * ## Czego nie ma nigdy
 *
 * Hashy haseł, sesji i kluczy API (wrażliwe, a do odtworzenia zbędne),
 * embeddingów (przeliczalne z nazw) oraz rekordów i rankingów (pochodne z serii).
 * Użytkownicy są w archiwum w postaci minimalnej — `id`, e-mail, nick, rola —
 * bo bez nich `author_id` przy ćwiczeniach i właściciel przy seriach wskazywałyby
 * po odtworzeniu w próżnię.
 *
 * Tombstone'ów też nie ma: archiwum odtwarza **stan**, a nie historię usunięć.
 */

import {
  createArchive,
  type Archive,
  type ArchiveContent,
  type ArchiveUser,
} from '@alphapump/core';
import { and, asc, eq, inArray, isNull, or } from 'drizzle-orm';
import type { Database } from '../db.js';
import { toCycleDto, toExerciseDto, toSetDto, toTagDto } from '../dto.js';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../schema.js';

/**
 * Zakres eksportu.
 *
 * `user` — jedno konto, funkcja dostępna każdemu dla własnych danych.
 * `system` — wszystko, zastrzeżone dla administratora i dla crona kopii.
 */
export type ExportScope = { kind: 'user'; userId: string } | { kind: 'system' };

const toArchiveUser = (row: typeof users.$inferSelect): ArchiveUser => ({
  id: row.id,
  email: row.email,
  nickname: row.nickname,
  role: row.role,
});

export async function exportArchive(
  db: Database,
  scope: ExportScope,
  now: Date = new Date(),
): Promise<Archive> {
  const content =
    scope.kind === 'system' ? await systemContent(db) : await userContent(db, scope.userId);

  return createArchive(content, { scope: scope.kind, exportedAt: now });
}

/** Tagi dodatkowe wskazanych ćwiczeń, w kolejności pozycji. */
async function additionalTagsOf(
  db: Database,
  exerciseIds: readonly string[],
): Promise<Map<string, string[]>> {
  if (exerciseIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(exerciseTags)
    .where(inArray(exerciseTags.exerciseId, [...exerciseIds]))
    .orderBy(asc(exerciseTags.position));

  const byExercise = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byExercise.get(row.exerciseId);
    if (bucket) bucket.push(row.tagId);
    else byExercise.set(row.exerciseId, [row.tagId]);
  }
  return byExercise;
}

async function goalsOf(
  db: Database,
  cycleIds: readonly string[],
): Promise<Map<string, (typeof cycleGoals.$inferSelect)[]>> {
  if (cycleIds.length === 0) return new Map();

  const rows = await db
    .select()
    .from(cycleGoals)
    .where(inArray(cycleGoals.cycleId, [...cycleIds]))
    .orderBy(asc(cycleGoals.position));

  const byCycle = new Map<string, (typeof cycleGoals.$inferSelect)[]>();
  for (const row of rows) {
    const bucket = byCycle.get(row.cycleId);
    if (bucket) bucket.push(row);
    else byCycle.set(row.cycleId, [row]);
  }
  return byCycle;
}

async function systemContent(db: Database): Promise<ArchiveContent> {
  const userRows = await db.select().from(users).orderBy(asc(users.email));
  const tagRows = await db
    .select()
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(asc(tags.name));
  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(isNull(exercises.deletedAt))
    .orderBy(asc(exercises.name));
  const setRows = await db
    .select()
    .from(workoutSets)
    .where(isNull(workoutSets.deletedAt))
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position));
  const cycleRows = await db
    .select()
    .from(cycles)
    .where(isNull(cycles.deletedAt))
    .orderBy(asc(cycles.startsOn));

  const tagsByExercise = await additionalTagsOf(
    db,
    exerciseRows.map((row) => row.id),
  );
  const goalsByCycle = await goalsOf(
    db,
    cycleRows.map((row) => row.id),
  );

  return {
    users: userRows.map(toArchiveUser),
    tags: tagRows.map(toTagDto),
    exercises: exerciseRows.map((row) => toExerciseDto(row, tagsByExercise.get(row.id) ?? [])),
    sets: setRows.map(toSetDto),
    cycles: cycleRows.map((row) => toCycleDto(row, goalsByCycle.get(row.id) ?? [])),
  };
}

async function userContent(db: Database, userId: string): Promise<ArchiveContent> {
  const setRows = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.userId, userId), isNull(workoutSets.deletedAt)))
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position));

  const cycleRows = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.userId, userId), isNull(cycles.deletedAt)))
    .orderBy(asc(cycles.startsOn));

  const goalsByCycle = await goalsOf(
    db,
    cycleRows.map((row) => row.id),
  );
  const goalRows = [...goalsByCycle.values()].flat();

  // Ćwiczenia dotknięte danymi konta **oraz** ćwiczenia jego autorstwa. Drugie
  // nie wynikają z pierwszych: ćwiczenie wymyślone i jeszcze nieużyte też jest
  // danymi użytkownika.
  const referencedExerciseIds = new Set<string>([
    ...setRows.map((row) => row.exerciseId),
    ...goalRows.flatMap((row) => (row.exerciseId === null ? [] : [row.exerciseId])),
  ]);

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(
      and(
        isNull(exercises.deletedAt),
        referencedExerciseIds.size === 0
          ? eq(exercises.authorId, userId)
          : or(eq(exercises.authorId, userId), inArray(exercises.id, [...referencedExerciseIds])),
      ),
    )
    .orderBy(asc(exercises.name));

  const tagsByExercise = await additionalTagsOf(
    db,
    exerciseRows.map((row) => row.id),
  );

  const tagIds = new Set<string>([
    ...exerciseRows.map((row) => row.primaryTagId),
    ...[...tagsByExercise.values()].flat(),
    ...goalRows.flatMap((row) => (row.tagId === null ? [] : [row.tagId])),
  ]);

  const tagRows =
    tagIds.size === 0
      ? []
      : await db
          .select()
          .from(tags)
          .where(and(inArray(tags.id, [...tagIds]), isNull(tags.deletedAt)))
          .orderBy(asc(tags.name));

  // Właściciel plus autorzy ćwiczeń, które weszły do archiwum. Bez autorów plik
  // nie przeszedłby własnego sprawdzenia spójności.
  const userIds = new Set<string>([userId, ...exerciseRows.map((row) => row.authorId)]);
  const userRows = await db
    .select()
    .from(users)
    .where(inArray(users.id, [...userIds]))
    .orderBy(asc(users.email));

  return {
    users: userRows.map(toArchiveUser),
    tags: tagRows.map(toTagDto),
    exercises: exerciseRows.map((row) => toExerciseDto(row, tagsByExercise.get(row.id) ?? [])),
    sets: setRows.map(toSetDto),
    cycles: cycleRows.map((row) => toCycleDto(row, goalsByCycle.get(row.id) ?? [])),
  };
}
