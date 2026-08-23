/**
 * Ekran zapisywania serii — jedyny, przez który przechodzi każdy trening.
 *
 * Sprawdzane jest to, czego nie widzi żaden test logiki: że ekran składa się
 * w całość, że pola formularza wynikają z **typu logowania ćwiczenia**, i że
 * zapis naprawdę dokłada wiersz do bazy lokalnej. To ostatnie jest sednem:
 * aplikacja jest offline-first, więc zapis do bazy lokalnej **jest** zapisem
 * serii — nic dalej nie musi się udać, żeby seria istniała.
 */

import { screen, waitFor } from '@testing-library/react';
import { workoutSets } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../../src/db/sets';
import { LogScreen } from '../../src/screens/log';
import { EXERCISES, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, user, type MountedScreen } from './harness';

const DAY = '2026-08-11';
const EARLIER = '2026-08-09';

describe('ekran zapisywania serii', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  describe('formularz wynika z typu logowania', () => {
    it('dla ciężaru z powtórzeniami pyta o ciężar i powtórzenia', async () => {
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);

      const text = screenText();
      expect(text).toContain('Weight');
      expect(text).toContain('Reps');
      expect(text).not.toContain('Duration');
    });

    it('dla masy ciała nie pyta o ciężar', async () => {
      // Pole ciężaru byłoby tu polem, którego nie da się sensownie wypełnić,
      // a walidacja pomiarów i tak odrzuciłaby wartość.
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.crunch!.id} />);

      const text = screenText();
      expect(text).toContain('Reps');
      expect(text).not.toContain('Weight');
    });
  });

  describe('pusty dzień', () => {
    it('tłumaczy, że nic tu jeszcze nie ma', async () => {
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);
      expect(screenText()).toContain('None yet');
    });

    it('nazywa brakujące pomiary, zamiast zapisać pustą serię', async () => {
      // Przy pierwszej serii ćwiczenia nie ma z czego zbudować podpowiedzi, więc
      // formularz jest pusty, a naciśnięcie „Add set" ma **nazwać** brakujące
      // pomiary. Cicha odmowa wyglądałaby jak zapisana seria, której nie ma.
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);
      await user().click(screen.getByRole('button', { name: 'Add set' }));

      expect(screenText()).toContain('Fill in: weight, reps');
      expect(await local.db.select().from(workoutSets)).toHaveLength(0);
    });
  });

  it('zapisuje serię wpisaną z palca', async () => {
    await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);

    await user().type(screen.getByLabelText('Weight'), '80');
    await user().type(screen.getByLabelText('Reps'), '8');
    await user().click(screen.getByRole('button', { name: 'Add set' }));

    const rows = await local.db.select().from(workoutSets);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      exerciseId: EXERCISES.bench!.id,
      performedOn: DAY,
      userId: TEST_USER.id,
      weightG: 80_000,
      reps: 8,
    });
    // Bez `server_seq`: serwer o tym wierszu jeszcze nie wie i to jest normalny
    // stan po zapisie offline.
    expect(rows[0]?.serverSeq).toBeNull();
  });

  describe('gdy ćwiczenie ma historię', () => {
    beforeEach(async () => {
      await createSet(local.db, {
        userId: TEST_USER.id,
        deviceId: 'device-a',
        exerciseId: EXERCISES.bench!.id,
        performedOn: EARLIER,
        values: {
          weightG: 100_000,
          reps: 5,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
        },
      });
    });

    it('zapisuje powtórzenie jednym naciśnięciem', async () => {
      // Najkrótsza droga do zapisania serii to **jedno** naciśnięcie: formularz
      // jest już wypełniony podpowiedzią z poprzedniego treningu. To jest
      // wymaganie, a nie wygoda — i jedyne miejsce, w którym da się je sprawdzić
      // w całości, bo składa się z podpowiedzi, formularza i zapisu naraz.
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);
      await user().click(screen.getByRole('button', { name: 'Add set' }));

      const rows = await local.db.select().from(workoutSets).where(eqDay(DAY));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ weightG: 100_000, reps: 5 });
    });

    it('pokazuje zapisaną serię na liście dnia', async () => {
      await mount(<LogScreen day={DAY} exerciseId={EXERCISES.bench!.id} />);
      await user().click(screen.getByRole('button', { name: 'Add set' }));

      // Lista dnia jedzie z `useLiveQuery`, więc przerysowuje się po zapisie,
      // a nie w jego trakcie — asercja bez czekania sprawdzałaby wyścig.
      await waitFor(() => {
        expect(screenText()).not.toContain('None yet');
      });
      expect(screenText()).toContain('100');
    });
  });
});

/** Filtr po dniu — seria z historii leży w innym dniu i nie ma się tu liczyć. */
function eqDay(day: string) {
  return eq(workoutSets.performedOn, day);
}
