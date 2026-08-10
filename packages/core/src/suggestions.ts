/**
 * Podpowiadanie wartości kolejnej serii.
 *
 * Reguła ze specyfikacji, wprost:
 *
 * - kolejna seria tego samego ćwiczenia **tego samego dnia** → wartości
 *   z ostatnio zapisanej serii tego dnia,
 * - pierwsza seria ćwiczenia w danym dniu → wartości z **pierwszej** serii
 *   z ostatniego wcześniejszego dnia, w którym to ćwiczenie było wykonywane.
 *
 * Przykład ze specyfikacji: w poniedziałek 10, 9, 6, 4 powtórzenia → w środę
 * pierwsza seria podpowiada 10; po wpisaniu w środę 8, kolejna podpowiada 8.
 *
 * Dzień „wcześniejszy" liczony jest **ściśle przed** dniem docelowym, więc
 * uzupełnianie historii wstecz podpowiada z historii, a nie z przyszłości.
 */

import { compareIsoDates, type IsoDate } from './dates.js';
import type { LoggingType, MeasurementKey, SetMeasurements } from './logging-type.js';
import { requiredMeasurements, usesBodyweight } from './logging-type.js';

/** Minimum, jakiego algorytm potrzebuje od serii. `WorkoutSet` to spełnia. */
export interface SuggestableSet extends SetMeasurements {
  id: string;
  performedOn: IsoDate;
  position: number;
  bodyweightG: number | null;
}

export type SuggestionReason = 'same-day' | 'previous-day';

export interface NextSetSuggestion<T> {
  /** Seria, z której wzięto wartości — przydaje się do pokazania kontekstu. */
  source: T;
  reason: SuggestionReason;
  /** Wyłącznie pola istotne dla typu logowania; reszta pozostaje `null`. */
  measurements: SetMeasurements;
  bodyweightG: number | null;
}

function comparePosition(a: SuggestableSet, b: SuggestableSet): number {
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pickMeasurements(loggingType: LoggingType, source: SetMeasurements): SetMeasurements {
  const required = new Set<MeasurementKey>(requiredMeasurements(loggingType));
  return {
    weightG: required.has('weightG') ? source.weightG : null,
    reps: required.has('reps') ? source.reps : null,
    durationS: required.has('durationS') ? source.durationS : null,
    distanceM: required.has('distanceM') ? source.distanceM : null,
  };
}

/**
 * Podpowiedź dla kolejnej serii danego ćwiczenia w danym dniu.
 *
 * `sets` to serie **jednego ćwiczenia i jednego użytkownika**, w dowolnej
 * kolejności. Zwraca `null`, gdy ćwiczenie nie było jeszcze nigdy wykonywane —
 * wtedy formularz startuje pusty.
 */
export function suggestNextSet<T extends SuggestableSet>(
  loggingType: LoggingType,
  sets: readonly T[],
  performedOn: IsoDate,
): NextSetSuggestion<T> | null {
  const sameDay = sets.filter((set) => set.performedOn === performedOn);

  if (sameDay.length > 0) {
    const last = [...sameDay].sort(comparePosition).at(-1) as T;
    return {
      source: last,
      reason: 'same-day',
      measurements: pickMeasurements(loggingType, last),
      bodyweightG: usesBodyweight(loggingType) ? last.bodyweightG : null,
    };
  }

  const earlier = sets.filter((set) => compareIsoDates(set.performedOn, performedOn) < 0);
  if (earlier.length === 0) return null;

  const lastDay = earlier.reduce(
    (latest, set) => (compareIsoDates(set.performedOn, latest) > 0 ? set.performedOn : latest),
    earlier[0]?.performedOn as IsoDate,
  );

  const first = earlier.filter((set) => set.performedOn === lastDay).sort(comparePosition)[0] as T;

  return {
    source: first,
    reason: 'previous-day',
    measurements: pickMeasurements(loggingType, first),
    bodyweightG: usesBodyweight(loggingType) ? first.bodyweightG : null,
  };
}

/**
 * Kolejny wolny numer pozycji w obrębie dnia — nowa seria ląduje na końcu listy.
 */
export function nextPosition(sets: readonly SuggestableSet[], performedOn: IsoDate): number {
  const sameDay = sets.filter((set) => set.performedOn === performedOn);
  if (sameDay.length === 0) return 0;
  return Math.max(...sameDay.map((set) => set.position)) + 1;
}
