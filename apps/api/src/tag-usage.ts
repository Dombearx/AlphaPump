/**
 * Reguła „tagu, na którym coś wisi, nie można usunąć".
 *
 * Mieszka osobno, bo usunięcie tagu ma **dwa** wejścia: `DELETE /tags/:id`
 * z panelu i tombstone przyjeżdżający w paczce `POST /sync/push`. Reguła
 * zapisana tylko przy jednym z nich nie jest regułą, tylko zachowaniem jednego
 * endpointu — a drugie wejście zostawiłoby ćwiczenia wskazujące na tag, którego
 * dla użytkownika już nie ma.
 *
 * Liczą się dwie rzeczy. Po pierwsze ćwiczenia **żywe**: ćwiczenie z tombstonem
 * jest dla użytkownika nieistniejące, więc nie ma czego trzymać przy życiu jego
 * tagom. Po drugie cele cykli — cel tagowy zlicza serie po tagu głównym
 * ćwiczenia, więc tag zdjęty pod nim zamienia cel w pozycję, która nigdy nic nie
 * naliczy, i to bez żadnego komunikatu.
 *
 * Właściwą operacją dla tagu, który jest pomyłką, jest **scalenie**
 * (`POST /admin/library/tags/:id/merge`): ćwiczenia i cele przechodzą na tag
 * docelowy, a dopiero pusty źródłowy znika.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { cycleGoals, cycles, exerciseTags, exercises } from './schema.js';

/** Czy jakiekolwiek nieusunięte ćwiczenie używa tagu — jako główny albo dodatkowy. */
export async function isTagOnExercise(db: Database, tagId: string): Promise<boolean> {
  const [usedAsPrimary] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.primaryTagId, tagId), isNull(exercises.deletedAt)))
    .limit(1);
  if (usedAsPrimary) return true;

  const [usedAsAdditional] = await db
    .select({ exerciseId: exerciseTags.exerciseId })
    .from(exerciseTags)
    .innerJoin(
      exercises,
      and(eq(exercises.id, exerciseTags.exerciseId), isNull(exercises.deletedAt)),
    )
    .where(eq(exerciseTags.tagId, tagId))
    .limit(1);

  return Boolean(usedAsAdditional);
}

/** Czy jakikolwiek żywy cykl ma cel wskazujący na ten tag. */
export async function isTagOnGoal(db: Database, tagId: string): Promise<boolean> {
  const [goal] = await db
    .select({ id: cycleGoals.id })
    .from(cycleGoals)
    .innerJoin(cycles, and(eq(cycles.id, cycleGoals.cycleId), isNull(cycles.deletedAt)))
    .where(eq(cycleGoals.tagId, tagId))
    .limit(1);

  return Boolean(goal);
}

export async function isTagInUse(db: Database, tagId: string): Promise<boolean> {
  return (await isTagOnExercise(db, tagId)) || (await isTagOnGoal(db, tagId));
}

/** Komunikat wspólny dla obu wejść — jedna reguła, jedno zdanie. */
export const TAG_IN_USE_MESSAGE =
  'Tag jest używany przez ćwiczenia albo cele cyklu i nie może zostać usunięty. ' +
  'Scal go z innym tagiem (panel administracyjny) albo zdejmij go tam, gdzie jest używany';
