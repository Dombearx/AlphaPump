/**
 * Zawartość formularza serii.
 *
 * Sprawdzamy dwie rzeczy: że podpowiedź trafia w regułę ze specyfikacji i że
 * formularza nie da się zapisać w stanie, który baza odrzuciłaby dopiero przy
 * `INSERT`.
 */

import { describe, expect, it } from 'vitest';
import { draftOf, readDraft, suggestedDraft } from '../src/set-draft';

const set = (id: string, performedOn: string, position: number, weightG: number, reps: number) => ({
  id,
  performedOn,
  position,
  weightG,
  reps,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
});

describe('podpowiadanie wartości', () => {
  // Przykład wprost ze specyfikacji: poniedziałek 10, 9, 6, 4 → środa podpowiada 10.
  const monday = [
    set('a', '2026-08-10', 0, 80_000, 10),
    set('b', '2026-08-10', 1, 80_000, 9),
    set('c', '2026-08-10', 2, 80_000, 6),
    set('d', '2026-08-10', 3, 80_000, 4),
  ];

  it('pierwsza seria dnia bierze z pierwszej serii ostatniego dnia', () => {
    const draft = suggestedDraft('weight_reps', monday, '2026-08-12');

    expect(draft.values.reps).toBe('10');
    expect(draft.reason).toBe('previous-day');
  });

  it('kolejna seria tego dnia bierze z poprzedniej serii tego dnia', () => {
    const wednesday = [...monday, set('e', '2026-08-12', 0, 80_000, 8)];
    const draft = suggestedDraft('weight_reps', wednesday, '2026-08-12');

    expect(draft.values.reps).toBe('8');
    expect(draft.reason).toBe('same-day');
  });

  it('ćwiczenie robione pierwszy raz startuje z pustym formularzem', () => {
    const draft = suggestedDraft('weight_reps', [], '2026-08-12');

    expect(draft.values).toEqual({});
    expect(draft.reason).toBeNull();
  });

  it('nie podpowiada z przyszłości przy uzupełnianiu historii', () => {
    const draft = suggestedDraft('weight_reps', monday, '2026-08-01');
    expect(draft.reason).toBeNull();
  });

  it('nie przenosi notatki na kolejną serię', () => {
    const draft = draftOf('weight_reps', {
      weightG: 80_000,
      reps: 8,
      durationS: null,
      distanceM: null,
      bodyweightG: null,
      note: 'ciężko szło',
    });

    expect(draft.note).toBe('ciężko szło');
    // Podpowiedź to co innego niż wejście w istniejącą serię — notatka dotyczy
    // konkretnej serii, a nie zwyczaju.
    expect(suggestedDraft('weight_reps', monday, '2026-08-12').note).toBe('');
  });
});

describe('odczyt formularza', () => {
  it('zamienia napisy na liczby całkowite', () => {
    const result = readDraft('weight_reps', {
      values: { weightG: '82,5', reps: '8' },
      note: '  ',
    });

    expect(result).toEqual({
      ok: true,
      values: {
        weightG: 82_500,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });
  });

  it('wskazuje brakujące pola zamiast zapisywać połowę serii', () => {
    const result = readDraft('weight_reps', { values: { weightG: '80' }, note: '' });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.missing.map((field) => field.key)).toEqual(['reps']);
  });

  it('zostawia puste pola spoza typu logowania', () => {
    const result = readDraft('bodyweight_reps', { values: { reps: '12' }, note: '' });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.values.weightG).toBeNull();
      expect(result.values.distanceM).toBeNull();
    }
  });

  it('masa ciała jest opcjonalna i nie blokuje zapisu', () => {
    const withoutIt = readDraft('bodyweight_reps', { values: { reps: '12' }, note: '' });
    const withIt = readDraft('bodyweight_reps', {
      values: { reps: '12', bodyweightG: '78' },
      note: '',
    });

    expect(withoutIt.ok).toBe(true);
    expect(withIt.ok).toBe(true);
    if (withIt.ok) expect(withIt.values.bodyweightG).toBe(78_000);
  });
});
