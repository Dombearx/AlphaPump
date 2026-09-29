/**
 * Rekordy — front Pareto.
 *
 * To jest ta część projektu, która musi być bezbłędna: ten sam algorytm liczy
 * rekordy indywidualne na telefonie (offline, natychmiast po zapisie serii)
 * i rekordy globalne na serwerze. Rozjazd między tymi dwoma miejscami byłby
 * niewidoczny w kodzie i bardzo widoczny dla użytkownika — aplikacja
 * pokazywałaby inny rekord niż ranking.
 *
 * Rekordem jest każdy punkt **niezdominowany**: taki, dla którego nie istnieje
 * seria jednocześnie nie gorsza na wszystkich osiach i lepsza na przynajmniej
 * jednej. Dzięki temu 15 kg × 10 i 10 kg × 20 mogą być rekordami równocześnie.
 *
 * Rekordy są danymi pochodnymi — w każdej chwili odtwarzalnymi z samych serii.
 * Po edycji lub usunięciu serii przelicza się je od zera, a nie korygująco.
 */

import { compareIsoDates, type IsoDate } from './dates.js';
import {
  hasCompleteMeasurements,
  recordAxes,
  type LoggingType,
  type SetMeasurements,
} from './logging-type.js';

/** Punkt w przestrzeni rekordu. Każda współrzędna jest maksymalizowana. */
export type ParetoPoint = readonly number[];

/**
 * Czy `a` dominuje `b`: nie gorszy na każdej osi i lepszy na co najmniej jednej.
 * Dokładny remis **nie** jest dominacją — oba punkty zostają na froncie.
 */
export function dominates(a: ParetoPoint, b: ParetoPoint): boolean {
  if (a.length !== b.length) {
    throw new RangeError('Porównywane punkty muszą mieć tę samą liczbę osi');
  }

  let strictlyBetterOnSomeAxis = false;
  for (let axis = 0; axis < a.length; axis += 1) {
    const left = a[axis] as number;
    const right = b[axis] as number;
    if (left < right) return false;
    if (left > right) strictlyBetterOnSomeAxis = true;
  }
  return strictlyBetterOnSomeAxis;
}

export function pointsEqual(a: ParetoPoint, b: ParetoPoint): boolean {
  return a.length === b.length && a.every((value, axis) => value === b[axis]);
}

/**
 * Punkty niezdominowane. Elementy o identycznych współrzędnych są zachowywane
 * wszystkie — odsiewanie remisów to decyzja prezentacji, nie algorytmu.
 */
export function paretoFront<T>(items: readonly T[], project: (item: T) => ParetoPoint | null): T[] {
  const projected = items
    .map((item) => ({ item, point: project(item) }))
    .filter((entry): entry is { item: T; point: ParetoPoint } => entry.point !== null);

  return projected
    .filter(({ point }) => !projected.some((other) => dominates(other.point, point)))
    .map(({ item }) => item);
}

/**
 * Rzutuje serię na punkt rekordu. Zwraca `null`, gdy seria nie ma kompletu
 * pomiarów wymaganych przez typ logowania — takie serie nie biorą udziału
 * w wyznaczaniu rekordów.
 */
export function projectSet(
  loggingType: LoggingType,
  measurements: SetMeasurements,
): ParetoPoint | null {
  if (!hasCompleteMeasurements(loggingType, measurements)) return null;
  return recordAxes(loggingType).map((axis) => measurements[axis] as number);
}

/** Minimum potrzebne, by ustawić serie w porządku chronologicznym. */
export interface ChronologicalSet {
  id: string;
  performedOn: IsoDate;
  position: number;
}

/**
 * Porządek chronologiczny: dzień, potem kolejność w obrębie dnia, na końcu id.
 * Ostatni człon jest tylko po to, żeby porządek był całkowity — inaczej dwa
 * urządzenia mogłyby wskazać różnego zdobywcę tego samego rekordu.
 */
export function compareSetsChronologically(a: ChronologicalSet, b: ChronologicalSet): number {
  const byDay = compareIsoDates(a.performedOn, b.performedOn);
  if (byDay !== 0) return byDay;
  if (a.position !== b.position) return a.position - b.position;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Rekordy ćwiczenia: front Pareto po wszystkich seriach, z remisami zredukowanymi
 * do pierwszego zdobywcy i posortowany malejąco po osiach.
 *
 * Serie należy podać w porządku chronologicznym (`compareSetsChronologically`) —
 * przy remisie rekord przypisujemy tej, która padła wcześniej.
 */
export function computeRecords<T extends SetMeasurements>(
  loggingType: LoggingType,
  sets: readonly T[],
): T[] {
  const project = (set: T) => projectSet(loggingType, set);
  const front = paretoFront(sets, project);

  const seen = new Set<string>();
  const unique: T[] = [];
  for (const set of front) {
    const point = project(set);
    if (point === null) continue;
    const key = point.join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(set);
  }

  return unique.sort((a, b) => {
    const left = project(a) ?? [];
    const right = project(b) ?? [];
    for (let axis = 0; axis < left.length; axis += 1) {
      const difference = (right[axis] as number) - (left[axis] as number);
      if (difference !== 0) return difference;
    }
    return 0;
  });
}

export type RecordOutcome =
  /** Seria wchodzi na front, nie zbijając żadnego dotychczasowego rekordu. */
  | 'new'
  /** Seria wchodzi na front i dominuje przynajmniej jeden dotychczasowy rekord. */
  | 'improved'
  /** Dokładny remis z istniejącym rekordem — bez komunikatu, zgodnie ze specyfikacją. */
  | 'tie'
  /** Seria jest zdominowana przez istniejący rekord. */
  | 'none'
  /** Seria nie ma kompletu pomiarów, więc nie bierze udziału w rekordach. */
  | 'incomplete';

export interface RecordEvaluation<T> {
  outcome: RecordOutcome;
  /** Czy pokazać użytkownikowi informację o rekordzie. */
  isRecord: boolean;
  point: ParetoPoint | null;
  /** Dotychczasowe rekordy zdominowane przez ocenianą serię. */
  beaten: T[];
}

/**
 * Ocenia, czy zapisywana seria jest rekordem — to jest ta ścieżka, która na
 * telefonie musi dać odpowiedź bez sieci, natychmiast po zapisie.
 *
 * `previousSets` to wszystkie wcześniejsze serie tego użytkownika dla tego
 * ćwiczenia, **bez ocenianej serii**. Uwaga: seria historyczna dopisana wstecz
 * jest oceniana tak samo jak dzisiejsza — liczy się cały zbiór, nie kolejność
 * zapisu.
 */
export function evaluateRecord<T extends SetMeasurements>(
  loggingType: LoggingType,
  previousSets: readonly T[],
  candidate: SetMeasurements,
): RecordEvaluation<T> {
  const point = projectSet(loggingType, candidate);
  if (point === null) {
    return { outcome: 'incomplete', isRecord: false, point: null, beaten: [] };
  }

  const previousRecords = computeRecords(loggingType, previousSets);
  const previousPoints = previousRecords.map((set) => projectSet(loggingType, set) as ParetoPoint);

  if (previousPoints.some((previous) => dominates(previous, point))) {
    return { outcome: 'none', isRecord: false, point, beaten: [] };
  }

  if (previousPoints.some((previous) => pointsEqual(previous, point))) {
    return { outcome: 'tie', isRecord: false, point, beaten: [] };
  }

  const beaten = previousRecords.filter((_, index) =>
    dominates(point, previousPoints[index] as ParetoPoint),
  );

  return {
    outcome: beaten.length > 0 ? 'improved' : 'new',
    isRecord: true,
    point,
    beaten,
  };
}

/**
 * Łańcuch poprawiania jednego rekordu — od niego wstecz, aż do wyniku, który
 * nie zbił już niczego.
 *
 * Rekordy są frontem Pareto, więc „poprzedni rekord" nie jest pojęciem z góry
 * danym: jedna seria potrafi zbić kilka wyników naraz, a dwa nieporównywalne
 * rekordy (15 kg × 10 i 10 kg × 20) mają **osobne** historie. Dlatego historia
 * powstaje z odtworzenia frontu seria po serii: zapamiętujemy, co każda z nich
 * zbiła w chwili, gdy padła, a potem idziemy po tych powiązaniach wstecz od
 * wskazanego rekordu. Wynik jest w kolejności odwrotnie chronologicznej, czyli
 * tak, jak się go czyta: najpierw dzisiejszy rekord, na końcu najstarszy wynik
 * w tej linii.
 *
 * Kolejność wejścia nie ma znaczenia — serie są tu sortowane, bo cała ta
 * funkcja jest o czasie, a odwrócony wiersz dałby cichy i wiarygodnie
 * wyglądający fałsz.
 *
 * Pusta lista znaczy „ta seria nigdy nie była rekordem" (była zdominowana albo
 * remisowała) — także wtedy, gdy `setId` nie pasuje do żadnej serii.
 */
export function recordProgression<T extends SetMeasurements & ChronologicalSet>(
  loggingType: LoggingType,
  sets: readonly T[],
  setId: string,
): T[] {
  const chronological = [...sets].sort(compareSetsChronologically);

  /** Każda seria, która weszła na front, wraz z tym, co wtedy zbiła. */
  const steps = new Map<string, { set: T; beaten: T[] }>();
  let front: { set: T; point: ParetoPoint }[] = [];

  for (const set of chronological) {
    const point = projectSet(loggingType, set);
    if (point === null) continue;
    if (front.some((entry) => dominates(entry.point, point) || pointsEqual(entry.point, point))) {
      continue;
    }

    const beaten = front.filter((entry) => dominates(point, entry.point));
    steps.set(set.id, { set, beaten: beaten.map((entry) => entry.set) });
    front = [...front.filter((entry) => !dominates(point, entry.point)), { set, point }];
  }

  const lineage: T[] = [];
  const visited = new Set<string>();
  const queue = [setId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    if (visited.has(id)) continue;
    visited.add(id);

    const step = steps.get(id);
    if (step === undefined) continue;
    lineage.push(step.set);
    for (const ancestor of step.beaten) queue.push(ancestor.id);
  }

  return lineage.sort((a, b) => compareSetsChronologically(b, a));
}

/**
 * Rekordy dla wielu ćwiczeń naraz — używane po edycji serii oraz po każdym
 * pullu synchronizacji, gdy trzeba przeliczyć dotknięte ćwiczenia.
 */
export function computeRecordsByExercise<T extends SetMeasurements & { exerciseId: string }>(
  sets: readonly T[],
  loggingTypeOf: (exerciseId: string) => LoggingType | undefined,
): Map<string, T[]> {
  const byExercise = new Map<string, T[]>();
  for (const set of sets) {
    const bucket = byExercise.get(set.exerciseId);
    if (bucket) bucket.push(set);
    else byExercise.set(set.exerciseId, [set]);
  }

  const records = new Map<string, T[]>();
  for (const [exerciseId, exerciseSets] of byExercise) {
    const loggingType = loggingTypeOf(exerciseId);
    if (loggingType === undefined) continue;
    records.set(exerciseId, computeRecords(loggingType, exerciseSets));
  }
  return records;
}
