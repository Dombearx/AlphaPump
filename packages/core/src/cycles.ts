/**
 * Cykle — dopasowywanie serii do celów i liczenie postępu.
 *
 * Cykl to zestaw pozycji celu w zadanym zakresie dat. Seria nie jest do cyklu
 * przypisywana ręcznie: system dopasowuje ją automatycznie do **wszystkich**
 * pasujących cykli. Oznaczenie tagu, w którym coś jeszcze zostało, jest
 * wyłącznie wygodą przy wskazywaniu ćwiczenia, nie przypisaniem.
 *
 * W celach opartych o tag liczy się wyłącznie **tag główny** ćwiczenia. Tagi
 * dodatkowe są etykietami do przeglądania biblioteki i nie zaliczają serii.
 *
 * Pozycja celu może też wskazywać **intensywność** zamiast ćwiczenia czy tagu —
 * to na tym zakresie stoi cykl WHO (patrz `who.ts`). Zakres intensywnościowy
 * jako jedyny waży wkład serii: minuta wysiłku wysokiej intensywności liczy się
 * w celu umiarkowanym za dwie, bo tak liczą ją wytyczne WHO (`intensity.ts`).
 *
 * Postęp jest daną pochodną — przeliczaną z serii, a nie akumulowaną. Dzięki
 * temu usunięcie serii po prostu zmniejsza postęp, bez korekt wstecznych.
 *
 * Pozycja celu może mieć **dwa poziomy**: `target` (minimalny) i opcjonalny
 * `stretchTarget` (wyższy). Bierze się to wprost z wytycznych WHO, które
 * rozróżniają próg podstawowych korzyści zdrowotnych i próg korzyści
 * dodatkowych — ale mechanizm jest ogólny i działa w każdym cyklu.
 */

import { addDays, differenceInDays, isWithinRange, type IsoDate } from './dates.js';
import { intensityWeight, type Intensity } from './intensity.js';
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
  /** `null` — intensywność nieokreślona; taka seria nie zasila celów WHO. */
  intensity: Intensity | null;
}

/** Minimum, jakiego algorytm potrzebuje od pozycji celu. `CycleGoal` to spełnia. */
export interface CycleMatchableGoal {
  id: string;
  metric: GoalMetric;
  target: number;
  /** Próg wyższy; `null`, gdy pozycja ma jeden poziom. Zawsze większy od `target`. */
  stretchTarget: number | null;
  exerciseId: string | null;
  tagId: string | null;
  intensity: Intensity | null;
}

/** Minimum, jakiego algorytm potrzebuje od cyklu. `Cycle` to spełnia. */
export interface CycleMatchable {
  id: string;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  goals: readonly CycleMatchableGoal[];
}

export type GoalScope =
  | { kind: 'exercise'; id: string }
  | { kind: 'tag'; id: string }
  | { kind: 'intensity'; intensity: Intensity };

export function goalScope(goal: CycleMatchableGoal): GoalScope {
  if (goal.exerciseId !== null) return { kind: 'exercise', id: goal.exerciseId };
  if (goal.tagId !== null) return { kind: 'tag', id: goal.tagId };
  if (goal.intensity !== null) return { kind: 'intensity', intensity: goal.intensity };
  throw new RangeError(
    `Pozycja celu ${goal.id} nie wskazuje ani ćwiczenia, ani tagu, ani intensywności`,
  );
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
  switch (scope.kind) {
    case 'exercise':
      return scope.id === exercise.id;
    case 'tag':
      return scope.id === exercise.primaryTagId;
    case 'intensity':
      return intensityWeight(scope.intensity, exercise.intensity) > 0;
  }
}

/**
 * Ile dana seria wnosi do pozycji celu. Zero oznacza, że seria nie zasila tego
 * celu — na przykład cel dystansowy, a seria bez dystansu.
 *
 * Wkład surowy jest mnożony przez wagę zakresu. Waga jest jedynką wszędzie poza
 * zakresem intensywnościowym, gdzie niesie równoważność WHO: minuta wysiłku
 * wysokiej intensywności wchodzi do celu umiarkowanego za dwie.
 */
export function goalContribution(
  goal: CycleMatchableGoal,
  set: CycleMatchableSet,
  exercise: CycleMatchableExercise,
): number {
  const scope = goalScope(goal);
  const weight =
    scope.kind === 'intensity' ? intensityWeight(scope.intensity, exercise.intensity) : 1;
  if (weight === 0) return 0;

  switch (goal.metric) {
    case 'sets':
      return weight;
    case 'duration':
      return weight * (set.durationS ?? 0);
    case 'distance':
      return weight * (set.distanceM ?? 0);
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
  return goalContribution(goal, set, exercise) > 0;
}

export interface GoalProgress {
  goalId: string;
  metric: GoalMetric;
  target: number;
  /** Próg wyższy pozycji; `null`, gdy pozycja ma jeden poziom. */
  stretchTarget: number | null;
  current: number;
  /** Ile brakuje do celu; nigdy ujemne. */
  remaining: number;
  /** Udział w celu, przycięty do przedziału 0–1. */
  ratio: number;
  completed: boolean;
  /** Udział w progu wyższym, 0–1; `null`, gdy pozycja ma jeden poziom. */
  stretchRatio: number | null;
  stretchCompleted: boolean;
}

/**
 * Poziom realizacji cyklu: `none` — próg minimalny jeszcze nieosiągnięty,
 * `minimal` — osiągnięty, `higher` — osiągnięty także próg wyższy.
 */
export type CycleLevel = 'none' | 'minimal' | 'higher';

export interface CycleProgress {
  cycleId: string;
  goals: GoalProgress[];
  /** Średnia z przyciętych udziałów pozycji — „90 procent celu" ze specyfikacji. */
  ratio: number;
  completed: boolean;
  /** Czy którakolwiek pozycja ma w ogóle próg wyższy — bez tego poziom jest jeden. */
  hasStretch: boolean;
  /** To samo co `ratio`, tylko liczone względem progów wyższych. */
  stretchRatio: number;
  stretchCompleted: boolean;
  level: CycleLevel;
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
      current += goalContribution(goal, set, exercise);
    }

    const ratio = goal.target === 0 ? 1 : Math.min(current / goal.target, 1);
    const stretch = goal.stretchTarget;
    return {
      goalId: goal.id,
      metric: goal.metric,
      target: goal.target,
      stretchTarget: stretch,
      current,
      remaining: Math.max(goal.target - current, 0),
      ratio,
      completed: current >= goal.target,
      stretchRatio: stretch === null ? null : Math.min(current / stretch, 1),
      stretchCompleted: stretch !== null && current >= stretch,
    } satisfies GoalProgress;
  });

  const average = (of: (goal: GoalProgress) => number) =>
    goals.length === 0 ? 0 : goals.reduce((sum, goal) => sum + of(goal), 0) / goals.length;

  const ratio = average((goal) => goal.ratio);
  const completed = goals.length > 0 && goals.every((goal) => goal.completed);

  // Pozycja bez progu wyższego wchodzi do liczenia poziomu wyższego swoim
  // zwykłym udziałem: jej jedyny próg **jest** wszystkim, czego wymaga, więc nie
  // ma powodu, żeby blokowała poziom wyższy całego cyklu.
  const hasStretch = goals.some((goal) => goal.stretchTarget !== null);
  const stretchCompleted =
    completed && goals.every((goal) => goal.stretchTarget === null || goal.stretchCompleted);

  return {
    cycleId: cycle.id,
    goals,
    ratio,
    completed,
    hasStretch,
    stretchRatio: average((goal) => goal.stretchRatio ?? goal.ratio),
    stretchCompleted: hasStretch && stretchCompleted,
    level: completed ? (hasStretch && stretchCompleted ? 'higher' : 'minimal') : 'none',
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
 * Bieżący okres cyklu — okno zawierające `today`, wyprowadzone z długości
 * cyklu bez ruszania zapisanego początku.
 *
 * Cykl o stałej długości ma się liczyć **sam**: gdy minie jego koniec, kolejny
 * okres (tej samej długości) zaczyna się automatycznie, bez ręcznego resetu.
 * `startsOn` zapisany w bazie zostaje kotwicą — stąd liczymy, ile pełnych
 * okresów minęło do dziś, i podstawiamy właściwe okno. Ręczny reset
 * (`resetCycleRange`) służy do czegoś innego: do przesunięcia samej kotwicy,
 * kiedy użytkownik świadomie chce zacząć liczyć od nowa właśnie dziś.
 *
 * Cykl bez daty końca nie ma okresów do przewijania — wraca bez zmian. Cykl,
 * który jeszcze się nie zaczął (`today` przed `startsOn`), też wraca bez
 * zmian: nie ma czego przewijać do przodu.
 */
export function currentCyclePeriod(range: CycleRange, today: IsoDate): CycleRange {
  const length = cycleLengthDays(range);
  if (length === null) return range;

  const endsOn = range.endsOn as IsoDate;
  if (today <= endsOn) return range;

  const periodsElapsed = Math.floor(differenceInDays(range.startsOn, today) / length);
  const startsOn = addDays(range.startsOn, periodsElapsed * length);
  return { startsOn, endsOn: addDays(startsOn, length - 1) };
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
