import { describe, expect, it } from 'vitest';
import {
  globalRecordSchema,
  rankCandidates,
  rankingEntrySchema,
  setVolume,
  type RankingCandidate,
} from '../src/rankings.js';
import { makeSet, weightReps } from './helpers.js';

const ANIA = '00000000-0000-7000-8000-00000000000a';
const BARTEK = '00000000-0000-7000-8000-00000000000b';
const CELINA = '00000000-0000-7000-8000-00000000000c';

const candidate = (userId: string, nickname: string, value: number): RankingCandidate => ({
  userId,
  nickname,
  value,
});

describe('setVolume', () => {
  it('mnoży gramy przez powtórzenia', () => {
    expect(setVolume(weightReps(80, 8))).toBe(640_000);
  });

  it('oddaje liczbę całkowitą także dla ciężaru z połówką kilograma', () => {
    const objetosc = setVolume(makeSet({ weightG: 82_500, reps: 3 }));
    expect(Number.isInteger(objetosc)).toBe(true);
    expect(objetosc).toBe(247_500);
  });

  it('nie liczy serii bez kompletu ciężaru i powtórzeń', () => {
    expect(setVolume(makeSet({ durationS: 90 }))).toBe(0);
    expect(setVolume(makeSet({ weightG: 60_000 }))).toBe(0);
    expect(setVolume(makeSet({ reps: 10 }))).toBe(0);
  });

  it('liczy serie z zerowym ciężarem jako zerową objętość', () => {
    expect(setVolume(makeSet({ weightG: 0, reps: 20 }))).toBe(0);
  });
});

describe('rankCandidates', () => {
  it('układa malejąco i numeruje od jedynki', () => {
    const ranking = rankCandidates([
      candidate(ANIA, 'ania', 100),
      candidate(BARTEK, 'bartek', 300),
      candidate(CELINA, 'celina', 200),
    ]);

    expect(ranking.map((entry) => entry.nickname)).toEqual(['bartek', 'celina', 'ania']);
    expect(ranking.map((entry) => entry.position)).toEqual([1, 2, 3]);
  });

  it('daje remisującym wspólne miejsce, a następne przeskakuje', () => {
    const ranking = rankCandidates([
      candidate(ANIA, 'ania', 500),
      candidate(BARTEK, 'bartek', 500),
      candidate(CELINA, 'celina', 100),
    ]);

    expect(ranking.map((entry) => entry.position)).toEqual([1, 1, 3]);
  });

  it('pomija zerowe wyniki — kto nie biegał, nie startuje w rankingu dystansu', () => {
    const ranking = rankCandidates([candidate(ANIA, 'ania', 0), candidate(BARTEK, 'bartek', 5000)]);

    expect(ranking).toHaveLength(1);
    expect(ranking[0]?.nickname).toBe('bartek');
  });

  it('jest deterministyczny mimo remisu — kolejność nie zależy od wejścia', () => {
    const wejscie = [candidate(BARTEK, 'bartek', 10), candidate(ANIA, 'ania', 10)];

    const wPrzod = rankCandidates(wejscie).map((entry) => entry.userId);
    const wTyl = rankCandidates([...wejscie].reverse()).map((entry) => entry.userId);

    expect(wPrzod).toEqual(wTyl);
  });

  it('zwraca wpisy zgodne z własnym schematem', () => {
    const [entry] = rankCandidates([candidate(ANIA, 'ania', 42)]);
    expect(rankingEntrySchema.safeParse(entry).success).toBe(true);
  });

  it('z pustego wejścia robi pusty ranking', () => {
    expect(rankCandidates([])).toEqual([]);
  });
});

describe('globalRecordSchema', () => {
  const rekord = {
    nickname: 'ania',
    performedOn: '2026-08-10',
    note: 'na koniec treningu',
    weightG: 100_000,
    reps: 5,
    durationS: null,
    distanceM: null,
  };

  it('przepuszcza wartość, nick, datę i notatkę', () => {
    expect(globalRecordSchema.safeParse(rekord).success).toBe(true);
  });

  it('nie przepuszcza pól, po których dałoby się odpytać cudzą historię', () => {
    const parsed = globalRecordSchema.parse({
      ...rekord,
      setId: '00000000-0000-7000-8000-000000000001',
      userId: ANIA,
    });

    expect(parsed).not.toHaveProperty('setId');
    expect(parsed).not.toHaveProperty('userId');
  });
});
