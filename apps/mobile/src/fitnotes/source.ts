/**
 * Serie właściciela telefonu w postaci, w jakiej wchodzą do eksportu FitNotesa.
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

import type { FitNotesSourceSet } from '@alphapump/core';
import { exercises, tags, workoutSets, type SqliteDatabase } from '@alphapump/db/sqlite';
import { and, asc, eq, isNull } from 'drizzle-orm';

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
