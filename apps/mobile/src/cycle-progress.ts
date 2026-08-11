/**
 * Postęp cykli — sklejenie wierszy z bazy z liczeniem z rdzenia.
 *
 * Moduł jest czysty: dostaje to, co przyniosły zapytania, i oddaje gotowe do
 * pokazania obiekty. Nie ma tu ani bazy, ani komponentów, więc da się go
 * przetestować bez renderowania ekranu — i tam właśnie sprawdzamy kryterium
 * etapu 9: „cykl poprawnie zlicza serie, czas i dystans, a usunięcie serii
 * odpowiednio zmniejsza postęp".
 *
 * Samego zliczania tu nie ma. Robi je `computeCycleProgress` z `@alphapump/core`
 * — ten sam kod, którym policzy je serwer i panel. Druga implementacja
 * rozjechałaby się przy pierwszej zmianie reguł, a rozjazd w liczeniu postępu
 * jest niewidoczny w kodzie i bardzo widoczny dla użytkownika.
 */

import {
  computeCycleProgress,
  previousCyclePeriod,
  remainingGoals,
  type CycleMatchable,
  type CycleMatchableExercise,
  type CycleProgress,
  type GoalMetric,
  type GoalProgress,
  type IsoDate,
} from '@alphapump/core';
import type { CycleGoalRow, CycleListRow, CycleSetRow } from './db/queries';

/** Cykl z pozycjami celu — kształt, którego oczekuje rdzeń, plus nazwy do UI. */
export interface CycleWithGoals extends CycleMatchable {
  name: string;
  archivedAt: Date | null;
  goals: CycleGoalRow[];
}

export interface CycleSummary {
  cycle: CycleWithGoals;
  progress: CycleProgress;
}

/** Łączy wiersze cykli z ich pozycjami. Cykl bez pozycji celu zostaje pominięty. */
export function withGoals(
  cycles: readonly CycleListRow[],
  goals: readonly CycleGoalRow[],
): CycleWithGoals[] {
  return cycles
    .map((cycle) => ({
      ...cycle,
      goals: goals.filter((goal) => goal.cycleId === cycle.id),
    }))
    .filter((cycle) => cycle.goals.length > 0);
}

/**
 * Rozwiązywanie ćwiczeń dla rdzenia.
 *
 * Tag główny przyjeżdża razem z serią (patrz `setsForCycles`), więc mapa
 * powstaje z samych serii — bez czytania biblioteki. Ćwiczenie, którego
 * użytkownik nigdy nie wykonał, nie jest tu potrzebne: bez serii nie ma czego
 * zaliczać.
 */
function exerciseResolver(
  sets: readonly CycleSetRow[],
): (exerciseId: string) => CycleMatchableExercise | undefined {
  const byId = new Map<string, CycleMatchableExercise>();
  for (const set of sets) {
    if (!byId.has(set.exerciseId)) {
      byId.set(set.exerciseId, { id: set.exerciseId, primaryTagId: set.primaryTagId });
    }
  }
  return (exerciseId) => byId.get(exerciseId);
}

export function cycleSummaries(
  cycles: readonly CycleWithGoals[],
  sets: readonly CycleSetRow[],
): CycleSummary[] {
  const exerciseById = exerciseResolver(sets);
  return cycles.map((cycle) => ({
    cycle,
    progress: computeCycleProgress(cycle, sets, exerciseById),
  }));
}

/**
 * Realizacja poprzedniego okresu — „miesiąc wcześniej osiągnął 90 procent".
 *
 * Liczona z tych samych serii, na zakresie przesuniętym w tył o długość cyklu.
 * Nie ma osobnej tabeli realizacji i nie musi być: skoro postęp jest daną
 * pochodną, historia siedzi w seriach, a te zostają także po resecie.
 */
export function previousPeriodProgress(
  cycle: CycleWithGoals,
  sets: readonly CycleSetRow[],
  offset = 1,
): { period: { startsOn: IsoDate; endsOn: IsoDate }; progress: CycleProgress } | null {
  const period = previousCyclePeriod(cycle, offset);
  if (period === null || period.endsOn === null) return null;

  const progress = computeCycleProgress(
    { ...cycle, startsOn: period.startsOn, endsOn: period.endsOn },
    sets,
    exerciseResolver(sets),
  );

  return { period: { startsOn: period.startsOn, endsOn: period.endsOn }, progress };
}

/** Od kiedy trzeba czytać serie, żeby policzyć podane cykle i ich poprzednie okresy. */
export function earliestRelevantDay(cycles: readonly CycleWithGoals[], fallback: IsoDate): IsoDate {
  let earliest: IsoDate | null = null;

  for (const cycle of cycles) {
    const previous = previousCyclePeriod(cycle);
    const day = previous?.startsOn ?? cycle.startsOn;
    if (earliest === null || day < earliest) earliest = day;
  }

  return earliest ?? fallback;
}

/* ---------------------------------------------------- skrót wyboru ćwiczenia */

/**
 * Pozycja pozostała do wykonania — element skrótu na ekranie wyboru ćwiczenia.
 *
 * Wybór z tej listy jest **wyłącznie wygodą przy wskazywaniu ćwiczenia**, a nie
 * przypisaniem serii do cyklu. Przypisania nie ma w ogóle: seria zalicza się
 * sama do wszystkich pasujących cykli, także wtedy, gdy użytkownik zapisał ją
 * zwykłą drogą i o żadnym cyklu nie myślał.
 */
export interface RemainingTarget {
  goalId: string;
  cycleId: string;
  cycleName: string;
  metric: GoalMetric;
  /** Nazwa ćwiczenia albo tagu — to, co użytkownik widzi na przycisku. */
  label: string;
  color: string | null;
  /** Wskazanie ćwiczenia; puste dla celu tagowego, który zawęża bibliotekę. */
  exerciseId: string | null;
  tagId: string | null;
  remaining: number;
}

const DEFAULT_COLOR = null;

/**
 * Pozostałe pozycje aktywnych cykli, po jednej na cel, w kolejności „najbliżej
 * ukończenia najpierw". Cykl, który nie obejmuje wskazanego dnia, w ogóle się tu
 * nie pojawia — dopisanie serii wstecz nie ma jak zasilić dzisiejszego celu.
 */
export function remainingTargets(
  summaries: readonly CycleSummary[],
  day: IsoDate,
): RemainingTarget[] {
  const targets: RemainingTarget[] = [];

  for (const { cycle, progress } of summaries) {
    if (cycle.archivedAt !== null) continue;
    if (day < cycle.startsOn) continue;
    if (cycle.endsOn !== null && day > cycle.endsOn) continue;

    for (const goal of remainingGoals(progress)) {
      const row = cycle.goals.find((candidate) => candidate.id === goal.goalId);
      if (row === undefined) continue;

      targets.push({
        goalId: goal.goalId,
        cycleId: cycle.id,
        cycleName: cycle.name,
        metric: goal.metric,
        label: row.exerciseName ?? row.tagName ?? 'Pozycja celu',
        color: row.tagColor ?? DEFAULT_COLOR,
        exerciseId: row.exerciseId,
        tagId: row.tagId,
        remaining: goal.remaining,
      });
    }
  }

  return targets.sort((a, b) => a.remaining - b.remaining || a.label.localeCompare(b.label));
}

/** Ile z pozycji zostało — do podpisu pod skrótem i pod paskiem postępu. */
export function describeGoalProgress(goal: GoalProgress, format: MetricFormat): string {
  return `${format(goal.metric, goal.current)} / ${format(goal.metric, goal.target)}`;
}

export type MetricFormat = (metric: GoalMetric, value: number) => string;
