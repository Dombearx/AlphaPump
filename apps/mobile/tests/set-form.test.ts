/**
 * Przyciski formularza serii — reguła sprawdzana bez renderowania ekranu.
 *
 * Sedno jest w trybie edycji: nie ma tam ani dopisania serii, ani anulowania.
 * Edycję zamyka tapnięcie w tło, więc gdyby któryś z tych przycisków tu wrócił,
 * ekran znów miałby dwie drogi do tego samego i formularz zrobiłby się gęstszy
 * dokładnie w tym miejscu, w którym miał być pusty.
 */

import { describe, expect, it } from 'vitest';
import { setFormActions } from '../src/set-form';

describe('przyciski formularza serii', () => {
  it('przy dopisywaniu zostawia sam zapis nowej serii', () => {
    expect(setFormActions(null)).toEqual(['create']);
  });

  it('przy edycji daje zapis zmian i usunięcie', () => {
    expect(setFormActions('set-1')).toEqual(['update', 'delete']);
  });

  it('przy edycji nie oferuje dopisania serii — od tego jest tryb dopisywania', () => {
    expect(setFormActions('set-1')).not.toContain('create');
  });
});
