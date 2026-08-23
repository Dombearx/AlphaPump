/**
 * Wybór ćwiczenia — sprawdza oznaczenie tagów, w których została jeszcze robota
 * z cyklu. Oznaczeniem jest gwiazdka **wewnątrz** chipsa tagu (patrz nagłówek
 * `pick-exercise.tsx`), więc asercje stawiamy na tekście, który ekran skleja:
 * gwiazdka stoi w miejscu kropki koloru, czyli tuż przed nazwą tagu.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../../src/db/cycles';
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { EXERCISES, TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

const DAY = '2026-08-11';

describe('wybór ćwiczenia', () => {
  let local: MountedScreen;

  const withGoal = async (goal: { exerciseId: string | null; tagId: string | null }) => {
    await createCycle(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: null,
      goals: [{ metric: 'sets', target: 10, ...goal }],
    });
    await mount(<PickExerciseScreen day={DAY} />);
  };

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

  it('nie pokazuje osobnej sekcji z pozostałymi pozycjami', async () => {
    await withGoal({ exerciseId: null, tagId: TAGS.chest });

    expect(screenText()).not.toContain('Left in cycles');
  });
});
