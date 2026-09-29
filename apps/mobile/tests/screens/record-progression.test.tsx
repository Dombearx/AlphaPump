/**
 * Historia poprawiania rekordu — ekran otwierany wprost z listy rekordów.
 *
 * Sprawdzane jest to, czego nie widzi test logiki: że ekran składa się na
 * prawdziwej bazie i że pokazuje **poprzednie** wyniki tej linii, od obecnego
 * rekordu w dół. To jest cała jego treść: sam rekord widać już na ekranie
 * zapisywania serii, a bez tego, co zbił, nie wiadomo, o ile to jest lepiej.
 */

import { screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../../src/db/sets';
import { RecordProgressionScreen } from '../../src/screens/record-progression';
import { EXERCISES, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

describe('ekran historii rekordu', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  const addBench = (day: string, kilograms: number, reps: number) =>
    createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.bench!.id,
      performedOn: day,
      values: {
        weightG: kilograms * 1000,
        reps,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  it('pokazuje łańcuch poprawiania, od obecnego rekordu do najstarszego', async () => {
    await addBench('2026-08-01', 80, 5);
    await addBench('2026-08-08', 90, 5);
    const obecny = await addBench('2026-08-15', 100, 5);

    await mount(<RecordProgressionScreen exerciseId={EXERCISES.bench!.id} setId={obecny.id} />);

    const text = screenText();
    expect(text).toContain('100 kg × 5');
    expect(text).toContain('90 kg × 5');
    expect(text).toContain('80 kg × 5');
    // Kolejność jest treścią tego ekranu: obecny rekord zbił ten niżej.
    expect(text.indexOf('100 kg × 5')).toBeLessThan(text.indexOf('90 kg × 5'));
    expect(text.indexOf('90 kg × 5')).toBeLessThan(text.indexOf('80 kg × 5'));
  });

  it('pomija serie, które rekordem nigdy nie były', async () => {
    await addBench('2026-08-01', 80, 5);
    await addBench('2026-08-10', 75, 4);
    const obecny = await addBench('2026-08-15', 100, 5);

    await mount(<RecordProgressionScreen exerciseId={EXERCISES.bench!.id} setId={obecny.id} />);

    expect(screenText()).not.toContain('75 kg × 4');
  });

  it('przy jedynym wyniku mówi to wprost, zamiast pokazywać listę z jednym wierszem bez wyjaśnienia', async () => {
    const pierwszy = await addBench('2026-08-15', 100, 5);

    await mount(<RecordProgressionScreen exerciseId={EXERCISES.bench!.id} setId={pierwszy.id} />);

    const text = screenText();
    expect(text).toContain('100 kg × 5');
    expect(text).toContain('first record');
    expect(screen.getByRole('button', { name: 'Back' })).toBeDefined();
  });

  it('dla serii, która rekordem nie jest, nie udaje historii', async () => {
    await addBench('2026-08-01', 100, 5);
    const slabsza = await addBench('2026-08-15', 80, 5);

    await mount(<RecordProgressionScreen exerciseId={EXERCISES.bench!.id} setId={slabsza.id} />);

    expect(screenText()).toContain('no longer a record');
  });
});
