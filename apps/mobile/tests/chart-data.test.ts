/**
 * Wykresy — kryterium ukończenia etapu 10: „wykres ćwiczenia odpowiada jego
 * typowi logowania".
 *
 * Sprawdzane jest jedno i drugie: że zestaw metryk wynika z typu logowania
 * (przy biegu nie ma osi ciężaru) i że punkty liczą się z serii tak, jak trzeba
 * — najlepszy wynik dnia albo suma dnia.
 */

import type { LoggingType } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import { chartPoints, chartSummary, metricsFor, recentPoints } from '../src/chart-data';

const set = (
  performedOn: string,
  values: Partial<{
    weightG: number;
    reps: number;
    durationS: number;
    distanceM: number;
  }> = {},
) => ({
  performedOn,
  weightG: values.weightG ?? null,
  reps: values.reps ?? null,
  durationS: values.durationS ?? null,
  distanceM: values.distanceM ?? null,
});

const metric = (loggingType: LoggingType, key: string) => {
  const found = metricsFor(loggingType).find((candidate) => candidate.key === key);
  if (found === undefined) throw new Error(`Brak metryki ${key} dla ${loggingType}`);
  return found;
};

describe('metryki zależą od typu logowania', () => {
  it.each([
    ['weight_reps', ['weightG', 'reps', 'volume', 'sets']],
    ['weight_time', ['weightG', 'durationS', 'totalDuration', 'sets']],
    ['bodyweight_reps', ['reps', 'totalReps', 'sets']],
    ['bodyweight_time', ['durationS', 'totalDuration', 'sets']],
    ['distance_time', ['distanceM', 'durationS', 'totalDistance', 'sets']],
  ] as [LoggingType, string[]][])('%s ma metryki %j', (loggingType, keys) => {
    expect(metricsFor(loggingType).map((candidate) => candidate.key)).toEqual(keys);
  });

  it('nie proponuje ciężaru przy ćwiczeniu na masę ciała', () => {
    const keys = metricsFor('bodyweight_reps').map((candidate) => candidate.key);
    expect(keys).not.toContain('weightG');
  });
});

describe('punkty wykresu', () => {
  const sets = [
    set('2026-08-10', { weightG: 80_000, reps: 8 }),
    set('2026-08-10', { weightG: 90_000, reps: 5 }),
    set('2026-08-12', { weightG: 85_000, reps: 6 }),
  ];

  it('daje jeden punkt na dzień treningowy, chronologicznie', () => {
    const points = chartPoints(metric('weight_reps', 'weightG'), sets);
    expect(points.map((point) => point.day)).toEqual(['2026-08-10', '2026-08-12']);
  });

  it('metryka osi bierze najlepszy wynik dnia', () => {
    const points = chartPoints(metric('weight_reps', 'weightG'), sets);
    expect(points[0]?.value).toBe(90_000);
  });

  it('objętość sumuje ciężar razy powtórzenia', () => {
    const points = chartPoints(metric('weight_reps', 'volume'), sets);
    expect(points[0]?.value).toBe(80_000 * 8 + 90_000 * 5);
  });

  it('liczba serii liczy wiersze dnia', () => {
    const points = chartPoints(metric('weight_reps', 'sets'), sets);
    expect(points.map((point) => point.value)).toEqual([2, 1]);
  });

  it('nie wstawia zer za dni bez treningu — przerwa nie jest wynikiem', () => {
    const points = chartPoints(metric('weight_reps', 'weightG'), sets);
    expect(points.map((point) => point.day)).not.toContain('2026-08-11');
  });

  it('pomija serie, które nie wnoszą nic do metryki', () => {
    const niepelne = [set('2026-08-10', { reps: 8 }), set('2026-08-11', { weightG: 60_000 })];
    expect(chartPoints(metric('weight_reps', 'volume'), niepelne)).toEqual([]);
  });

  it('dystans sumuje metry, a czas bierze najdłuższy bieg dnia', () => {
    const biegi = [
      set('2026-08-10', { distanceM: 5000, durationS: 1500 }),
      set('2026-08-10', { distanceM: 3000, durationS: 900 }),
    ];

    expect(chartPoints(metric('distance_time', 'totalDistance'), biegi)[0]?.value).toBe(8000);
    expect(chartPoints(metric('distance_time', 'durationS'), biegi)[0]?.value).toBe(1500);
  });
});

describe('podsumowanie wykresu', () => {
  const sets = [
    set('2026-08-10', { weightG: 80_000, reps: 8 }),
    set('2026-08-12', { weightG: 100_000, reps: 3 }),
    set('2026-08-14', { weightG: 90_000, reps: 5 }),
  ];

  it('podaje skalę, najlepszy dzień i ostatni trening', () => {
    const summary = chartSummary(metric('weight_reps', 'weightG'), sets);

    expect(summary.max).toBe(100_000);
    expect(summary.best?.day).toBe('2026-08-12');
    expect(summary.latest?.day).toBe('2026-08-14');
  });

  it('z pustej historii robi pusty wykres, a nie błąd', () => {
    const summary = chartSummary(metric('weight_reps', 'weightG'), []);

    expect(summary).toEqual({ points: [], best: null, latest: null, max: 0 });
  });

  it('ekran pokazuje ostatnie punkty, a nie całą historię', () => {
    const summary = chartSummary(metric('weight_reps', 'weightG'), sets);
    const shown = recentPoints(summary.points, 2);

    expect(shown.map((point) => point.day)).toEqual(['2026-08-12', '2026-08-14']);
    expect(recentPoints(summary.points, 10)).toHaveLength(3);
  });
});
