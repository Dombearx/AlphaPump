/**
 * Odczyty bazy lokalnej, na których stoi wymiana z FitNotesem: serie
 * właściciela telefonu i biblioteka ćwiczeń.
 *
 * Odczyt jest tu, reguły są w `@alphapump/core` — tak samo jak przy eksporcie
 * archiwum. Kategorią FitNotesa jest **tag główny** ćwiczenia, bo to on w
 * AlphaPump odpowiada za przynależność ćwiczenia (i za zaliczanie serii do celów
 * cyklu), a FitNotes zna dokładnie jedną kategorię na ćwiczenie.
 *
 * Ćwiczenia usuniętego nie odfiltrowujemy: seria wskazująca na nie dalej jest
 * treningiem, który użytkownik wykonał, a pominięcie jej po cichu byłoby ubytkiem
 * w kopii, o którym nikt by się nie dowiedział.
 */

import type { FitNotesKnownExercise, FitNotesSourceSet } from '@alphapump/core';
import { exercises, tags, workoutSets, type SqliteDatabase } from '@alphapump/db/sqlite';
import { and, asc, eq, isNull } from 'drizzle-orm';

/** Ćwiczenie z biblioteki lokalnej — z identyfikatorem, bo na nie wskażą serie. */
export interface FitNotesLibraryExercise extends FitNotesKnownExercise {
  id: string;
}

/**
 * Biblioteka widziana od strony nazw, bo tylko nazwami mówi plik FitNotesa.
 *
 * Biblioteka jest wspólna, więc tę samą nazwę potrafią nosić dwa ćwiczenia
 * różnych autorów. Pierwszeństwo ma wtedy ćwiczenie właściciela telefonu:
 * import ma dopisać serie do jego historii, a nie założyć trzecie ćwiczenie
 * o tej samej nazwie.
 */
export async function fitNotesLibrary(
  db: SqliteDatabase,
  userId: string,
): Promise<FitNotesLibraryExercise[]> {
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      loggingType: exercises.loggingType,
      authorId: exercises.authorId,
    })
    .from(exercises)
    .where(isNull(exercises.deletedAt))
    .orderBy(asc(exercises.name));

  return rows
    .sort((first, second) => Number(second.authorId === userId) - Number(first.authorId === userId))
    .map((row) => ({ id: row.id, name: row.name, loggingType: row.loggingType }));
}

export async function fitNotesSourceSets(
  db: SqliteDatabase,
  userId: string,
): Promise<FitNotesSourceSet[]> {
  const rows = await db
    .select({
      exerciseName: exercises.name,
      categoryName: tags.name,
      performedOn: workoutSets.performedOn,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      createdAt: workoutSets.createdAt,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(and(eq(workoutSets.userId, userId), isNull(workoutSets.deletedAt)))
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position));

  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
