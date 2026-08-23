/**
 * Postęp cykli — sklejenie wierszy z bazy z liczeniem z rdzenia.
 *
 * Moduł jest czysty: dostaje to, co przyniosły zapytania, i oddaje gotowe do
 * pokazania obiekty. Nie ma tu ani bazy, ani komponentów, więc da się go
 * przetestować bez renderowania ekranu — i tam właśnie sprawdzamy kryterium
 * produktu: „cykl poprawnie zlicza serie, czas i dystans, a usunięcie serii
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

/* --------------------------------------------------- podpowiedź z cyklu w UI */

/**
 * Pozycja pozostała do wykonania — źródło podpowiedzi na ekranie wyboru
 * ćwiczenia, gdzie tag z niedokończoną robotą dostaje gwiazdkę na przycisku.
 *
 * Podpowiedź jest **wyłącznie wygodą przy wskazywaniu ćwiczenia**, a nie
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
  /** Tag główny wskazanego ćwiczenia — ten, w którym pozycja się zalicza. */
  exerciseTagId: string | null;
  remaining: number;
  /** Udział wykonania pozycji, 0–1 — z niego bierze się wypełnienie chipsa. */
  ratio: number;
}

const DEFAULT_COLOR = null;

/**
 * Cykle aktywne w danym dniu — nieprzarchiwizowane i obejmujące go zakresem.
 * Dzielą go `remainingTargets` i `tagCycleProgress`, żeby ten sam dzień dawał
 * ten sam zestaw cykli obu liczeniom.
 */
function activeCycleSummaries(
  summaries: readonly CycleSummary[],
  day: IsoDate,
): readonly CycleSummary[] {
  return summaries.filter(
    ({ cycle }) =>
      cycle.archivedAt === null &&
      day >= cycle.startsOn &&
      (cycle.endsOn === null || day <= cycle.endsOn),
  );
}

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

  for (const { cycle, progress } of activeCycleSummaries(summaries, day)) {
    for (const goal of remainingGoals(progress)) {
      const row = cycle.goals.find((candidate) => candidate.id === goal.goalId);
      if (row === undefined) continue;

      targets.push({
        goalId: goal.goalId,
        cycleId: cycle.id,
        cycleName: cycle.name,
        metric: goal.metric,
        label: row.exerciseName ?? row.tagName ?? 'Goal item',
        color: row.tagColor ?? DEFAULT_COLOR,
        exerciseId: row.exerciseId,
        tagId: row.tagId,
        exerciseTagId: row.exercisePrimaryTagId,
        remaining: goal.remaining,
        ratio: goal.ratio,
      });
    }
  }

  return targets.sort((a, b) => a.remaining - b.remaining || a.label.localeCompare(b.label));
}

/**
 * Tagi objęte celami aktywnych cykli, wraz z udziałem wykonania — do gwiazdki
 * na chipsie tagu i do wypełnienia jego tła.
 *
 * Pozycja tagowa wskazuje swój tag wprost, pozycja z ćwiczeniem — tag główny
 * tego ćwiczenia, bo to on rozstrzyga, gdzie ćwiczenie stoi na liście. Pozycja,
 * której nie da się przypisać do żadnego tagu (usunięte ćwiczenie), nie oznacza
 * żadnego tagu, zamiast oznaczać wszystkie.
 *
 * Tag **zrobiony w całości zostaje w mapie** z udziałem równym jedynce, więc
 * jego chips jest wypełniony do końca. Znikanie wypełnienia w momencie
 * dokończenia roboty czytało się jak cofnięcie postępu: tag przez cały czas
 * pełzł w prawo, a po ostatniej serii wracał do wyglądu tagu spoza cyklu.
 * Gwiazdkę „tu coś zostało" zapala dopiero udział mniejszy od jedynki — patrz
 * `Chip`.
 *
 * Gdy w jeden tag celuje kilka pozycji, liczy się **robota, a nie liczba
 * pozycji**: w obrębie jednej metryki sumują się wykonania i cele, więc „cztery
 * serie z ośmiu zaplanowanych w tagu" to połowa niezależnie od tego, czy te
 * osiem serii stoi w jednej pozycji, czy w dwóch po cztery. Średnia z udziałów
 * pozycji tego nie dawała: pozycja na jedną serię ważyła w niej tyle samo, co
 * pozycja na dwadzieścia, i wypełnienie rozjeżdżało się z tym, co użytkownik
 * ma jeszcze do zrobienia.
 *
 * Metryk nie da się sumować między sobą — „12 serii" i „30 minut" nie dodają
 * się do żadnej sensownej liczby — więc każda metryka daje swój udział, a tag
 * dostaje ich średnią. W praktyce metryka jest jedna i średnia nie ma czego
 * uśredniać.
 *
 * Wykonanie pojedynczej pozycji wchodzi do sumy przycięte do jej celu: nadmiar
 * w jednej pozycji nie ma zasypywać braku w drugiej.
 */
export function tagCycleProgress(
  summaries: readonly CycleSummary[],
  day: IsoDate,
): ReadonlyMap<string, number> {
  /** Na tag: na metrykę para „zrobione / do zrobienia". */
  const work = new Map<string, Map<GoalMetric, { current: number; target: number }>>();

  for (const { cycle, progress } of activeCycleSummaries(summaries, day)) {
    for (const goal of progress.goals) {
      const row = cycle.goals.find((candidate) => candidate.id === goal.goalId);
      if (row === undefined) continue;

      const tagId = row.tagId ?? row.exercisePrimaryTagId;
      if (tagId === null) continue;

      let byMetric = work.get(tagId);
      if (byMetric === undefined) {
        byMetric = new Map();
        work.set(tagId, byMetric);
      }

      const sum = byMetric.get(goal.metric) ?? { current: 0, target: 0 };
      sum.current += Math.min(goal.current, goal.target);
      sum.target += goal.target;
      byMetric.set(goal.metric, sum);
    }
  }

  return new Map(
    [...work].map(([tagId, byMetric]) => {
      const ratios = [...byMetric.values()].map((sum) =>
        sum.target === 0 ? 1 : Math.min(sum.current / sum.target, 1),
      );
      return [tagId, ratios.reduce((total, ratio) => total + ratio, 0) / ratios.length];
    }),
  );
}

/** Ile z pozycji zostało — do podpisu pod skrótem i pod paskiem postępu. */
export function describeGoalProgress(goal: GoalProgress, format: MetricFormat): string {
  return `${format(goal.metric, goal.current)} / ${format(goal.metric, goal.target)}`;
}

export type MetricFormat = (metric: GoalMetric, value: number) => string;
