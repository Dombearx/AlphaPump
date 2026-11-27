/**
 * Wybór ćwiczenia — oznaczenie tagów objętych celami aktywnego cyklu oraz
 * kolejność listy.
 *
 * Oznaczeniem jest znak **wewnątrz** chipsa tagu (gwiazdka, dopóki coś zostało,
 * ptaszek po dokończeniu) i wypełnienie jego tła w proporcji zrobionej roboty
 * (patrz nagłówek `pick-exercise.tsx`). Znak sprawdzamy na tekście, który ekran
 * skleja — stoi w miejscu kropki koloru, czyli tuż przed nazwą tagu.
 * Wypełnienie tekstu nie ma i mieć nie może, więc jego jedynym śladem jest
 * udział, w jakim dzieli chipsa pasek stojący pod jego treścią.
 */

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../../src/db/cycles';
import { createSet } from '../../src/db/sets';
import type { ExerciseOrder, ExerciseOrderStore } from '../../src/exercise-order/state';
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { EXERCISES, TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, user, type MountedScreen } from './harness';

/** Magazyn ustawienia w pamięci — telefon trzyma je w pliku, test w zmiennej. */
function orderStore(order: ExerciseOrder): ExerciseOrderStore {
  return { read: () => Promise.resolve(order), write: () => Promise.resolve() };
}

const DAY = '2026-08-11';

/**
 * Udział, w jakim wypełnione jest tło chipsa danego tagu — tak, jak zobaczy je
 * użytkownik. Wypełnienie stoi pod treścią chipsa, więc jest jego pierwszym
 * dzieckiem, a rozciąga się na całą jego szerokość i dzieli ją między część
 * zrobioną i resztę. Zrobiona część jest pierwsza, a jej udział wzrostu jest
 * dokładnie tym, co widać. Chips bez wypełnienia zaczyna się rzędem treści
 * i żadnego udziału nie dostaje.
 */
function chipFill(tag: string): string {
  const chip = tagChip(tag);
  const done = chip?.firstElementChild?.firstElementChild as HTMLElement | undefined;
  return done?.style.flexGrow ?? '';
}

/**
 * Chips jednego tagu. Rozpoznajemy go po tym, że jego treścią jest **sama**
 * nazwa tagu (ewentualnie ze znakiem cyklu przed nią) — wiersze listy też są
 * przyciskami, ale ich treść jest dłuższa od nazwy tagu.
 */
function tagChip(tag: string): HTMLElement | undefined {
  return chips().find((node) => [tag, `★${tag}`, `✓${tag}`].includes(node.textContent ?? ''));
}

function chips(): HTMLElement[] {
  return Array.from(document.querySelectorAll('button'));
}

/** Pozycja chipsa tagu w rzędzie — po niej sprawdzamy kolejność tagów. */
function tagChipIndex(tag: string): number {
  const chip = tagChip(tag);
  return chip === undefined ? -1 : chips().indexOf(chip);
}

/** Naciska chips odsłaniający tagi, z których nie ma ani jednej serii. */
async function showHiddenTags(): Promise<void> {
  await user().click(screen.getByRole('button', { name: /^\+\d+ more$/ }));
}

describe('wybór ćwiczenia', () => {
  let local: MountedScreen;

  const withGoal = async (
    goal: { exerciseId: string | null; tagId: string | null },
    target = 10,
  ) => {
    await createCycle(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: null,
      goals: [{ metric: 'sets', target, ...goal }],
    });
    await mount(<PickExerciseScreen day={DAY} orderStore={orderStore('rotation')} />);
  };

  /** Seria wyciskania — ćwiczenia o tagu głównym „chest". */
  const addBench = () =>
    createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.bench!.id,
      performedOn: DAY,
      values: {
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  it('oznacza gwiazdką tag z pozostałą pozycją cyklu', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });

    expect(screenText()).toContain('★chest');
  });

  it('nie oznacza tagów, w których nic nie zostało', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });

    expect(screenText()).toContain('abs');
    expect(screenText()).not.toContain('★abs');
  });

  it('cel wskazujący ćwiczenie oznacza jego tag główny', async () => {
    await withGoal({ exerciseId: EXERCISES.crunch!.id, tagId: null });

    expect(screenText()).toContain('★abs');
  });

  it('wypełnia tło tagu w proporcji zrobionych serii', async () => {
    await addBench();
    await addBench();
    await withGoal({ exerciseId: null, tagId: TAGS.chest }, 4);

    expect(chipFill('chest')).toBe('0.5');
  });

  it('tag z dokończoną robotą zostaje wypełniony do końca, ze znakiem zrobienia', async () => {
    await addBench();
    await withGoal({ exerciseId: null, tagId: TAGS.chest }, 1);

    // Ostatnia seria domyka postęp, zamiast go kasować: chips zostaje pełny,
    // a gwiazdka „tu coś zostało" ustępuje ptaszkowi.
    expect(screenText()).toContain('✓chest');
    expect(screenText()).not.toContain('★chest');
    expect(chipFill('chest')).toBe('1');
  });

  it('nie wypełnia tagów spoza cyklu', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });
    // Tag bez serii i bez celu stoi pod „pokaż więcej" (patrz niżej), więc żeby
    // sprawdzić, że nie ma wypełnienia, trzeba go najpierw odsłonić.
    await showHiddenTags();

    expect(tagChip('abs')).toBeDefined();
    expect(chipFill('abs')).toBe('');
  });

  it('nie pokazuje osobnej sekcji z pozostałymi pozycjami', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });

    expect(screenText()).not.toContain('Left in cycles');
  });
});

/**
 * Rząd tagów: na wierzchu tagi z własnymi seriami, od tego z największą ich
 * liczbą, a tagi bez ani jednej serii pod chipsem „+N more". Asercje stawiamy
 * na chipsach, a nie na całym tekście ekranu: nazwa tagu stoi też w opisie
 * każdego wiersza listy, więc z tekstu nie widać, czy tag jest w rzędzie.
 */
describe('rząd tagów przy wyborze ćwiczenia', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  const addSet = (exerciseId: string) =>
    createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId,
      performedOn: DAY,
      values: {
        weightG: 20_000,
        reps: 10,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  const show = () => mount(<PickExerciseScreen day={DAY} orderStore={orderStore('usage')} />);

  it('tag z większą liczbą własnych serii stoi przed tagiem z mniejszą', async () => {
    await addSet(EXERCISES.curl!.id);
    await addSet(EXERCISES.bench!.id);
    await addSet(EXERCISES.bench!.id);
    await show();

    // Alfabetycznie „biceps" jest przed „chest" — tu rozstrzyga historia.
    expect(tagChipIndex('chest')).toBeLessThan(tagChipIndex('biceps'));
  });

  it('nie pokazuje tagu, z którego nie ma ani jednej serii', async () => {
    await addSet(EXERCISES.bench!.id);
    await show();

    expect(tagChip('chest')).toBeDefined();
    expect(tagChip('biceps')).toBeUndefined();
  });

  it('bez ani jednej serii wszystkie tagi są schowane', async () => {
    await show();

    expect(tagChip('chest')).toBeUndefined();
    expect(screen.getByRole('button', { name: /^\+\d+ more$/ })).toBeDefined();
  });

  it('schowany tag daje się odsłonić i wybrać', async () => {
    await addSet(EXERCISES.bench!.id);
    await show();
    await showHiddenTags();

    const hidden = tagChip('biceps');
    expect(hidden).toBeDefined();

    await user().click(hidden!);
    // Po wybraniu lista pokazuje wyłącznie ćwiczenia na biceps, a sam chips
    // zostaje w rzędzie — inaczej filtru nie dałoby się zdjąć.
    expect(screenText()).toContain('Lying dumbbell curl');
    expect(screenText()).not.toContain('Flat barbell bench press');
    expect(tagChip('biceps')).toBeDefined();
  });

  it('odsłonięte tagi można schować z powrotem', async () => {
    await addSet(EXERCISES.bench!.id);
    await show();
    await showHiddenTags();
    await user().click(screen.getByRole('button', { name: 'Fewer tags' }));

    expect(tagChip('biceps')).toBeUndefined();
  });
});

/**
 * Kolejność listy. Arytmetykę sprawdzają testy rdzenia, a tłumaczenie wierszy
 * bazy — `tests/exercise-rotation.test.ts`; tutaj chodzi o to, czy ekran
 * faktycznie tak ją rysuje i czy ustawienie na nią wpływa. Asercje stawiamy na
 * kolejności nazw w tekście ekranu, bo to jest to, co użytkownik czyta.
 */
describe('kolejność ćwiczeń przy wyborze', () => {
  let local: MountedScreen;

  const CURL = 'Lying dumbbell curl';
  const FRENCH = 'Lying triceps extension';

  beforeEach(async () => {
    local = await openLocalDatabase();

    await createCycle(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: null,
      goals: [
        { metric: 'sets', target: 12, exerciseId: null, tagId: TAGS.biceps },
        { metric: 'sets', target: 12, exerciseId: null, tagId: TAGS.triceps },
      ],
    });
  });

  afterEach(() => local.close());

  const addSet = (exerciseId: string, at: string) =>
    createSet(
      local.db,
      {
        userId: TEST_USER.id,
        deviceId: 'device-a',
        exerciseId,
        performedOn: DAY,
        values: {
          weightG: 20_000,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
        },
      },
      new Date(at),
    );

  /** Które z dwóch ćwiczeń stoi na liście wyżej. */
  function higher(): string {
    const text = screenText();
    return text.indexOf(CURL) < text.indexOf(FRENCH) ? CURL : FRENCH;
  }

  it('podpowiada ćwiczenie z niedokończonej pozycji cyklu', async () => {
    await mount(<PickExerciseScreen day={DAY} orderStore={orderStore('rotation')} />);

    // Cała biblioteka wbudowana jest przed nimi w kolejności alfabetycznej,
    // więc pierwszy wiersz listy dowodzi, że kolejność w ogóle się przestawiła.
    expect(screenText().indexOf(CURL)).toBeLessThan(screenText().indexOf('Barbell squat'));
  });

  it('po serii na biceps na górze jest ćwiczenie na triceps', async () => {
    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');
    await mount(<PickExerciseScreen day={DAY} orderStore={orderStore('rotation')} />);

    expect(higher()).toBe(FRENCH);
  });

  it('po serii na triceps wraca ćwiczenie na biceps', async () => {
    // Zamiana bierze się wyłącznie z historii dnia — ekran niczego nie pamięta
    // między wejściami, a mimo to za każdym razem wskazuje to drugie.
    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');
    await addSet(EXERCISES.frenchPress!.id, '2026-08-11T10:05:00Z');
    await mount(<PickExerciseScreen day={DAY} orderStore={orderStore('rotation')} />);

    expect(higher()).toBe(CURL);
  });

  it('wyłączone ustawienie zostawia kolejność po liczbie własnych serii', async () => {
    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');
    await mount(<PickExerciseScreen day={DAY} orderStore={orderStore('usage')} />);

    // Jedyna seria dnia jest na uginaniu, więc bez podpowiadania to ono stoi
    // na górze całej biblioteki — czyli dokładnie odwrotnie niż wyżej.
    expect(screenText().indexOf(CURL)).toBeLessThan(screenText().indexOf('Barbell squat'));
    expect(higher()).toBe(CURL);
  });
});
