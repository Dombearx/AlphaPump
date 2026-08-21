/**
 * Reguły ćwiczeń.
 *
 * Wspólne dla obu dróg zapisu — REST (`/exercises`) i paczki `POST /sync/push` —
 * z tego samego powodu, dla którego wspólne są reguły tagów: reguła zapisana
 * tylko przy jednej z nich jest zachowaniem jednego endpointu, a druga droga
 * staje się wejściem, przez które nie obowiązuje. Predykat i zdanie do pokazania
 * człowiekowi są tu jedne; REST zamienia je w `403`/`409`, push w odrzucenie
 * wiersza w odpowiedzi.
 *
 * ## „Ćwiczenia z zapisanymi seriami nie można usunąć"
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
 * Usunięcie ma **dwa** wejścia — `DELETE /exercises/:id` i tombstone
 * przyjeżdżający w paczce pushu — i oba pytają o ten sam predykat.
 */

import { and, count, eq, isNull, ne } from 'drizzle-orm';
import type { Principal } from '../context.js';
import type { Database } from '../db.js';
import { cycleGoals, cycles, exercises, workoutSets } from '../schema.js';

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

/** Zdania, którymi obie drogi zapisu tłumaczą odmowę. */
export const EXERCISE_RULES = {
  notAuthor: 'Ćwiczenie może zmieniać wyłącznie jego autor albo administrator',
  loggingTypeFrozen: 'Typ logowania ćwiczenia jest nieedytowalny',
  duplicateTag: 'Tag główny nie może powtarzać się wśród tagów dodatkowych',
  nameTaken: 'Autor ma już ćwiczenie o takiej nazwie',
  idNotFromName: 'Identyfikator ćwiczenia nie wynika z pary autor + nazwa (+ siłownia)',
} as const;

/**
 * Kto może ruszyć ćwiczenie: jego autor albo administrator.
 *
 * Biblioteka jest wspólna do czytania, ale nie do pisania — bez tej reguły
 * wchodzi w problemy rodem z wiki, a samo LWW przestaje wystarczać do
 * rozstrzygania konfliktów.
 */
export function mayModifyExercise(authorId: string, principal: Principal): boolean {
  return principal.role === 'admin' || authorId === principal.id;
}

/** Czy tag główny powtarza się wśród dodatkowych. */
export function repeatsPrimaryTag(
  primaryTagId: string,
  additionalTagIds: readonly string[],
): boolean {
  return additionalTagIds.includes(primaryTagId);
}

/**
 * Czy ten autor ma już inne ćwiczenie o tej nazwie na tej samej siłowni.
 *
 * Identyfikator wynika z trójki autor + nazwa + siłownia **przy tworzeniu**, ale
 * po zmianie nazwy przestaje jej odpowiadać (inaczej poprawienie literówki
 * osierociłoby serie). Unikalność trzeba więc sprawdzać osobno, przy każdym
 * zapisie i z obu stron.
 */
export async function exerciseNameTaken(
  db: Database,
  { authorId, slug, gym, exceptId }: ExerciseIdentity,
): Promise<boolean> {
  const [collision] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.authorId, authorId),
        eq(exercises.slug, slug),
        gym === null ? isNull(exercises.gym) : eq(exercises.gym, gym),
        ne(exercises.id, exceptId),
      ),
    )
    .limit(1);

  return collision !== undefined;
}

export interface ExerciseIdentity {
  authorId: string;
  slug: string;
  gym: string | null;
  /** Wiersz, który sam sobie nie jest kolizją. */
  exceptId: string;
}
