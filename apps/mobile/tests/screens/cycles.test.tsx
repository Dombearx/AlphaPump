/**
 * Lista cykli — formatowanie zakresu dat.
 *
 * Cykl bez resetu czy archiwizacji zostaje na liście aktywnych także po
 * minięciu daty końca i dalej pokazuje zamrożony procent — patrz #108.
 * `formatRange` ma to wprost zaznaczyć, żeby ten procent nie wyglądał jak
 * coś, co się jeszcze liczy.
 */

import { describe, expect, it } from 'vitest';
import { formatRange } from '../../src/screens/cycles';

const TODAY = '2026-09-08';

describe('zakres dat cyklu', () => {
  it('nie dopisuje nic, gdy cykl wciąż trwa', () => {
    expect(formatRange({ startsOn: '2026-09-01', endsOn: '2026-09-30' }, TODAY)).toBe(
      '1 September – 30 September',
    );
  });

  it('dopisuje, że cykl już się skończył, gdy data końca minęła', () => {
    expect(formatRange({ startsOn: '2026-08-03', endsOn: '2026-09-02' }, TODAY)).toBe(
      '3 August – 2 September · ended',
    );
  });

  it('kończący się dzisiaj jeszcze nie jest oznaczony jako zakończony', () => {
    expect(formatRange({ startsOn: '2026-09-01', endsOn: TODAY }, TODAY)).toBe(
      '1 September – 8 September',
    );
  });

  it('cykl bez daty końca nigdy nie jest oznaczony jako zakończony', () => {
    expect(formatRange({ startsOn: '2026-09-01', endsOn: null }, TODAY)).toBe(
      'from 1 September, no end',
    );
  });
});
