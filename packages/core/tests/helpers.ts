import type { IsoDate } from '../src/dates.js';
import type { SetMeasurements } from '../src/logging-type.js';

export interface TestSet extends SetMeasurements {
  id: string;
  exerciseId: string;
  performedOn: IsoDate;
  position: number;
  bodyweightG: number | null;
}

let counter = 0;

/** Buduje serię testową; nieustawione pomiary pozostają puste. */
export function makeSet(overrides: Partial<TestSet> = {}): TestSet {
  counter += 1;
  return {
    id: `00000000-0000-7000-8000-${String(counter).padStart(12, '0')}`,
    exerciseId: 'exercise-1',
    performedOn: '2026-08-10',
    position: 0,
    weightG: null,
    reps: null,
    durationS: null,
    distanceM: null,
    bodyweightG: null,
    ...overrides,
  };
}

/** Skrót dla serii typu „ciężar + powtórzenia" — kilogramy i powtórzenia. */
export function weightReps(kilograms: number, reps: number, overrides: Partial<TestSet> = {}) {
  return makeSet({ weightG: kilograms * 1000, reps, ...overrides });
}
