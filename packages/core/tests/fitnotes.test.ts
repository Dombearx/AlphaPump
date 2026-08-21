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
  planFitNotesImport,
  type FitNotesLogEntry,
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

/**
 * Plan importu z pliku FitNotes.
 *
 * Sprawdzane są cztery rzeczy, z których każda odpowiada realnej stracie
 * w **naszej** bazie — a tej użytkownik nie ogląda przez FitNotesa i nie zauważy
 * od razu:
 *
 * 1. **Ponowny import tego samego pliku nie dokłada niczego.** To jest cel
 *    funkcji: scalanie, a nie doklejanie drugiego kompletu historii.
 * 2. **Identyczne serie z jednego treningu zostają osobnymi seriami.** Duplikat
 *    liczy się względem tego, ile takich serii już mamy, a nie „czy w ogóle".
 * 3. **Typ logowania nowego ćwiczenia wynika z całości jego wpisów.** Ustala się
 *    raz na zawsze, więc pomyłka na pierwszym wierszu zostałaby na stałe.
 * 4. **Wpisu bez pomiaru nie zapisujemy.** Seria bez wartości nie przeszłaby
 *    walidacji zapisu i wywróciłaby import na wpisie, którego nikt nie szukał.
 */
describe('planFitNotesImport', () => {
  const KNOWN = [
    { name: 'Barbell bench press', loggingType: 'weight_reps' as const },
    { name: "Mason's crunch", loggingType: 'bodyweight_reps' as const },
  ];

  const entry = (overrides: Partial<FitNotesLogEntry> = {}): FitNotesLogEntry => ({
    exerciseName: 'Barbell Bench Press',
    categoryName: 'Chest',
    date: '2026-08-10',
    metricWeight: 82.5,
    reps: 5,
    distance: 0,
    durationSeconds: 0,
    ...overrides,
  });

  it('przekłada wpis dziennika na serię w gramach i metrach', () => {
    const plan = planFitNotesImport({ entries: [entry()], known: KNOWN, existing: [] });

    expect(plan.sets).toEqual([
      {
        exerciseName: 'Barbell Bench Press',
        performedOn: '2026-08-10',
        weightG: 82500,
        reps: 5,
        durationS: null,
        distanceM: null,
      },
    ]);
    expect(plan.exercisesToCreate).toEqual([]);
    expect(plan.duplicates).toBe(0);
  });

  it('pomija wpis, którego odpowiednik jest już w AlphaPump', () => {
    const plan = planFitNotesImport({
      entries: [entry(), entry({ reps: 6 })],
      known: KNOWN,
      existing: [
        {
          // Inna pisownia nazwy to dalej to samo ćwiczenie.
          exerciseName: 'barbell bench press',
          performedOn: '2026-08-10',
          weightG: 82500,
          reps: 5,
          durationS: null,
          distanceM: null,
        },
      ],
    });

    expect(plan.duplicates).toBe(1);
    expect(plan.sets).toHaveLength(1);
    expect(plan.sets[0]?.reps).toBe(6);
  });

  it('trzy identyczne serie z jednego treningu zostają trzema seriami', () => {
    const entries = [entry(), entry(), entry()];

    const fresh = planFitNotesImport({ entries, known: KNOWN, existing: [] });
    expect(fresh.sets).toHaveLength(3);

    // Ten sam plik drugi raz: dwie serie już zapisane, więc wchodzi jedna.
    const again = planFitNotesImport({
      entries,
      known: KNOWN,
      existing: fresh.sets.slice(0, 2),
    });
    expect(again.sets).toHaveLength(1);
    expect(again.duplicates).toBe(2);
  });

  it('zakłada brakujące ćwiczenie raz, z tagiem z kategorii pliku', () => {
    const plan = planFitNotesImport({
      entries: [
        entry({ exerciseName: 'Pull-up', categoryName: 'Back', metricWeight: 0, reps: 8 }),
        entry({ exerciseName: 'pull-up', categoryName: 'Back', metricWeight: 0, reps: 7 }),
      ],
      known: KNOWN,
      existing: [],
    });

    expect(plan.exercisesToCreate).toEqual([
      { name: 'Pull-up', loggingType: 'bodyweight_reps', tagName: 'Back' },
    ]);
    expect(plan.sets).toHaveLength(2);
  });

  it('typ logowania nowego ćwiczenia bierze z całości jego wpisów', () => {
    // Podciąganie z obciążeniem: pierwsza seria bez ciężaru, kolejna z nim.
    const plan = planFitNotesImport({
      entries: [
        entry({ exerciseName: 'Weighted pull-up', categoryName: 'Back', metricWeight: 0, reps: 8 }),
        entry({
          exerciseName: 'Weighted pull-up',
          categoryName: 'Back',
          metricWeight: 10,
          reps: 5,
        }),
      ],
      known: [],
      existing: [],
    });

    expect(plan.exercisesToCreate[0]?.loggingType).toBe('weight_reps');
    expect(plan.sets).toEqual([
      expect.objectContaining({ weightG: 0, reps: 8 }),
      expect.objectContaining({ weightG: 10000, reps: 5 }),
    ]);
  });

  it('bieg wchodzi jako dystans i czas', () => {
    const plan = planFitNotesImport({
      entries: [
        entry({
          exerciseName: 'Outdoor run',
          categoryName: 'Cardio',
          metricWeight: 0,
          reps: 0,
          distance: 5.2,
          durationSeconds: 1530,
        }),
      ],
      known: [],
      existing: [],
    });

    expect(plan.exercisesToCreate[0]?.loggingType).toBe('distance_time');
    expect(plan.sets[0]).toEqual({
      exerciseName: 'Outdoor run',
      performedOn: '2026-08-10',
      weightG: null,
      reps: null,
      durationS: 1530,
      distanceM: 5200,
    });
  });

  it('pomija wpisy bez pomiaru i z niemożliwą datą — i nie zakłada dla nich ćwiczenia', () => {
    const plan = planFitNotesImport({
      entries: [
        entry({ metricWeight: 0, reps: 0 }),
        entry({ date: '2026-02-30' }),
        entry({ exerciseName: 'Stretching', categoryName: 'Other', metricWeight: 0, reps: 0 }),
      ],
      known: KNOWN,
      existing: [],
    });

    expect(plan.sets).toEqual([]);
    expect(plan.skipped).toBe(3);
    expect(plan.exercisesToCreate).toEqual([]);
  });

  it('nie rusza serii, których w pliku nie ma', () => {
    const own = {
      exerciseName: "Mason's crunch",
      performedOn: '2026-08-09',
      weightG: null,
      reps: 15,
      durationS: null,
      distanceM: null,
    };

    const plan = planFitNotesImport({ entries: [entry()], known: KNOWN, existing: [own] });

    expect(plan.sets).toHaveLength(1);
    expect(plan.duplicates).toBe(0);
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
