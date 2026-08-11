/**
 * Scalanie list wyników — reguła, na której stoi wyszukiwanie hybrydowe.
 *
 * Najważniejszy jest tu test „wpis z obu warstw wygrywa z wpisem z jednej".
 * To jest cały sens dwóch warstw: gdyby scalenie tego nie zapewniało, warstwa
 * semantyczna byłaby kosztem bez efektu.
 */

import { describe, expect, it } from 'vitest';
import { RRF_K, fuseRankings } from '../src/rrf.js';

describe('fuseRankings', () => {
  it('wpis znaleziony przez obie warstwy wychodzi nad wpis z jednej', () => {
    const fused = fuseRankings([
      { source: 'lexical', ids: ['a', 'b'] },
      { source: 'semantic', ids: ['c', 'a'] },
    ]);

    expect(fused[0]?.id).toBe('a');
    expect(fused[0]?.sources).toEqual(['lexical', 'semantic']);
  });

  it('liczy wkład jako waga przez k plus miejsce', () => {
    const fused = fuseRankings([{ source: 'lexical', ids: ['a', 'b'] }]);

    expect(fused[0]).toMatchObject({ id: 'a', score: 1 / (RRF_K + 1) });
    expect(fused[1]).toMatchObject({ id: 'b', score: 1 / (RRF_K + 2) });
  });

  it('waga listy przekłada się na wynik', () => {
    const fused = fuseRankings([
      { source: 'lexical', ids: ['a'], weight: 2 },
      { source: 'semantic', ids: ['b'] },
    ]);

    expect(fused.map((entry) => entry.id)).toEqual(['a', 'b']);
    expect(fused[0]?.score).toBeCloseTo(2 / (RRF_K + 1));
  });

  it('powtórzenie w jednej liście nie dopłaca drugi raz ani nie przesuwa miejsc', () => {
    const withRepeat = fuseRankings([{ source: 'lexical', ids: ['a', 'a', 'b'] }]);
    const without = fuseRankings([{ source: 'lexical', ids: ['a', 'b'] }]);

    expect(withRepeat).toEqual(without);
  });

  it('kolejność jest deterministyczna także przy remisie', () => {
    const first = fuseRankings([
      { source: 'lexical', ids: ['z'] },
      { source: 'semantic', ids: ['a'] },
    ]);
    const second = fuseRankings([
      { source: 'semantic', ids: ['a'] },
      { source: 'lexical', ids: ['z'] },
    ]);

    expect(first.map((entry) => entry.id)).toEqual(['a', 'z']);
    expect(second.map((entry) => entry.id)).toEqual(['a', 'z']);
  });

  it('limit obcina listę po scaleniu, a nie przed', () => {
    const fused = fuseRankings(
      [
        { source: 'lexical', ids: ['a', 'b', 'c'] },
        { source: 'semantic', ids: ['c'] },
      ],
      { limit: 2 },
    );

    expect(fused.map((entry) => entry.id)).toEqual(['c', 'a']);
  });

  it('pusta lista wejściowa daje pusty wynik', () => {
    expect(fuseRankings([])).toEqual([]);
    expect(fuseRankings([{ source: 'lexical', ids: [] }])).toEqual([]);
  });
});
