/**
 * Karta „Bodyweight" na ekranie konta.
 *
 * Sprawdzane jest to, czego nie widzi test czystej funkcji: że pole pokazuje
 * masę **zapisaną na urządzeniu** (a nie pustkę), że zapis naprawdę trafia do
 * magazynu w gramach i że pole wyczyszczone kasuje ustawienie zamiast zapisywać
 * zero — bo zero podstawiałoby się potem do każdej serii.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { BodyweightStore } from '../../src/bodyweight/state';
import { BodyweightSettings } from '../../src/ui/bodyweight';
import { mount, screenText, user } from './harness';

/** Magazyn w pamięci — telefon trzyma masę w pliku, test w zmiennej. */
function memoryStore(
  bodyweightG: number | null,
): BodyweightStore & { current: () => number | null } {
  let current = bodyweightG;
  return {
    read: () => Promise.resolve(current),
    write: (next) => {
      current = next;
      return Promise.resolve();
    },
    current: () => current,
  };
}

const field = () => screen.getByLabelText('Current weight') as HTMLInputElement;
const saveButton = () => screen.getByRole('button', { name: 'Save bodyweight' });

describe('ustawienie masy ciała', () => {
  it('pokazuje masę zapisaną na urządzeniu, w kilogramach', async () => {
    await mount(<BodyweightSettings store={memoryStore(80_500)} />);

    expect(field().value).toBe('80.5');
  });

  it('startuje pusto, dopóki nikt masy nie podał', async () => {
    await mount(<BodyweightSettings store={memoryStore(null)} />);

    expect(field().value).toBe('');
  });

  it('zapisuje wpisaną masę w gramach', async () => {
    const store = memoryStore(null);
    await mount(<BodyweightSettings store={store} />);

    await user().type(field(), '78,5');
    await user().click(saveButton());

    expect(store.current()).toBe(78_500);
  });

  it('puste pole kasuje ustawienie', async () => {
    const store = memoryStore(80_000);
    await mount(<BodyweightSettings store={store} />);

    await user().clear(field());
    await user().click(saveButton());

    expect(store.current()).toBeNull();
  });

  it('bzdury nie zapisuje, tylko mówi, czego oczekuje', async () => {
    const store = memoryStore(80_000);
    await mount(<BodyweightSettings store={store} />);

    await user().clear(field());
    await user().type(field(), 'ciężko');
    await user().click(saveButton());

    expect(store.current()).toBe(80_000);
    expect(screenText()).toContain('Enter your weight in kilograms');
  });
});
