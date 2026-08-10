import { describe, expect, it } from 'vitest';
import {
  addDays,
  compareIsoDates,
  differenceInDays,
  isIsoDate,
  isWithinRange,
  parseIsoDate,
  toIsoDate,
} from '../src/dates.js';

describe('isIsoDate', () => {
  it('przyjmuje istniejące daty w formacie YYYY-MM-DD', () => {
    expect(isIsoDate('2026-08-10')).toBe(true);
    expect(isIsoDate('2024-02-29')).toBe(true);
  });

  it('odrzuca daty nieistniejące i zły format', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2025-02-29')).toBe(false);
    expect(isIsoDate('2026-8-10')).toBe(false);
    expect(isIsoDate('10.08.2026')).toBe(false);
    expect(isIsoDate(20_260_810)).toBe(false);
  });
});

describe('toIsoDate', () => {
  it('bierze dzień z czasu lokalnego, a nie z UTC', () => {
    const wieczorem = new Date(2026, 7, 10, 23, 30);
    expect(toIsoDate(wieczorem)).toBe('2026-08-10');
  });

  it('uzupełnia zerami', () => {
    expect(toIsoDate(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('arytmetyka dni', () => {
  it('przesuwa datę przez granice miesiąca i roku', () => {
    expect(addDays('2026-08-31', 1)).toBe('2026-09-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29');
  });

  it('liczy różnicę w dniach', () => {
    expect(differenceInDays('2026-08-10', '2026-08-12')).toBe(2);
    expect(differenceInDays('2026-08-12', '2026-08-10')).toBe(-2);
  });

  it('nie gubi dnia przy zmianie czasu — dzień jest kalendarzowy, nie strefowy', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29');
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25');
    expect(differenceInDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('rozkłada datę na składowe i odrzuca śmieci', () => {
    expect(parseIsoDate('2026-08-10')).toEqual({ year: 2026, month: 8, day: 10 });
    expect(() => parseIsoDate('2026-02-30')).toThrow(RangeError);
  });
});

describe('porównania', () => {
  it('porządek leksykograficzny pokrywa się z chronologicznym', () => {
    const dni = ['2026-08-10', '2025-12-31', '2026-01-05'];
    expect([...dni].sort(compareIsoDates)).toEqual(['2025-12-31', '2026-01-05', '2026-08-10']);
  });

  it('zakres jest domknięty obustronnie, a brak końca oznacza brak górnej granicy', () => {
    expect(isWithinRange('2026-08-01', '2026-08-01', '2026-08-31')).toBe(true);
    expect(isWithinRange('2026-08-31', '2026-08-01', '2026-08-31')).toBe(true);
    expect(isWithinRange('2026-09-01', '2026-08-01', '2026-08-31')).toBe(false);
    expect(isWithinRange('2030-01-01', '2026-08-01', null)).toBe(true);
    expect(isWithinRange('2026-07-31', '2026-08-01', null)).toBe(false);
  });
});
