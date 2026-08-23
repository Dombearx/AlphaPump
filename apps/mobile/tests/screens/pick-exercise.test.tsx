/**
 * Wybór ćwiczenia — sprawdza oznaczenie tagów, w których została jeszcze robota
 * z cyklu. Oznaczeniem jest gwiazdka **wewnątrz** chipsa tagu i wypełnienie jego
 * tła w proporcji zrobionej roboty (patrz nagłówek `pick-exercise.tsx`).
 * Gwiazdkę sprawdzamy na tekście, który ekran skleja — stoi w miejscu kropki
 * koloru, czyli tuż przed nazwą tagu. Wypełnienie tekstu nie ma i mieć nie może,
 * więc jego jedynym śladem jest szerokość policzona chipsowi.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../../src/db/cycles';
import { createSet } from '../../src/db/sets';
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { EXERCISES, TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

const DAY = '2026-08-11';

/**
 * Szerokość wypełnienia chipsa danego tagu, tak jak zobaczy ją użytkownik.
 * Wypełnienie stoi pod treścią chipsa, więc jest jego pierwszym dzieckiem;
 * chips bez wypełnienia zaczyna się kropką koloru, a ta żadnej szerokości nie
 * dostaje.
 */
function chipFill(tag: string): string {
  const chip = Array.from(document.querySelectorAll('button')).find(
    (node) => node.textContent === tag || node.textContent === `★${tag}`,
  );
  return (chip?.firstElementChild as HTMLElement | undefined)?.style.width ?? '';
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
    mount(<PickExerciseScreen day={DAY} />);
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

    expect(chipFill('chest')).toBe('50%');
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
