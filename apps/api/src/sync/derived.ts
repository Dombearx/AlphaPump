/**
 * Przeliczanie danych pochodnych po stronie serwera.
 *
 * Dane pochodne — rekordy globalne i rankingi — są **cache'em, nie źródłem
 * prawdy**: w każdej chwili odtwarzalne z samych serii. Wynika z tego, że
 * jedynym momentem, w którym trzeba je ruszyć, jest zmiana serii; i że po
 * edycji przelicza się je od zera dla dotkniętego ćwiczenia, a nie korygująco.
 *
 * Ten moduł dostarcza dwie rzeczy:
 *
 * 1. **Zakres dotknięty pushem** — para (użytkownik, ćwiczenie) dla każdej
 *    zapisanej serii. To jest ta informacja, której nie da się odtworzyć
 *    później: po zapisie nie wiadomo już, co się zmieniło, a przeliczanie
 *    wszystkiego przy każdym pushu jest liniowe względem całej bazy.
 * 2. **Miejsce wpięcia przeliczeń** — lista wołana po każdym pushu.
 *
 * Samą listę wypełnia `../derived/index.ts`; bywała pusta, bo jedyne
 * dane pochodne trzymane na serwerze to rekordy globalne i rankingi, a te
 * powstały dopiero tam. Rekordy indywidualne nie wchodzą tu w ogóle — nie
 * przechodzą przez synchronizację w żadną stronę, bo są funkcją serii
 * użytkownika, a te są w całości na jego telefonie. Właśnie dlatego informacja
 * o rekordzie działa bez sieci.
 *
 * Ten moduł dalej nie wie, co konkretnie się przelicza, i wiedzieć nie musi:
 * zbieranie zakresu jest częścią pushu, a lista przeliczeń — częścią złożenia
 * aplikacji.
 */

import type { Database } from '../db.js';

/** Ćwiczenia dotknięte pushem, w rozbiciu na użytkowników. */
export interface AffectedScope {
  /** Klucz: identyfikator użytkownika, wartość: dotknięte ćwiczenia. */
  exercisesByUser: Map<string, Set<string>>;
}

export function emptyScope(): AffectedScope {
  return { exercisesByUser: new Map() };
}

export function noteAffectedSet(scope: AffectedScope, userId: string, exerciseId: string): void {
  const bucket = scope.exercisesByUser.get(userId);
  if (bucket) bucket.add(exerciseId);
  else scope.exercisesByUser.set(userId, new Set([exerciseId]));
}

export function isScopeEmpty(scope: AffectedScope): boolean {
  return scope.exercisesByUser.size === 0;
}

/** Pojedyncze przeliczenie danych pochodnych. */
export type DerivedRecomputation = (db: Database, scope: AffectedScope) => Promise<void>;

/**
 * Uruchamia przeliczenia dla zakresu dotkniętego pushem.
 *
 * Pusty zakres kończy się natychmiast — push samych tagów albo cykli nie rusza
 * niczego, co byłoby pochodną serii.
 */
export async function recomputeDerived(
  db: Database,
  scope: AffectedScope,
  recomputations: readonly DerivedRecomputation[],
): Promise<void> {
  if (isScopeEmpty(scope)) return;
  for (const recompute of recomputations) {
    await recompute(db, scope);
  }
}
