/**
 * Lista przeliczeń danych pochodnych.
 *
 * Do tej pory `sync/derived.ts` zbierał zakres dotknięty pushem i przepuszczał
 * go przez **pustą** listę. Był to stan zamierzony: jedyne dane pochodne
 * trzymane na serwerze to rekordy globalne i rankingi, a te powstały dopiero
 * teraz. Rekordy indywidualne nie wchodzą tu w ogóle — są funkcją serii jednego
 * użytkownika, a te w całości leżą na jego telefonie. Właśnie dlatego informacja
 * o rekordzie po zapisie serii działa bez sieci.
 *
 * Rankingu objętości i dystansu na tej liście nie ma i być nie powinno:
 * to zwykłe sumy po seriach, liczone zapytaniem w chwili pytania. Cache dla nich
 * dokładałby stan do utrzymania i możliwość rozjazdu, nie kupując niczego.
 * Materializowany jest wyłącznie front Pareto — bo jego policzenie wymaga serii
 * wszystkich użytkowników, a ranking „liczba rekordów" jest po prostu
 * zliczeniem po jego wierszach.
 */

import type { DerivedRecomputation } from '../sync/derived.js';
import { recomputeGlobalRecords } from './global-records.js';

export {
  affectedExercises,
  recomputeGlobalRecords,
  recomputeGlobalRecordsFor,
} from './global-records.js';

/** Domyślny zestaw przeliczeń wołany po każdej zmianie serii. */
export const DERIVED_RECOMPUTATIONS: readonly DerivedRecomputation[] = [recomputeGlobalRecords];
