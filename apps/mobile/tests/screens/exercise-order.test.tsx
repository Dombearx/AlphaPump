/**
 * Przełącznik „po czym układa się lista ćwiczeń".
 *
 * Sprawdzane jest to, czego nie widzi test czystej funkcji: że karta pokazuje
 * stan **zapisany na urządzeniu** (a nie domyślny) i że przestawienie
 * przełącznika naprawdę trafia do magazynu. Wartością domyślną jest
 * podpowiadanie i to też jest tu asercją — to ono odpowiada na pytanie,
 * z którym wchodzi się na ekran wyboru ćwiczenia.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ExerciseOrder, ExerciseOrderStore } from '../../src/exercise-order/state';
import { ExerciseOrderSettings } from '../../src/ui/exercise-order';
import { mount, user } from './harness';

/** Magazyn w pamięci — telefon trzyma kolejność w pliku, test w zmiennej. */
function memoryStore(order: ExerciseOrder): ExerciseOrderStore & { current: () => ExerciseOrder } {
  let current = order;
  return {
    read: () => Promise.resolve(current),
    write: (next) => {
      current = next;
      return Promise.resolve();
    },
    current: () => current,
  };
}

/**
 * `react-native-web` renderuje `Switch` jako pole wyboru, więc o jego stanie
 * pyta się wprost — tak samo jak przy dyktowaniu.
 */
const toggle = () => screen.getByLabelText('Suggest what to do next') as HTMLInputElement;

describe('kolejność ćwiczeń w ustawieniach', () => {
  it('domyślnie podpowiada, co wykonać', async () => {
    const store = memoryStore('rotation');
    await mount(<ExerciseOrderSettings store={store} />);

    expect(toggle().checked).toBe(true);
  });

  it('pokazuje kolejność zapisaną na urządzeniu', async () => {
    const store = memoryStore('usage');
    await mount(<ExerciseOrderSettings store={store} />);

    expect(toggle().checked).toBe(false);
  });

  it('wyłączenie trafia do magazynu', async () => {
    const store = memoryStore('rotation');
    await mount(<ExerciseOrderSettings store={store} />);

    await user().click(toggle());

    expect(store.current()).toBe('usage');
    expect(toggle().checked).toBe(false);
  });

  it('włączenie z powrotem też', async () => {
    const store = memoryStore('usage');
    await mount(<ExerciseOrderSettings store={store} />);

    await user().click(toggle());

    expect(store.current()).toBe('rotation');
  });
});
