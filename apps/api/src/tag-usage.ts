/**
 * Reguła „tagu używanego przez ćwiczenia nie można usunąć".
 *
 * Mieszka osobno, bo usunięcie tagu ma **dwa** wejścia: `DELETE /tags/:id`
 * z panelu i tombstone przyjeżdżający w paczce `POST /sync/push`. Reguła
 * zapisana tylko przy jednym z nich nie jest regułą, tylko zachowaniem jednego
 * endpointu — a drugie wejście zostawiłoby ćwiczenia wskazujące na tag, którego
 * dla użytkownika już nie ma.
 *
 * Liczą się wyłącznie ćwiczenia **żywe**: ćwiczenie z tombstonem jest dla
 * użytkownika nieistniejące, więc nie ma czego trzymać przy życiu jego tagom.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from './db.js';
import { exerciseTags, exercises } from './schema.js';

/** Czy jakiekolwiek nieusunięte ćwiczenie używa tagu — jako główny albo dodatkowy. */
export async function isTagInUse(db: Database, tagId: string): Promise<boolean> {
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

/** Komunikat wspólny dla obu wejść — jedna reguła, jedno zdanie. */
export const TAG_IN_USE_MESSAGE = 'Tag jest używany przez ćwiczenia i nie może zostać usunięty';
