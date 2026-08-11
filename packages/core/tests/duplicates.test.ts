/**
 * Nakładanie werdyktów re-rankera.
 *
 * Odpowiedź modelu jest danymi z zewnątrz, nawet po walidacji schematu. Testy
 * pilnują więc głównie tego, czego model nie ma prawa zepsuć: werdykt spoza
 * zakresu i werdykt powtórzony nie mogą trafić w cudzy wpis, a kandydat, o którym
 * model się nie wypowiedział, musi zostać z `null` — czyli „nieoceniony", a nie
 * „nie duplikat".
 */

import { describe, expect, it } from 'vitest';
import {
  applyVerdicts,
  duplicateCheckResponseSchema,
  orderByVerdict,
  type DuplicateCandidate,
} from '../src/duplicates.js';

const candidate = (name: string, overrides: Partial<DuplicateCandidate> = {}) =>
  ({
    exerciseId: `00000000-0000-4000-8000-${String(name.length).padStart(12, '0')}`,
    name,
    authorNickname: 'Kuba',
    primaryTagName: 'Plecy',
    score: 0.5,
    sources: ['lexical'],
    identical: false,
    duplicate: null,
    reason: null,
    ...overrides,
  }) satisfies DuplicateCandidate;

describe('applyVerdicts', () => {
  it('nakłada werdykt po indeksie', () => {
    const result = applyVerdicts(
      [candidate('Martwy ciąg'), candidate('Przysiad')],
      [{ index: 0, duplicate: true, reason: 'To ten sam ruch co deadlift' }],
    );

    expect(result[0]).toMatchObject({ duplicate: true, reason: 'To ten sam ruch co deadlift' });
    expect(result[1]).toMatchObject({ duplicate: null, reason: null });
  });

  it('ignoruje indeks spoza zakresu', () => {
    const result = applyVerdicts(
      [candidate('Martwy ciąg')],
      [{ index: 7, duplicate: true, reason: 'nieistotne' }],
    );

    expect(result[0]?.duplicate).toBeNull();
  });

  it('pierwszy werdykt dla indeksu wygrywa', () => {
    const result = applyVerdicts(
      [candidate('Martwy ciąg')],
      [
        { index: 0, duplicate: true, reason: 'pierwszy' },
        { index: 0, duplicate: false, reason: 'drugi' },
      ],
    );

    expect(result[0]).toMatchObject({ duplicate: true, reason: 'pierwszy' });
  });

  it('nie zmienia listy, gdy werdyktów nie ma', () => {
    const input = [candidate('Martwy ciąg'), candidate('Przysiad')];
    expect(applyVerdicts(input, [])).toEqual(input);
  });
});

describe('orderByVerdict', () => {
  it('duplikaty idą przed nieocenione, a te przed odrzucone', () => {
    const ordered = orderByVerdict([
      candidate('Odrzucone', { duplicate: false }),
      candidate('Nieocenione'),
      candidate('Duplikat', { duplicate: true }),
    ]);

    expect(ordered.map((entry) => entry.name)).toEqual(['Duplikat', 'Nieocenione', 'Odrzucone']);
  });

  it('w obrębie grupy zostaje kolejność ze scalenia', () => {
    const ordered = orderByVerdict([
      candidate('Pierwszy', { duplicate: true }),
      candidate('Drugi', { duplicate: true }),
    ]);

    expect(ordered.map((entry) => entry.name)).toEqual(['Pierwszy', 'Drugi']);
  });
});

describe('duplicateCheckResponseSchema', () => {
  it('przyjmuje odpowiedź warstwy leksykalnej bez werdyktów', () => {
    const parsed = duplicateCheckResponseSchema.parse({
      query: 'martwy ciag',
      layer: 'lexical',
      candidates: [candidate('Martwy ciąg')],
    });

    expect(parsed.layer).toBe('lexical');
  });

  it('odrzuca warstwę, której nie znamy', () => {
    expect(() =>
      duplicateCheckResponseSchema.parse({ query: 'x', layer: 'magia', candidates: [] }),
    ).toThrow();
  });
});
