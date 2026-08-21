/**
 * Reguły tagów.
 *
 * Każda reguła tutaj ma **dwa** wejścia: REST (`/tags`, `/exercises`) i paczkę
 * `POST /sync/push`. Reguła zapisana tylko przy jednym z nich nie jest regułą,
 * tylko zachowaniem jednego endpointu — a push jest wtedy tylnym wejściem, przez
 * które nie obowiązuje. Dlatego mieszkają w warstwie osobnej od obu: predykat
 * i zdanie do pokazania człowiekowi są tu jedne, a każde wejście samo decyduje,
 * czy zamienia je w `409`, czy w odrzucenie wiersza w odpowiedzi pushu.
 *
 * ## „Tagu, na którym coś wisi, nie można usunąć"
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

import { and, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db.js';
import { cycleGoals, cycles, exerciseTags, exercises, tags } from '../schema.js';

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

/** Zdania, którymi obie drogi zapisu tłumaczą odmowę. */
export const TAG_RULES = {
  adminOnly: 'Tag może zmieniać wyłącznie administrator',
  nameTaken: 'Tag o takiej nazwie już istnieje',
  idNotFromName: 'Identyfikator tagu nie wynika z jego nazwy',
  missing: (ids: readonly string[]) => `Nie ma takich tagów: ${ids.join(', ')}`,
} as const;

/**
 * Tag o tym samym slugu, ale innym identyfikatorze — albo `null`.
 *
 * Tag jest bytem globalnym i jego id wynika ze sluga nazwy, więc taki wiersz
 * oznacza klienta, który zbudował identyfikator inaczej. Przyjęcie go rozbiłoby
 * globalną deduplikację, dlatego obie drogi zapisu pytają o to samo.
 */
export async function findTagBySlug(
  db: Database,
  slug: string,
  exceptId: string,
): Promise<typeof tags.$inferSelect | null> {
  const [collision] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.slug, slug), ne(tags.id, exceptId)))
    .limit(1);

  return collision ?? null;
}

/**
 * Identyfikatory tagów, których w bazie nie ma. Pusta lista nie pyta bazy.
 *
 * `aliveOnly` rozdziela dwa wejścia i robi to świadomie. REST wymaga tagu
 * żywego: użytkownik wybiera go z listy, na której tombstone'ów nie widać.
 * Push nie może być tak surowy, bo tag i ćwiczenie jadą w jednej paczce, a tag
 * mógł właśnie przegrać LWW z tombstonem serwera — odrzucenie ćwiczenia
 * zablokowałoby wtedy kolejkę wysyłki telefonu na wiersz, którego użytkownik
 * nawet nie widzi.
 */
export async function missingTagIds(
  db: Database,
  ids: readonly string[],
  { aliveOnly }: { aliveOnly: boolean },
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      aliveOnly ? and(isNull(tags.deletedAt), inArray(tags.id, unique)) : inArray(tags.id, unique),
    );

  const known = new Set(rows.map((row) => row.id));
  return unique.filter((id) => !known.has(id));
}
