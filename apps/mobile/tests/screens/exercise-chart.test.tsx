/**
 * Ekran analityczny ćwiczenia — wykres metryki i front Pareto rekordów.
 *
 * Sprawdzane jest to, czego nie widzi test logiki: że ekran składa się na
 * prawdziwej bazie, że front rekordów stoi na nim z kropką opisaną tak samo,
 * jak wynik na liście rekordów, i że przy ćwiczeniu z jednoosiowym rekordem
 * (własna masa ciała) tego wykresu nie ma — bo nie byłoby na nim nic poza
 * jednym punktem.
 */

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../../src/db/sets';
import { ExerciseChartScreen } from '../../src/screens/exercise-chart';
import { EXERCISES, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

describe('ekran wykresów ćwiczenia', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  const addSet = (
    exerciseId: string,
    day: string,
    values: Partial<{ weightG: number; reps: number }>,
  ) =>
    createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId,
      performedOn: day,
      values: {
        weightG: values.weightG ?? null,
        reps: values.reps ?? null,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  const addBench = (day: string, kilograms: number, reps: number) =>
    addSet(EXERCISES.bench!.id, day, { weightG: kilograms * 1000, reps });

  it('pokazuje front Pareto rekordów obok wykresu metryki', async () => {
    await addBench('2026-08-01', 100, 5);
    await addBench('2026-08-08', 80, 12);
    // Zdominowana: lżej i na mniej powtórzeń niż 80 kg × 12.
    await addBench('2026-08-15', 70, 10);

    await mount(<ExerciseChartScreen exerciseId={EXERCISES.bench!.id} />);

    const text = screenText();
    expect(text).toContain('Record front');
    // Osie wynikają z typu logowania: ciężar w pionie, powtórzenia w poziomie.
    expect(text).toContain('Weight ↑ · Reps →');
    expect(text).toContain('Records: 2 of 3 results');

    // Kropka mówi, który wynik pokazuje i czy jest rekordem — na wykresie bez
    // napisów to jedyna jego treść dostępna czytnikowi ekranu.
    expect(screen.getByLabelText('100 kg × 5 — record, 1 set')).toBeDefined();
    expect(screen.getByLabelText('80 kg × 12 — record, 1 set')).toBeDefined();
    expect(screen.getByLabelText('70 kg × 10 — beaten, 1 set')).toBeDefined();
  });

  it('nie pokazuje frontu przy ćwiczeniu z jednoosiowym rekordem', async () => {
    await addSet(EXERCISES.crunch!.id, '2026-08-01', { reps: 20 });

    await mount(<ExerciseChartScreen exerciseId={EXERCISES.crunch!.id} />);

    expect(screenText()).not.toContain('Record front');
  });
});
