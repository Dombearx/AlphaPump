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

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../../src/db/cycles';
import { createSet } from '../../src/db/sets';
import type { ExerciseOrder, ExerciseOrderStore } from '../../src/exercise-order/state';
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { EXERCISES, TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

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
  const chip = Array.from(document.querySelectorAll('button')).find((node) =>
    [tag, `★${tag}`, `✓${tag}`].includes(node.textContent ?? ''),
  );
  const done = chip?.firstElementChild?.firstElementChild as HTMLElement | undefined;
  return done?.style.flexGrow ?? '';
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

    expect(chipFill('abs')).toBe('');
  });

  it('nie pokazuje osobnej sekcji z pozostałymi pozycjami', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });

    expect(screenText()).not.toContain('Left in cycles');
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
