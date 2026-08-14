/**
 * Dane ekranu analitycznego ćwiczenia.
 *
 * Moduł jest czysty — dostaje serie z bazy lokalnej i oddaje gotowe punkty
 * wykresu. Wykres jest więc daną **odczytywaną offline**, dokładnie tak, jak
 * wymaga tego specyfikacja: brak internetu nie może blokować odczytu wykresów.
 *
 * ## Dlaczego jeden punkt na dzień
 *
 * Historia ćwiczenia to kilkaset serii rozsypanych po kilkudziesięciu dniach
 * treningowych. Punkt na serię dałby wykres, na którym nie widać niczego poza
 * gęstością; punkt na dzień pokazuje to, po co się na wykres patrzy — czy
 * z tygodnia na tydzień idzie w górę.
 *
 * ## Które metryki
 *
 * Metryki wynikają z typu logowania, bo tylko one mają dla niego sens: przy
 * biegu nie ma czego pokazywać na osi ciężaru. Dla każdego typu jest to
 * najlepszy wynik dnia na każdej osi rekordu, jedna metryka sumaryczna
 * (objętość, łączny dystans albo łączny czas) i liczba serii.
 */

import {
  recordAxes,
  setVolume,
  type IsoDate,
  type LoggingType,
  type MeasurementKey,
  type SetMeasurements,
} from '@alphapump/core';
import type { MeasurementKind } from './measurements';

/** Seria w kształcie, jakiego potrzebuje wykres. `WorkoutSetRow` to spełnia. */
export interface ChartableSet extends SetMeasurements {
  performedOn: IsoDate;
}

/**
 * Sposób złożenia wartości dnia z serii tego dnia:
 * `best` bierze najlepszy wynik, `total` sumuje, `count` liczy serie.
 */
export type ChartAggregate = 'best' | 'total' | 'count';

export interface ChartMetric {
  key: string;
  label: string;
  /** Jak sformatować wartość — ta sama skala co przy pojedynczej serii. */
  kind: MeasurementKind | 'count';
  aggregate: ChartAggregate;
}

const AXIS_METRICS: Readonly<Record<MeasurementKey, ChartMetric>> = {
  weightG: { key: 'weightG', label: 'Weight', kind: 'weight', aggregate: 'best' },
  reps: { key: 'reps', label: 'Reps', kind: 'reps', aggregate: 'best' },
  durationS: { key: 'durationS', label: 'Time', kind: 'duration', aggregate: 'best' },
  distanceM: { key: 'distanceM', label: 'Distance', kind: 'distance', aggregate: 'best' },
};

/**
 * Metryka sumaryczna typu logowania.
 *
 * Objętość (ciężar × powtórzenia) jest tą liczbą, po której widać pracę
 * włożoną w trening — pojedyncza seria rekordowa nie mówi o niej nic. Przy
 * ćwiczeniach bez ciężaru tę samą rolę pełni suma powtórzeń, czasu albo
 * dystansu.
 */
const TOTAL_METRIC: Readonly<Record<LoggingType, ChartMetric>> = {
  weight_reps: { key: 'volume', label: 'Volume', kind: 'weight', aggregate: 'total' },
  weight_time: { key: 'totalDuration', label: 'Total time', kind: 'duration', aggregate: 'total' },
  bodyweight_reps: {
    key: 'totalReps',
    label: 'Total reps',
    kind: 'reps',
    aggregate: 'total',
  },
  bodyweight_time: {
    key: 'totalDuration',
    label: 'Total time',
    kind: 'duration',
    aggregate: 'total',
  },
  distance_time: {
    key: 'totalDistance',
    label: 'Total distance',
    kind: 'distance',
    aggregate: 'total',
  },
};

const SETS_METRIC: ChartMetric = {
  key: 'sets',
  label: 'Sets',
  kind: 'count',
  aggregate: 'count',
};

/** Metryki do przełączania na ekranie ćwiczenia, w kolejności pokazywania. */
export function metricsFor(loggingType: LoggingType): ChartMetric[] {
  return [
    ...recordAxes(loggingType).map((axis) => AXIS_METRICS[axis]),
    TOTAL_METRIC[loggingType],
    SETS_METRIC,
  ];
}

/** Ile dana seria wnosi do metryki. Zero znaczy „nie wnosi nic". */
function contribution(metric: ChartMetric, set: ChartableSet): number {
  switch (metric.key) {
    case 'volume':
      return setVolume(set);
    case 'totalReps':
      return set.reps ?? 0;
    case 'totalDuration':
      return set.durationS ?? 0;
    case 'totalDistance':
      return set.distanceM ?? 0;
    case 'sets':
      return 1;
    default:
      return set[metric.key as MeasurementKey] ?? 0;
  }
}

export interface ChartPoint {
  day: IsoDate;
  value: number;
}

/**
 * Punkty wykresu — jeden na dzień treningowy, chronologicznie.
 *
 * Dni bez serii **nie** są uzupełniane zerami: przerwa w treningu nie jest
 * wynikiem zerowym i nie ma powodu, żeby ciągnęła wykres w dół.
 */
export function chartPoints(metric: ChartMetric, sets: readonly ChartableSet[]): ChartPoint[] {
  const byDay = new Map<IsoDate, number>();

  for (const set of sets) {
    const value = contribution(metric, set);
    if (value <= 0) continue;

    const current = byDay.get(set.performedOn);
    if (current === undefined) {
      byDay.set(set.performedOn, value);
      continue;
    }
    byDay.set(
      set.performedOn,
      metric.aggregate === 'best' ? Math.max(current, value) : current + value,
    );
  }

  return [...byDay.entries()]
    .map(([day, value]) => ({ day, value }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
}

export interface ChartSummary {
  points: ChartPoint[];
  best: ChartPoint | null;
  latest: ChartPoint | null;
  max: number;
}

/**
 * Punkty razem z tym, co i tak trzeba policzyć, żeby narysować słupki: wartość
 * największa (skala osi) oraz punkty skrajne pokazywane pod wykresem.
 */
export function chartSummary(metric: ChartMetric, sets: readonly ChartableSet[]): ChartSummary {
  const points = chartPoints(metric, sets);
  const max = points.reduce((highest, point) => Math.max(highest, point.value), 0);
  const best = points.reduce<ChartPoint | null>(
    (winner, point) => (winner === null || point.value > winner.value ? point : winner),
    null,
  );

  return { points, best, latest: points.at(-1) ?? null, max };
}

/**
 * Ostatnie `limit` punktów — tyle, ile mieści się na ekranie telefonu bez
 * ściskania słupków do niewidoczności. Historia jest cała w bazie, ale wykres
 * ma pokazywać ostatni okres, a nie wszystko naraz.
 */
export function recentPoints(points: readonly ChartPoint[], limit: number): ChartPoint[] {
  return points.slice(Math.max(points.length - limit, 0));
}
