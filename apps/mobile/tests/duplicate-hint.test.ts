/**
 * Scalanie ostrzeżenia o duplikacie z warstwy lokalnej i serwerowej.
 *
 * Najważniejsze są tu dwa zachowania. Pierwsze: **brak odpowiedzi serwera nie
 * zabiera ostrzeżenia** — telefon poza VPN-em i wyłączona warstwa semantyczna
 * dają dokładnie to, co warstwa leksykalna. Drugie: pozycja, którą model wprost
 * odrzucił, nie zaśmieca listy — ale nie wypada, jeśli warstwa lokalna też ją
 * znalazła, bo „to nie to samo ćwiczenie" nie unieważnia faktu, że nazwa jest
 * podobna do złudzenia.
 */

import type { DuplicateCheckResponse, SimilarityMatch } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import { describeHint, mergeDuplicateHints, type LocalCandidate } from '../src/duplicate-hint';

const local = (id: string, name: string, identical = false): SimilarityMatch<LocalCandidate> => ({
  exercise: { id, name },
  score: 0.8,
  identical,
});

const remote = (
  candidates: DuplicateCheckResponse['candidates'],
  layer: DuplicateCheckResponse['layer'] = 'llm',
): DuplicateCheckResponse => ({ query: 'martwy ciag', layer, candidates });

const candidate = (
  id: string,
  name: string,
  overrides: Partial<DuplicateCheckResponse['candidates'][number]> = {},
) => ({
  exerciseId: id,
  name,
  authorNickname: 'Kuba',
  primaryTagName: 'Plecy',
  score: 0.5,
  sources: ['semantic' as const],
  identical: false,
  duplicate: null,
  reason: null,
  ...overrides,
});

describe('mergeDuplicateHints', () => {
  it('bez odpowiedzi serwera zostaje ostrzeżenie lokalne', () => {
    const hints = mergeDuplicateHints([local('e-1', 'Martwy ciąg')], null);

    expect(hints).toEqual([
      {
        exerciseId: 'e-1',
        name: 'Martwy ciąg',
        origin: 'local',
        reason: null,
        authorNickname: null,
        identical: false,
      },
    ]);
  });

  it('duplikat uznany przez model idzie pierwszy i niesie uzasadnienie', () => {
    const hints = mergeDuplicateHints(
      [local('e-1', 'Martwy ciąg')],
      remote([candidate('e-2', 'Deadlift', { duplicate: true, reason: 'To ten sam ruch' })]),
    );

    expect(hints[0]).toMatchObject({
      exerciseId: 'e-2',
      origin: 'model',
      reason: 'To ten sam ruch',
      authorNickname: 'Kuba',
    });
    expect(hints[1]?.exerciseId).toBe('e-1');
  });

  it('pozycja odrzucona przez model nie zaśmieca listy', () => {
    const hints = mergeDuplicateHints(
      [],
      remote([candidate('e-2', 'Przysiad', { duplicate: false, reason: 'Inny ruch' })]),
    );

    expect(hints).toEqual([]);
  });

  it('…ale zostaje, gdy warstwa lokalna też ją znalazła', () => {
    const hints = mergeDuplicateHints(
      [local('e-2', 'Przysiady')],
      remote([candidate('e-2', 'Przysiad', { duplicate: false, reason: 'Inny ruch' })]),
    );

    expect(hints).toHaveLength(1);
    expect(hints[0]).toMatchObject({ exerciseId: 'e-2', origin: 'local' });
  });

  it('nie powtarza pozycji znalezionej przez obie warstwy', () => {
    const hints = mergeDuplicateHints(
      [local('e-2', 'Deadlift')],
      remote([candidate('e-2', 'Deadlift', { duplicate: true, reason: 'To ten sam ruch' })]),
    );

    expect(hints).toHaveLength(1);
    expect(hints[0]?.origin).toBe('model');
  });

  it('trafienie samej warstwy semantycznej wchodzi jako nieocenione', () => {
    const hints = mergeDuplicateHints([], remote([candidate('e-3', 'Deadlift')], 'hybrid'));

    expect(hints[0]).toMatchObject({ exerciseId: 'e-3', origin: 'server', reason: null });
  });

  it('lista jest krótka, bo ostrzeżenie ma dać się przeczytać', () => {
    const hints = mergeDuplicateHints(
      [local('e-1', 'A'), local('e-2', 'B'), local('e-3', 'C'), local('e-4', 'D')],
      null,
    );

    expect(hints).toHaveLength(3);
  });
});

describe('describeHint', () => {
  it('uzasadnienie modelu wygrywa z opisem warstwy', () => {
    const [hint] = mergeDuplicateHints(
      [],
      remote([candidate('e-2', 'Deadlift', { duplicate: true, reason: 'To ten sam ruch' })]),
    );

    expect(describeHint(hint!)).toBe('To ten sam ruch');
  });

  it('bez uzasadnienia mówi, skąd wzięła się pozycja', () => {
    const [fromLocal] = mergeDuplicateHints([local('e-1', 'Martwy ciąg')], null);
    const [fromServer] = mergeDuplicateHints([], remote([candidate('e-3', 'Deadlift')], 'hybrid'));

    expect(describeHint(fromLocal!)).toBe('similar name');
    expect(describeHint(fromServer!)).toBe('similar meaning');
  });
});
