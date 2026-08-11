/**
 * Nagłówki dni.
 *
 * Nazwy są wpisane wprost zamiast wołać `Intl`, bo Hermes bywa budowany bez
 * pełnych danych ICU — a wtedy polski dzień tygodnia wychodzi po angielsku
 * dopiero na urządzeniu.
 */

import { describe, expect, it } from 'vitest';
import { formatDate, formatDaySubtitle, formatDayTitle } from '../src/day-labels';

const TODAY = '2026-08-11';

describe('tytuł dnia', () => {
  it('woli słowo od daty tam, gdzie tak się mówi', () => {
    expect(formatDayTitle(TODAY, TODAY)).toBe('Dziś');
    expect(formatDayTitle('2026-08-10', TODAY)).toBe('Wczoraj');
    expect(formatDayTitle('2026-08-12', TODAY)).toBe('Jutro');
  });

  it('dla pozostałych dni podaje dzień tygodnia i datę', () => {
    expect(formatDayTitle('2026-08-08', TODAY)).toBe('Sobota, 8 sierpnia');
  });

  it('dokłada rok, gdy jest inny niż bieżący', () => {
    expect(formatDate('2025-12-24', TODAY)).toBe('24 grudnia 2025');
    expect(formatDate('2026-12-24', TODAY)).toBe('24 grudnia');
  });

  it('podtytuł podaje pełną datę także dzisiaj', () => {
    expect(formatDaySubtitle(TODAY, TODAY)).toBe('Wtorek, 11 sierpnia');
  });

  it('używa dopełniacza miesiąca', () => {
    // „11 sierpnia", a nie „11 sierpień".
    expect(formatDate('2026-08-11', TODAY)).toBe('11 sierpnia');
    expect(formatDate('2026-03-01', TODAY)).toBe('1 marca');
  });
});
