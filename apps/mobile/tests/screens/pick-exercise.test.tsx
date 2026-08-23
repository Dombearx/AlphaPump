/**
 * Wybór ćwiczenia — sprawdza oznaczenie tagów objętych celami aktywnego cyklu.
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
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { EXERCISES, TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

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
    await mount(<PickExerciseScreen day={DAY} />);
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
