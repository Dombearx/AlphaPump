/**
 * Kalendarz. Wymaganie: „kalendarz pokazuje liczbę serii
 * dla każdego dnia".
 *
 * Siatka jest liczona czystą funkcją, więc sprawdzamy ją bez renderowania
 * czegokolwiek. Zapytanie `daySetCounts` jest sprawdzone osobno, na prawdziwej
 * bazie — patrz `queries.test.ts`.
 */

import { describe, expect, it } from 'vitest';
import {
  addMonths,
  calendarRange,
  calendarWeeks,
  endOfMonth,
  HEAT_LEVELS,
  heatLevel,
  heatPeak,
  monthLabel,
  startOfMonth,
  startOfWeek,
  totalSets,
  weekdayIndex,
} from '../src/calendar';

const TODAY = '2026-08-11';

describe('granice okresów', () => {
  it('tydzień zaczyna się w poniedziałek', () => {
    // 11 sierpnia 2026 to wtorek.
    expect(weekdayIndex(TODAY)).toBe(1);
    expect(startOfWeek(TODAY)).toBe('2026-08-10');
    expect(startOfWeek('2026-08-16')).toBe('2026-08-10');
  });

  it('miesiąc ma pierwszy i ostatni dzień', () => {
    expect(startOfMonth(TODAY)).toBe('2026-08-01');
    expect(endOfMonth(TODAY)).toBe('2026-08-31');
    expect(endOfMonth('2028-02-05')).toBe('2028-02-29');
  });

  it('przesunięcie o miesiąc przechodzi przez granicę roku', () => {
    expect(addMonths('2026-12-31', 1)).toBe('2027-01-01');
    expect(addMonths('2026-01-15', -1)).toBe('2025-12-01');
  });

  it('nagłówek miesiąca jest po angielsku', () => {
    expect(monthLabel(TODAY)).toBe('August 2026');
  });
});

describe('zakres do policzenia', () => {
  it('miesiąc obejmuje pełne tygodnie razem z ogonami sąsiednich miesięcy', () => {
    // 1 sierpnia 2026 to sobota, 31 sierpnia to poniedziałek.
    expect(calendarRange(TODAY, 'month')).toEqual({ from: '2026-07-27', to: '2026-09-06' });
  });

  it('tydzień obejmuje dokładnie siedem dni', () => {
    expect(calendarRange(TODAY, 'week')).toEqual({ from: '2026-08-10', to: '2026-08-16' });
  });
});

describe('siatka kalendarza', () => {
  const counts = [
    { performedOn: '2026-08-10', sets: 5 },
    { performedOn: '2026-08-12', sets: 3 },
    { performedOn: '2026-07-30', sets: 9 },
  ];

  it('pokazuje liczbę serii w kafelku dnia', () => {
    const days = calendarWeeks(TODAY, 'month', counts, TODAY).flat();
    const byDay = new Map(days.map((day) => [day.day, day.sets]));

    expect(byDay.get('2026-08-10')).toBe(5);
    expect(byDay.get('2026-08-12')).toBe(3);
    // Dzień bez serii nie przyjeżdża z bazy, a mimo to musi być w siatce.
    expect(byDay.get('2026-08-11')).toBe(0);
  });

  it('każdy wiersz ma pełne siedem kafelków', () => {
    const weeks = calendarWeeks(TODAY, 'month', counts, TODAY);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });

  it('oznacza dzień bieżący, dni z przyszłości i dni spoza miesiąca', () => {
    const days = calendarWeeks(TODAY, 'month', counts, TODAY).flat();
    const byDay = new Map(days.map((day) => [day.day, day]));

    expect(byDay.get(TODAY)?.isToday).toBe(true);
    expect(byDay.get('2026-08-12')?.isFuture).toBe(true);
    expect(byDay.get('2026-08-10')?.isFuture).toBe(false);
    expect(byDay.get('2026-07-30')?.inMonth).toBe(false);
    expect(byDay.get('2026-08-01')?.inMonth).toBe(true);
  });

  it('widok tygodnia to jeden wiersz, w całości „w miesiącu"', () => {
    const weeks = calendarWeeks(TODAY, 'week', counts, TODAY);

    expect(weeks).toHaveLength(1);
    expect(weeks[0]?.every((day) => day.inMonth)).toBe(true);
    expect(weeks[0]?.map((day) => day.day)).toContain(TODAY);
  });

  it('suma pod siatką pomija ogony sąsiednich miesięcy', () => {
    const weeks = calendarWeeks(TODAY, 'month', counts, TODAY);
    // 9 serii z 30 lipca leży poza sierpniem i nie wchodzi do sumy miesiąca.
    expect(totalSets(weeks)).toBe(8);
  });
});

describe('heatmapa dni', () => {
  it('dzień bez serii nie dostaje żadnego odcienia', () => {
    expect(heatLevel(0, 20)).toBe(0);
  });

  it('nasycenie rośnie z liczbą serii i nie wychodzi poza skalę', () => {
    // Odniesienie 20 dzieli się na cztery równe progi: 5, 10, 15, 20.
    expect(heatLevel(1, 20)).toBe(1);
    expect(heatLevel(5, 20)).toBe(1);
    expect(heatLevel(6, 20)).toBe(2);
    expect(heatLevel(11, 20)).toBe(3);
    expect(heatLevel(16, 20)).toBe(4);
    expect(heatLevel(20, 20)).toBe(HEAT_LEVELS);
    // Dzień z sąsiedniego miesiąca może przebić maksimum tego oglądanego.
    expect(heatLevel(99, 20)).toBe(HEAT_LEVELS);
  });

  it('odniesieniem skali jest najcięższy dzień oglądanego miesiąca', () => {
    const weeks = calendarWeeks(TODAY, 'month', [{ performedOn: '2026-08-12', sets: 24 }], TODAY);
    expect(heatPeak(weeks)).toBe(24);
  });

  it('ogony sąsiednich miesięcy nie rozciągają skali', () => {
    const weeks = calendarWeeks(TODAY, 'month', [{ performedOn: '2026-07-30', sets: 40 }], TODAY);
    // 30 lipca jest w siatce sierpnia, ale poza samym sierpniem.
    expect(heatPeak(weeks)).toBe(10);
  });

  it('pojedyncza seria w pustym miesiącu nie świeci jak pełny trening', () => {
    const weeks = calendarWeeks(TODAY, 'month', [{ performedOn: '2026-08-12', sets: 1 }], TODAY);
    // Bez dolnej granicy odniesienia ta jedna seria byłaby własnym maksimum.
    expect(heatLevel(1, heatPeak(weeks))).toBe(1);
  });
});
