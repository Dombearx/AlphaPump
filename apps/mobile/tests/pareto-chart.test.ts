/**
 * Wykres frontu Pareto rekordów.
 *
 * Sprawdzane jest to, co wykres obiecuje użytkownikowi: że wyróżnione punkty to
 * dokładnie rekordy (ten sam front, który liczy `@alphapump/core`), że dwie
 * identyczne serie są jednym punktem, a nie dwoma leżącymi na sobie, i że
 * położenie w ramce wynika z zakresu osi — bo na tym polega cały rysunek.
 */

import type { LoggingType } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import { paretoScatter } from '../src/pareto-chart';

let next = 0;

const set = (
  performedOn: string,
  values: Partial<{ weightG: number; reps: number; durationS: number; distanceM: number }> = {},
) => {
  next += 1;
  return {
    id: `set-${String(next).padStart(3, '0')}`,
    performedOn,
    position: next,
    weightG: values.weightG ?? null,
    reps: values.reps ?? null,
    durationS: values.durationS ?? null,
    distanceM: values.distanceM ?? null,
  };
};

const bench = (performedOn: string, kilograms: number, reps: number) =>
  set(performedOn, { weightG: kilograms * 1000, reps });

/** Wyniki punktów jako pary `[ciężar w kg, powtórzenia]`. */
const results = (points: readonly { x: number; y: number }[]) =>
  points.map((point) => [point.y / 1000, point.x]);

describe('front Pareto na wykresie', () => {
  it('wyróżnia punkty niezdominowane, a reszcie zostawia szarą kropkę', () => {
    const scatter = paretoScatter('weight_reps', [
      bench('2026-08-01', 100, 5),
      bench('2026-08-02', 80, 12),
      // Zdominowana: lżej i na mniej powtórzeń niż 80 kg × 12.
      bench('2026-08-03', 70, 10),
    ]);

    expect(scatter).not.toBeNull();
    expect(results(scatter!.front)).toEqual([
      [100, 5],
      [80, 12],
    ]);
    expect(scatter!.points).toHaveLength(3);
    expect(results(scatter!.points.filter((point) => !point.isRecord))).toEqual([[70, 10]]);
  });

  it('oddaje front od lewej: z rosnącą osią X maleje oś Y, więc da się go narysować schodkiem', () => {
    const scatter = paretoScatter('weight_reps', [
      bench('2026-08-01', 80, 12),
      bench('2026-08-02', 120, 1),
      bench('2026-08-03', 100, 5),
    ]);

    expect(results(scatter!.front)).toEqual([
      [120, 1],
      [100, 5],
      [80, 12],
    ]);
  });

  it('skleja powtórzony wynik w jeden punkt i liczy serie, zapamiętując najstarszą', () => {
    const scatter = paretoScatter('weight_reps', [
      bench('2026-08-01', 100, 5),
      bench('2026-08-08', 100, 5),
      bench('2026-08-15', 100, 5),
    ]);

    expect(scatter!.points).toHaveLength(1);
    expect(scatter!.points[0]!.sets).toBe(3);
    expect(scatter!.points[0]!.set.performedOn).toBe('2026-08-01');
    expect(scatter!.points[0]!.isRecord).toBe(true);
  });

  it('skaluje położenie do zakresu osi, a jedyny wynik stawia na środku', () => {
    const scatter = paretoScatter('weight_reps', [
      bench('2026-08-01', 60, 10),
      bench('2026-08-02', 100, 2),
      bench('2026-08-03', 80, 6),
    ]);

    expect(scatter!.yRange).toEqual({ min: 60_000, max: 100_000 });
    expect(scatter!.xRange).toEqual({ min: 2, max: 10 });

    const middle = scatter!.points.find((point) => point.y === 80_000);
    expect(middle!.xRatio).toBeCloseTo(0.5);
    expect(middle!.yRatio).toBeCloseTo(0.5);

    const alone = paretoScatter('weight_reps', [bench('2026-08-01', 100, 5)]);
    expect(alone!.points[0]!.xRatio).toBe(0.5);
    expect(alone!.points[0]!.yRatio).toBe(0.5);
  });

  it('pomija serie bez kompletu pomiarów — tak samo, jak pomijają je rekordy', () => {
    const scatter = paretoScatter('weight_reps', [
      bench('2026-08-01', 100, 5),
      set('2026-08-02', { weightG: 120_000 }),
    ]);

    expect(scatter!.points).toHaveLength(1);
    expect(results(scatter!.points)).toEqual([[100, 5]]);
  });

  it('nie ma czego rysować, gdy żadna seria nie jest kompletna', () => {
    expect(paretoScatter('weight_reps', [set('2026-08-01', { reps: 5 })])).toBeNull();
    expect(paretoScatter('weight_reps', [])).toBeNull();
  });

  it.each([
    ['weight_reps', ['Weight', 'Reps']],
    ['weight_time', ['Weight', 'Time']],
    ['distance_time', ['Distance', 'Time']],
  ] as [LoggingType, string[]][])('osie %s to %j (pion, poziom)', (loggingType, labels) => {
    const scatter = paretoScatter(loggingType, [
      set('2026-08-01', { weightG: 100_000, reps: 5, durationS: 60, distanceM: 1000 }),
    ]);

    expect([scatter!.axes.y.label, scatter!.axes.x.label]).toEqual(labels);
  });

  it.each(['bodyweight_reps', 'bodyweight_time'] as LoggingType[])(
    'nie rysuje frontu dla jednoosiowego %s — rekord jest tam jedną liczbą',
    (loggingType) => {
      expect(
        paretoScatter(loggingType, [set('2026-08-01', { reps: 20, durationS: 60 })]),
      ).toBeNull();
    },
  );
});
