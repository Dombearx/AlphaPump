/**
 * Nagłówki dni.
 *
 * Nazwy są wpisane wprost zamiast wołać `Intl`, bo Hermes bywa budowany bez
 * pełnych danych ICU — a wtedy polski dzień tygodnia wychodzi po angielsku
 * dopiero na urządzeniu.
 */

import { describe, expect, it } from 'vitest';
import { formatDate, formatDaySubtitle, formatDayTitle, formatShortDate } from '../src/day-labels';

const TODAY = '2026-08-11';

describe('tytuł dnia', () => {
  it('woli słowo od daty tam, gdzie tak się mówi', () => {
    expect(formatDayTitle(TODAY, TODAY)).toBe('Today');
    expect(formatDayTitle('2026-08-10', TODAY)).toBe('Yesterday');
    expect(formatDayTitle('2026-08-12', TODAY)).toBe('Tomorrow');
  });

  it('dla pozostałych dni podaje dzień tygodnia i datę', () => {
    expect(formatDayTitle('2026-08-08', TODAY)).toBe('Saturday, 8 August');
  });

  it('dokłada rok, gdy jest inny niż bieżący', () => {
    expect(formatDate('2025-12-24', TODAY)).toBe('24 December 2025');
    expect(formatDate('2026-12-24', TODAY)).toBe('24 December');
  });

  it('podtytuł podaje pełną datę także dzisiaj', () => {
    expect(formatDaySubtitle(TODAY, TODAY)).toBe('Tuesday, 11 August');
  });

  it('używa dopełniacza miesiąca', () => {
    expect(formatDate('2026-08-11', TODAY)).toBe('11 August');
    expect(formatDate('2026-03-01', TODAY)).toBe('1 March');
  });
});

describe('krótka data pod słupkiem wykresu', () => {
  it('podaje dzień i miesiąc oddzielone kropką, oba z zerem wiodącym', () => {
    expect(formatShortDate('2026-08-11')).toBe('11.08');
    expect(formatShortDate('2026-03-01')).toBe('01.03');
  });
});
