/**
 * Wybór ćwiczenia — sprawdza, że skrót „Left in cycles" reaguje na pole
 * wyszukiwania. Skrót jest wyłącznie ułatwieniem wskazania ćwiczenia (patrz
 * nagłówek `pick-exercise.tsx`); gdy użytkownik zaczyna wpisywać nazwę,
 * poniżej i tak filtruje się właściwa lista, więc skrót ma się schować, a nie
 * zajmować miejsce nad wynikami, których nie dotyczy.
 */

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../../src/db/cycles';
import { PickExerciseScreen } from '../../src/screens/pick-exercise';
import { TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, user, type MountedScreen } from './harness';

const DAY = '2026-08-11';

describe('wybór ćwiczenia', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
    await createCycle(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: null,
      goals: [{ metric: 'sets', target: 10, exerciseId: null, tagId: TAGS.chest }],
    });
    mount(<PickExerciseScreen day={DAY} />);
  });

  afterEach(() => local.close());

  it('pokazuje skrót z cykli, dopóki pole wyszukiwania jest puste', () => {
    expect(screenText()).toContain('Left in cycles');
  });

  it('chowa skrót z cykli, gdy zaczyna się wpisywanie nazwy ćwiczenia', async () => {
    await user().type(screen.getByLabelText('Search'), 'bench');
    expect(screenText()).not.toContain('Left in cycles');
  });
});
