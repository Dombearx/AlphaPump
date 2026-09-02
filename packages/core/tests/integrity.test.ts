/**
 * Konflikty w danych — czyszczenie przy odczycie i rozbiór list.
 *
 * Reguła, której pilnują te testy, jest jedna: **zepsuty wiersz psuje siebie,
 * a nie wszystko dookoła**. Ćwiczenia i tagi są globalne, więc jeden wiersz,
 * którego nie przyjmuje schemat, jedzie w każdej odpowiedzi — bez tych dwóch
 * mechanizmów zabierał panel administratorowi i synchronizację wszystkim naraz,
 * i to na stałe, bo jedynym narzędziem do jego poprawienia był ten sam panel.
 */

import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { identifyRow, parseRows, sanitizeAdditionalTagIds } from '../src/integrity.js';
import { exerciseSchema } from '../src/schemas.js';

const PRIMARY = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THIRD = '33333333-3333-4333-8333-333333333333';

describe('czyszczenie zestawu tagów dodatkowych', () => {
  it('zdejmuje tag główny powtórzony wśród dodatkowych', () => {
    expect(sanitizeAdditionalTagIds(PRIMARY, [OTHER, PRIMARY, THIRD])).toEqual([OTHER, THIRD]);
  });

  it('zdejmuje powtórzenia wśród samych dodatkowych', () => {
    expect(sanitizeAdditionalTagIds(PRIMARY, [OTHER, OTHER])).toEqual([OTHER]);
  });

  it('zostawia kolejność, bo widać ją w aplikacji', () => {
    expect(sanitizeAdditionalTagIds(PRIMARY, [THIRD, OTHER])).toEqual([THIRD, OTHER]);
  });

  it('nie rusza zestawu, w którym nie ma nic do naprawienia', () => {
    expect(sanitizeAdditionalTagIds(PRIMARY, [])).toEqual([]);
    expect(sanitizeAdditionalTagIds(PRIMARY, [OTHER])).toEqual([OTHER]);
  });

  /** Sedno: po wyczyszczeniu wiersz **przechodzi** przez schemat encji. */
  it('daje zestaw, który przechodzi przez schemat ćwiczenia', () => {
    const broken = {
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Wyciskanie',
      slug: 'wyciskanie',
      authorId: '55555555-5555-4555-8555-555555555555',
      loggingType: 'weight_reps',
      primaryTagId: PRIMARY,
      additionalTagIds: [PRIMARY, OTHER, OTHER],
      note: null,
      gym: null,
      translations: null,
      createdAt: '2026-01-01T10:00:00.000Z',
      updatedAt: '2026-01-01T10:00:00.000Z',
      deletedAt: null,
    };

    expect(exerciseSchema.safeParse(broken).success).toBe(false);
    expect(
      exerciseSchema.safeParse({
        ...broken,
        additionalTagIds: sanitizeAdditionalTagIds(broken.primaryTagId, broken.additionalTagIds),
      }).success,
    ).toBe(true);
  });
});

describe('rozbiór listy wiersz po wierszu', () => {
  const rowSchema = z.object({ id: z.string(), value: z.int() });

  it('oddaje wiersze poprawne i opisuje odrzucone zamiast unieważniać całość', () => {
    const { items, rejected } = parseRows(
      [
        { id: 'a', value: 1 },
        { id: 'b', value: 'nie liczba' },
        { id: 'c', value: 3 },
      ],
      rowSchema,
    );

    expect(items).toEqual([
      { id: 'a', value: 1 },
      { id: 'c', value: 3 },
    ]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.index).toBe(1);
    expect(rejected[0]?.id).toBe('b');
    expect(rejected[0]?.message).toContain('value');
  });

  it('radzi sobie z wierszem, który nie jest nawet obiektem', () => {
    const { items, rejected } = parseRows([null, 7, 'tekst'], rowSchema);

    expect(items).toEqual([]);
    expect(rejected.map((row) => row.index)).toEqual([0, 1, 2]);
    expect(rejected.every((row) => row.id === null && row.name === null)).toBe(true);
  });

  it('nie odrzuca niczego, gdy odrzucać nie ma czego', () => {
    const { items, rejected } = parseRows([{ id: 'a', value: 1 }], rowSchema);
    expect(items).toHaveLength(1);
    expect(rejected).toEqual([]);
  });
});

describe('rozpoznanie odrzuconego wiersza', () => {
  it('czyta nazwę spod opakowania listy panelu', () => {
    expect(identifyRow({ exercise: { id: 'x', name: 'Wyciskanie' }, usage: {} })).toEqual({
      id: 'x',
      name: 'Wyciskanie',
    });
    expect(identifyRow({ tag: { id: 't', name: 'Klata' } })).toEqual({ id: 't', name: 'Klata' });
  });

  it('woli pola z wierzchu, gdy tam są', () => {
    expect(identifyRow({ id: 'z', name: 'Tag' })).toEqual({ id: 'z', name: 'Tag' });
  });

  it('oddaje puste, gdy w wierszu nie ma czego rozpoznać', () => {
    expect(identifyRow(42)).toEqual({ id: null, name: null });
    expect(identifyRow({ nic: true })).toEqual({ id: null, name: null });
  });
});
