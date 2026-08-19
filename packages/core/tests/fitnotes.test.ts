/**
 * Plan eksportu do pliku kopii FitNotes.
 *
 * Sprawdzane są cztery rzeczy, z których każda odpowiada realnej awarii
 * w cudzym pliku — a ten użytkownik przywróci sobie w FitNotesie i będzie z nim
 * żył dalej:
 *
 * 1. **Powtórny eksport niczego nie dubluje.** Rejestr po naszej stronie jest
 *    jedynym źródłem tej wiedzy, bo `training_log` nie zna godziny dodania wpisu.
 * 2. **Kategoria nigdy nie powstaje sama.** Darmowy FitNotes nie umie jej
 *    utworzyć, więc tag bez odpowiednika ma zapytać użytkownika, a nie zgadywać.
 * 3. **Ćwiczenie, które w pliku już jest, nie powstaje drugi raz** — także gdy
 *    różni się wyłącznie wielkością liter. Dwa wiersze rozbiłyby historię na
 *    dwa wykresy.
 * 4. **Wartości trafiają w kolumny FitNotesa.** Gramy na kilogramy, metry na
 *    kilometry, brak pomiaru na zero — a nie na `NULL`, którego kolumny nie
 *    przyjmują.
 */

import { describe, expect, it } from 'vitest';
import {
  FITNOTES_UNIT_METRIC,
  fitNotesExportKey,
  planFitNotesExport,
  type FitNotesSourceSet,
  type FitNotesTarget,
} from '../src/fitnotes.js';

const TARGET: FitNotesTarget = {
  categories: [
    { id: 1, name: 'Chest' },
    { id: 2, name: 'Back' },
    { id: 3, name: 'Cardio' },
  ],
  exercises: [{ id: 10, name: 'Barbell Bench Press', categoryId: 1 }],
};

const set = (overrides: Partial<FitNotesSourceSet> = {}): FitNotesSourceSet => ({
  exerciseName: 'Barbell bench press',
  categoryName: 'Chest',
  performedOn: '2026-08-10',
  weightG: 82500,
  reps: 5,
  durationS: null,
  distanceM: null,
  createdAt: '2026-08-10T17:04:11.000Z',
  ...overrides,
});

describe('planFitNotesExport', () => {
  it('przekłada serię na wiersz training_log', () => {
    const plan = planFitNotesExport({ sets: [set()], target: TARGET });

    expect(plan.rows).toEqual([
      {
        exerciseName: 'Barbell bench press',
        date: '2026-08-10',
        metricWeight: 82.5,
        reps: 5,
        unit: FITNOTES_UNIT_METRIC,
        distance: 0,
        durationSeconds: 0,
      },
    ]);
    expect(plan.exercisesToCreate).toEqual([]);
    expect(plan.missingCategories).toEqual([]);
  });

  it('bieg zapisuje w kilometrach i sekundach', () => {
    const plan = planFitNotesExport({
      sets: [
        set({
          exerciseName: 'Outdoor run',
          categoryName: 'Cardio',
          weightG: null,
          reps: null,
          distanceM: 5200,
          durationS: 1530,
        }),
      ],
      target: TARGET,
    });

    expect(plan.rows[0]).toMatchObject({ distance: 5.2, durationSeconds: 1530, reps: 0 });
    expect(plan.rows[0]?.metricWeight).toBe(0);
  });

  it('pomija serie, które rejestr zna z poprzedniego eksportu', () => {
    const first = set();
    const second = set({ performedOn: '2026-08-11', createdAt: '2026-08-11T17:04:11.000Z' });

    const plan = planFitNotesExport({
      sets: [first, second],
      target: TARGET,
      exportedKeys: [fitNotesExportKey(first)],
    });

    expect(plan.alreadyExported).toBe(1);
    expect(plan.rows).toHaveLength(1);
    expect(plan.rows[0]?.date).toBe('2026-08-11');
    expect(plan.keys).toEqual([fitNotesExportKey(second)]);
  });

  it('dwie identyczne serie z jednego treningu zostają dwiema seriami', () => {
    const plan = planFitNotesExport({
      sets: [set(), set({ createdAt: '2026-08-10T17:06:40.000Z' })],
      target: TARGET,
    });

    expect(plan.rows).toHaveLength(2);
    expect(plan.keys).toHaveLength(2);
  });

  it('nie zakłada ćwiczenia, które w pliku już jest — nawet o innej pisowni', () => {
    const plan = planFitNotesExport({
      sets: [set({ exerciseName: 'barbell   bench press' })],
      target: TARGET,
    });

    expect(plan.exercisesToCreate).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });

  it('zakłada brakujące ćwiczenie raz, w kategorii tagu głównego', () => {
    const plan = planFitNotesExport({
      sets: [
        set({ exerciseName: 'Pull-up', categoryName: 'Back' }),
        set({
          exerciseName: 'Pull-up',
          categoryName: 'Back',
          createdAt: '2026-08-10T17:08:00.000Z',
        }),
      ],
      target: TARGET,
    });

    expect(plan.exercisesToCreate).toEqual([{ name: 'Pull-up', categoryId: 2 }]);
    expect(plan.rows).toHaveLength(2);
  });

  it('wstrzymuje serie, których kategorii nie ma w pliku, zamiast ją tworzyć', () => {
    const plan = planFitNotesExport({
      sets: [set({ exerciseName: 'Farmer walk', categoryName: 'Strongman' })],
      target: TARGET,
    });

    expect(plan.missingCategories).toEqual(['Strongman']);
    expect(plan.blocked).toBe(1);
    expect(plan.rows).toEqual([]);
    expect(plan.exercisesToCreate).toEqual([]);
  });

  it('zapamiętane mapowanie kategorii odblokowuje te serie', () => {
    const plan = planFitNotesExport({
      sets: [set({ exerciseName: 'Farmer walk', categoryName: 'Strongman' })],
      target: TARGET,
      categoryMapping: { Strongman: 'Back' },
    });

    expect(plan.missingCategories).toEqual([]);
    expect(plan.blocked).toBe(0);
    expect(plan.exercisesToCreate).toEqual([{ name: 'Farmer walk', categoryId: 2 }]);
  });

  it('brakująca kategoria nie blokuje ćwiczenia, które w pliku już jest', () => {
    const plan = planFitNotesExport({
      sets: [set({ categoryName: 'Klata' })],
      target: TARGET,
    });

    expect(plan.missingCategories).toEqual([]);
    expect(plan.rows).toHaveLength(1);
  });
});

describe('fitNotesExportKey', () => {
  it('nie widzi różnicy w pisowni nazwy ćwiczenia', () => {
    expect(fitNotesExportKey(set({ exerciseName: 'Barbell Bench Press' }))).toBe(
      fitNotesExportKey(set()),
    );
  });

  it('rozróżnia serie po wartościach i po momencie dodania', () => {
    expect(fitNotesExportKey(set({ reps: 6 }))).not.toBe(fitNotesExportKey(set()));
    expect(fitNotesExportKey(set({ createdAt: '2026-08-10T17:04:12.000Z' }))).not.toBe(
      fitNotesExportKey(set()),
    );
  });
});
