/**
 * Reguła „ćwiczenia z zapisanymi seriami nie można usunąć".
 *
 * Do tej pory usunięcie ćwiczenia było wyłącznie miękkie i na tym reguła się
 * kończyła: wiersz zostawał z tombstonem, więc seria formalnie miała na co
 * wskazywać. Formalnie — bo dla użytkownika ćwiczenie z tombstonem nie
 * istnieje, a jego seria zostaje w dniu jako wpis bez nazwy. Usunięcie
 * ćwiczenia, na którym ktoś trenował, nie jest więc porządkowaniem biblioteki,
 * tylko cichym zabraniem komuś historii.
 *
 * Właściwą operacją jest **scalenie** (`POST /admin/library/exercises/:id/merge`):
 * serie przechodzą na ćwiczenie docelowe, a dopiero puste źródło znika. Kto chce
 * usunąć ćwiczenie z jedną własną serią wpisaną przez pomyłkę, kasuje najpierw
 * tę serię — i to też jest w tym komunikacie napisane, bo inaczej wygląda on
 * jak ściana.
 *
 * Predykat mieszka osobno — dokładnie z tego powodu, dla którego osobno mieszka
 * `tag-usage.ts`: usunięcie ma **dwa** wejścia, `DELETE /exercises/:id`
 * i tombstone przyjeżdżający w paczce `POST /sync/push`. Reguła zapisana tylko
 * przy jednym z nich nie jest regułą, tylko zachowaniem jednego endpointu.
 */

import { and, count, eq, isNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { cycleGoals, cycles, workoutSets } from './schema.js';

/**
 * Ile **żywych** serii wskazuje na ćwiczenie — wszystkich użytkowników, nie
 * tylko pytającego. Seria z tombstonem się nie liczy: dla właściciela już nie
 * istnieje, a jej powrót wymagałby przegranego rozstrzygnięcia konfliktu.
 */
export async function countExerciseSets(db: Database, exerciseId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(workoutSets)
    .where(and(eq(workoutSets.exerciseId, exerciseId), isNull(workoutSets.deletedAt)));

  return Number(row?.value ?? 0);
}

/**
 * Czy jakikolwiek żywy cykl ma cel wskazujący na to ćwiczenie.
 *
 * Ta sama reguła co przy tagach: cel, którego ćwiczenie zniknęło, nigdy nic nie
 * naliczy i nie powie o tym ani słowa.
 */
export async function isExerciseOnGoal(db: Database, exerciseId: string): Promise<boolean> {
  const [goal] = await db
    .select({ id: cycleGoals.id })
    .from(cycleGoals)
    .innerJoin(cycles, and(eq(cycles.id, cycleGoals.cycleId), isNull(cycles.deletedAt)))
    .where(eq(cycleGoals.exerciseId, exerciseId))
    .limit(1);

  return Boolean(goal);
}

export async function isExerciseInUse(db: Database, exerciseId: string): Promise<boolean> {
  return (await countExerciseSets(db, exerciseId)) > 0 || (await isExerciseOnGoal(db, exerciseId));
}

/** Komunikat wspólny dla obu wejść — jedna reguła, jedno zdanie. */
export const EXERCISE_IN_USE_MESSAGE =
  'Ćwiczenie ma zapisane serie albo cele cyklu i nie może zostać usunięte. Scal je z innym ' +
  'ćwiczeniem (panel administracyjny) albo usuń najpierw to, co na nim wisi';
