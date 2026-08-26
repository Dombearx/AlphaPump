/**
 * Historia serii ćwiczenia — ekran, po który sięga się w połowie treningu.
 *
 * Sprawdzane jest to, czego nie widzi test logiki: że ekran składa się na
 * prawdziwej bazie i że pokazuje serie **z poprzednich dni**, w tej samej
 * postaci co lista dnia. To jest cała jego treść — historia, która pokazuje
 * wyłącznie dzisiaj, nie odpowiada na pytanie „ile brałem ostatnim razem?".
 */

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../../src/db/sets';
import { ExerciseHistoryScreen } from '../../src/screens/exercise-history';
import { EXERCISES, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

const EARLIER = '2026-08-09';
const EVEN_EARLIER = '2026-08-02';

describe('ekran historii serii ćwiczenia', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  const addBench = (day: string, weightG: number, reps: number) =>
    createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.bench!.id,
      performedOn: day,
      values: { weightG, reps, durationS: null, distanceM: null, bodyweightG: null, note: null },
    });

  it('pokazuje serie z poprzednich treningów, dzień po dniu', async () => {
    await addBench(EVEN_EARLIER, 95_000, 6);
    await addBench(EARLIER, 100_000, 5);
    await addBench(EARLIER, 100_000, 4);

    await mount(<ExerciseHistoryScreen exerciseId={EXERCISES.bench!.id} />);

    const text = screenText();
    expect(text).toContain('100 kg × 5');
    expect(text).toContain('100 kg × 4');
    expect(text).toContain('95 kg × 6');
    // Ostatni trening stoi pierwszy — historię czyta się od końca.
    expect(text.indexOf('100 kg × 5')).toBeLessThan(text.indexOf('95 kg × 6'));
  });

  it('zawęża się do jednego ćwiczenia', async () => {
    await addBench(EARLIER, 100_000, 5);
    await createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.crunch!.id,
      performedOn: EARLIER,
      values: {
        weightG: null,
        reps: 30,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

    await mount(<ExerciseHistoryScreen exerciseId={EXERCISES.bench!.id} />);

    expect(screenText()).toContain('100 kg × 5');
    expect(screenText()).not.toContain('× 30');
  });

  it('bez ani jednej serii mówi to wprost, zamiast pokazywać pustą listę', async () => {
    await mount(<ExerciseHistoryScreen exerciseId={EXERCISES.bench!.id} />);

    expect(screenText()).toContain('No sets yet');
    // Wyjście musi być także wtedy, gdy nie ma czego czytać.
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();
  });
});
