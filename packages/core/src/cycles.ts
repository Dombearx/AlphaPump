/**
 * Cykle — dopasowywanie serii do celów i liczenie postępu.
 *
 * Cykl to zestaw pozycji celu w zadanym zakresie dat. Seria nie jest do cyklu
 * przypisywana ręcznie: system dopasowuje ją automatycznie do **wszystkich**
 * pasujących cykli. Skrót „wybierz ćwiczenie z listy pozostałych pozycji" jest
 * wyłącznie wygodą przy wskazywaniu ćwiczenia, nie przypisaniem.
 *
 * W celach opartych o tag liczy się wyłącznie **tag główny** ćwiczenia. Tagi
 * dodatkowe są etykietami do przeglądania biblioteki i nie zaliczają serii.
 *
 * Postęp jest daną pochodną — przeliczaną z serii, a nie akumulowaną. Dzięki
 * temu usunięcie serii po prostu zmniejsza postęp, bez korekt wstecznych.
 */

import { addDays, differenceInDays, isWithinRange, type IsoDate } from './dates.js';
import type { GoalMetric } from './schemas.js';

/** Minimum, jakiego algorytm potrzebuje od serii. `WorkoutSet` to spełnia. */
export interface CycleMatchableSet {
  exerciseId: string;
  performedOn: IsoDate;
  durationS: number | null;
  distanceM: number | null;
}

/** Minimum, jakiego algorytm potrzebuje od ćwiczenia. `Exercise` to spełnia. */
export interface CycleMatchableExercise {
  id: string;
  primaryTagId: string;
}

/** Minimum, jakiego algorytm potrzebuje od pozycji celu. `CycleGoal` to spełnia. */
export interface CycleMatchableGoal {
  id: string;
  metric: GoalMetric;
  target: number;
  exerciseId: string | null;
  tagId: string | null;
}

/** Minimum, jakiego algorytm potrzebuje od cyklu. `Cycle` to spełnia. */
export interface CycleMatchable {
  id: string;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  goals: readonly CycleMatchableGoal[];
}

export type GoalScope = { kind: 'exercise'; id: string } | { kind: 'tag'; id: string };

export function goalScope(goal: CycleMatchableGoal): GoalScope {
  if (goal.exerciseId !== null) return { kind: 'exercise', id: goal.exerciseId };
  if (goal.tagId !== null) return { kind: 'tag', id: goal.tagId };
  throw new RangeError(`Pozycja celu ${goal.id} nie wskazuje ani ćwiczenia, ani tagu`);
}

/** Czy dzień mieści się w zakresie cyklu (zakres domknięty obustronnie). */
export function isDayWithinCycle(cycle: CycleMatchable, day: IsoDate): boolean {
  return isWithinRange(day, cycle.startsOn, cycle.endsOn);
}

export function goalMatchesExercise(
  goal: CycleMatchableGoal,
  exercise: CycleMatchableExercise,
): boolean {
  const scope = goalScope(goal);
  return scope.kind === 'exercise' ? scope.id === exercise.id : scope.id === exercise.primaryTagId;
}

/**
 * Ile dana seria wnosi do pozycji celu. Zero oznacza, że seria nie zasila tego
 * celu — na przykład cel dystansowy, a seria bez dystansu.
 */
export function goalContribution(goal: CycleMatchableGoal, set: CycleMatchableSet): number {
  switch (goal.metric) {
    case 'sets':
      return 1;
    case 'duration':
      return set.durationS ?? 0;
    case 'distance':
      return set.distanceM ?? 0;
  }
}

/**
 * Czy seria zalicza się do pozycji celu: mieści się w zakresie dat cyklu,
 * pasuje zakresem (ćwiczenie albo tag główny) i faktycznie wnosi wartość.
 */
export function setMatchesGoal(
  cycle: CycleMatchable,
  goal: CycleMatchableGoal,
  set: CycleMatchableSet,
  exercise: CycleMatchableExercise,
): boolean {
  if (set.exerciseId !== exercise.id) return false;
  if (!isDayWithinCycle(cycle, set.performedOn)) return false;
  if (!goalMatchesExercise(goal, exercise)) return false;
  return goalContribution(goal, set) > 0;
}

export interface GoalProgress {
  goalId: string;
  metric: GoalMetric;
  target: number;
  current: number;
  /** Ile brakuje do celu; nigdy ujemne. */
  remaining: number;
  /** Udział w celu, przycięty do przedziału 0–1. */
  ratio: number;
  completed: boolean;
}

export interface CycleProgress {
  cycleId: string;
  goals: GoalProgress[];
  /** Średnia z przyciętych udziałów pozycji — „90 procent celu" ze specyfikacji. */
  ratio: number;
  completed: boolean;
}

/**
 * Postęp cyklu policzony od zera z podanych serii.
 *
 * `exerciseById` musi rozwiązywać ćwiczenia wszystkich podanych serii; serie
 * ćwiczeń nieznanych są pomijane, bo bez tagu głównego nie da się rozstrzygnąć
 * celów tagowych.
 */
export function computeCycleProgress(
  cycle: CycleMatchable,
  sets: readonly CycleMatchableSet[],
  exerciseById: (exerciseId: string) => CycleMatchableExercise | undefined,
): CycleProgress {
  const goals = cycle.goals.map((goal) => {
    let current = 0;
    for (const set of sets) {
      const exercise = exerciseById(set.exerciseId);
      if (exercise === undefined) continue;
      if (!setMatchesGoal(cycle, goal, set, exercise)) continue;
      current += goalContribution(goal, set);
    }

    const ratio = goal.target === 0 ? 1 : Math.min(current / goal.target, 1);
    return {
      goalId: goal.id,
      metric: goal.metric,
      target: goal.target,
      current,
      remaining: Math.max(goal.target - current, 0),
      ratio,
      completed: current >= goal.target,
    } satisfies GoalProgress;
  });

  const ratio =
    goals.length === 0 ? 0 : goals.reduce((sum, goal) => sum + goal.ratio, 0) / goals.length;

  return {
    cycleId: cycle.id,
    goals,
    ratio,
    completed: goals.length > 0 && goals.every((goal) => goal.completed),
  };
}

/**
 * Cykle, do których zalicza się dana seria. Jedna seria może zasilać wiele
 * cykli równocześnie — i tak właśnie ma być.
 */
export function findMatchingCycles<T extends CycleMatchable>(
  cycles: readonly T[],
  set: CycleMatchableSet,
  exercise: CycleMatchableExercise,
): T[] {
  return cycles.filter((cycle) =>
    cycle.goals.some((goal) => setMatchesGoal(cycle, goal, set, exercise)),
  );
}

/** Pozycje jeszcze niezrealizowane — źródło skrótu wyboru ćwiczenia z cyklu. */
export function remainingGoals(progress: CycleProgress): GoalProgress[] {
  return progress.goals.filter((goal) => !goal.completed);
}

/* ------------------------------------------------------------------- okresy */

/**
 * Zakres dat cyklu. Osobny typ, bo reset i podgląd poprzednich okresów operują
 * na samym zakresie — pozycje celu zostają te same.
 */
export interface CycleRange {
  startsOn: IsoDate;
  endsOn: IsoDate | null;
}

/** Długość cyklu w dniach; `null` dla cyklu bez daty końca. */
export function cycleLengthDays(range: CycleRange): number | null {
  if (range.endsOn === null) return null;
  return differenceInDays(range.startsOn, range.endsOn) + 1;
}

/**
 * Zakres po resecie. Reset to przesunięcie początku liczenia — koniec jedzie
 * za nim o tyle samo dni, więc „cel miesięczny" po resecie dalej trwa miesiąc.
 *
 * Historii nie ruszamy i ruszać nie ma czego: postęp jest liczony z serii, więc
 * poprzednie realizacje da się przeliczyć w każdej chwili — patrz
 * `previousCyclePeriod`.
 */
export function resetCycleRange(range: CycleRange, startsOn: IsoDate): CycleRange {
  const length = cycleLengthDays(range);
  return { startsOn, endsOn: length === null ? null : addDays(startsOn, length - 1) };
}

/**
 * Okres poprzedzający bieżący — okno tej samej długości, przyklejone do niego
 * od dołu. `offset` równy dwóm daje okres przedostatni i tak dalej.
 *
 * To jest odpowiedź na wymaganie „sprawdzenie, na jakim poziomie użytkownik
 * zrealizował cykl w poprzednich okresach". Nie trzymamy żadnej osobnej tabeli
 * realizacji: skoro postęp jest liczony z serii, a serie zostają, wystarczy
 * policzyć go dla wcześniejszego okna. Postęp poprzedniego okresu liczy się
 * przez `computeCycleProgress` z cyklem podmienionym na ten zakres.
 *
 * Cykl bez daty końca nie ma długości, więc nie ma też poprzedniego okresu —
 * wtedy `null`.
 */
export function previousCyclePeriod(range: CycleRange, offset = 1): CycleRange | null {
  const length = cycleLengthDays(range);
  if (length === null || offset < 1) return null;

  const startsOn = addDays(range.startsOn, -offset * length);
  return { startsOn, endsOn: addDays(startsOn, length - 1) };
}
