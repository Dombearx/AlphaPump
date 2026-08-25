/**
 * Przełącznik „co zrobić z podyktowaną serią".
 *
 * Sprawdzane jest to, czego nie widzi test czystej funkcji: że karta pokazuje
 * stan **zapisany na urządzeniu** (a nie domyślny), i że przestawienie
 * przełącznika naprawdę trafia do magazynu. Domyślną wartością jest ostrożniejsze
 * z dwóch zachowań i to też jest tu asercją — zapisywanie serii bez pytania nie
 * może włączyć się komuś samo.
 */

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { DictationMode, DictationStore } from '../../src/dictation/state';
import { DictationSettings } from '../../src/ui/dictation';
import { mount, screenText, user } from './harness';

/** Magazyn w pamięci — telefon trzyma tryb w pliku, test w zmiennej. */
function memoryStore(mode: DictationMode): DictationStore & { current: () => DictationMode } {
  let current = mode;
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
 * pyta się wprost — biblioteka asercji DOM-owych nie jest tu podpięta i nie ma
 * powodu dokładać jej dla jednego pola.
 */
const toggle = () => screen.getByLabelText('Save the set right away') as HTMLInputElement;

describe('ustawienie dyktowania', () => {
  it('domyślnie zostawia zapis człowiekowi', async () => {
    await mount(<DictationSettings store={memoryStore('form')} />);

    expect(screenText()).toContain('Save the set right away');
    expect(toggle().checked).toBe(false);
  });

  it('pokazuje wybór zapisany na urządzeniu', async () => {
    await mount(<DictationSettings store={memoryStore('save')} />);

    expect(toggle().checked).toBe(true);
  });

  it('przestawienie zapisuje się w magazynie', async () => {
    const store = memoryStore('form');
    await mount(<DictationSettings store={store} />);

    await user().click(toggle());

    expect(store.current()).toBe('save');
  });
});
