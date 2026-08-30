/**
 * Siatka kalendarza.
 *
 * Moduł jest czysty: dostaje dzień jako `YYYY-MM-DD` i liczniki serii, oddaje
 * gotowe do narysowania kafelki. Nie sięga po zegar i nie zna bazy — dzięki temu
 * „kalendarz pokazuje liczbę serii dla każdego dnia" da się sprawdzić bez
 * renderowania czegokolwiek.
 *
 * Tydzień zaczyna się w **poniedziałek**, tak jak w polskim kalendarzu.
 * `Date#getUTCDay` liczy od niedzieli, więc przesunięcie jest tu robione raz,
 * w `weekdayIndex`, zamiast rozsypywać się po ekranach.
 *
 * Siatka miesiąca jest zawsze pełnymi tygodniami: pierwszy wiersz zaczyna się od
 * poniedziałku sprzed pierwszego dnia miesiąca, ostatni kończy niedzielą po
 * ostatnim. Dni z sąsiednich miesięcy zostają w siatce (z `inMonth: false`),
 * bo dziura w rogu wygląda jak błąd, a poza tym są klikalne tak samo jak reszta.
 */

import { addDays, daysInMonth, parseIsoDate, type IsoDate } from '@alphapump/core';

/** Poniedziałek to zero — tak jak w polskim kalendarzu. */
export function weekdayIndex(day: IsoDate): number {
  const { year, month, day: date } = parseIsoDate(day);
  return (new Date(Date.UTC(year, month - 1, date)).getUTCDay() + 6) % 7;
}

export const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
] as const;

export function startOfWeek(day: IsoDate): IsoDate {
  return addDays(day, -weekdayIndex(day));
}

export function startOfMonth(day: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(day);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-01`;
}

export function endOfMonth(day: IsoDate): IsoDate {
  const { year, month } = parseIsoDate(day);
  const last = daysInMonth(year, month);
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
}

/** Przesunięcie o pełne miesiące, z zachowaniem sensownego dnia (zawsze pierwszy). */
export function addMonths(day: IsoDate, months: number): IsoDate {
  const { year, month } = parseIsoDate(day);
  const total = year * 12 + (month - 1) + months;
  const shiftedYear = Math.floor(total / 12);
  const shiftedMonth = (total % 12) + 1;
  return `${String(shiftedYear).padStart(4, '0')}-${String(shiftedMonth).padStart(2, '0')}-01`;
}

export function monthLabel(day: IsoDate): string {
  const { year, month } = parseIsoDate(day);
  return `${MONTH_LABELS[month - 1] as string} ${String(year)}`;
}

/** Widok kalendarza. Miesiąc do przeglądania historii, tydzień do bieżącego treningu. */
export type CalendarScale = 'month' | 'week';

export interface CalendarDay {
  day: IsoDate;
  /** Liczba serii tego dnia — to ona stoi w kafelku. */
  sets: number;
  /** Czy dzień należy do oglądanego miesiąca; w widoku tygodnia zawsze `true`. */
  inMonth: boolean;
  isToday: boolean;
  /** Dzień z przyszłości — nie ma jeszcze czego w nim zapisać. */
  isFuture: boolean;
}

/** Zakres dni, które trzeba policzyć, żeby zbudować siatkę. */
export interface CalendarRange {
  from: IsoDate;
  to: IsoDate;
}

export function calendarRange(anchor: IsoDate, scale: CalendarScale): CalendarRange {
  if (scale === 'week') {
    const from = startOfWeek(anchor);
    return { from, to: addDays(from, 6) };
  }

  const from = startOfWeek(startOfMonth(anchor));
  const lastWeek = startOfWeek(endOfMonth(anchor));
  return { from, to: addDays(lastWeek, 6) };
}

/** Liczniki serii w rozbiciu na dni — kształt, który przynosi zapytanie. */
export type SetCounts = readonly { performedOn: IsoDate; sets: number }[];

/**
 * Siatka kalendarza w podziale na tygodnie. Każdy wiersz ma dokładnie siedem
 * kafelków, także wtedy, gdy miesiąc zaczyna się w środku tygodnia.
 */
export function calendarWeeks(
  anchor: IsoDate,
  scale: CalendarScale,
  counts: SetCounts,
  today: IsoDate,
): CalendarDay[][] {
  const { from, to } = calendarRange(anchor, scale);
  const setsByDay = new Map(counts.map((row) => [row.performedOn, row.sets]));
  const month = parseIsoDate(anchor).month;

  const weeks: CalendarDay[][] = [];
  let current: CalendarDay[] = [];

  for (let day = from; day <= to; day = addDays(day, 1)) {
    current.push({
      day,
      sets: setsByDay.get(day) ?? 0,
      inMonth: scale === 'week' || parseIsoDate(day).month === month,
      isToday: day === today,
      isFuture: day > today,
    });

    if (current.length === 7) {
      weeks.push(current);
      current = [];
    }
  }

  if (current.length > 0) weeks.push(current);
  return weeks;
}

/** Ile serii w całym oglądanym zakresie — podpis pod siatką. */
export function totalSets(weeks: readonly CalendarDay[][]): number {
  return weeks.flat().reduce((sum, day) => sum + (day.inMonth ? day.sets : 0), 0);
}

/**
 * Heatmapa dni, jak kalendarz commitów na GitHubie: im więcej serii tego dnia,
 * tym mocniejszy odcień kafelka. Poziom zero to dzień bez serii — zostaje na
 * neutralnym tle, żeby pusty miesiąc nie wyglądał jak lekko przećwiczony.
 */
export const HEAT_LEVELS = 4;

/**
 * Dolna granica odniesienia dla skali. Skala jest liczona względem oglądanego
 * okresu, a nie całej historii — kalendarz i tak ciągnie z bazy tylko widoczny
 * zakres, a maksimum z wszystkich lat kosztowałoby przy każdym przewinięciu
 * zapytanie po całej tabeli. Za to bez tej granicy jedna seria w pustym
 * miesiącu byłaby własnym maksimum i świeciłaby najmocniej — czyli tak samo,
 * jak dzień z pełnym treningiem miesiąc obok.
 */
const HEAT_FLOOR = 10;

/** Odniesienie skali: najcięższy dzień okresu, ale nie mniej niż `HEAT_FLOOR`. */
export function heatPeak(weeks: readonly CalendarDay[][]): number {
  const days = weeks.flat().filter((day) => day.inMonth);
  return Math.max(HEAT_FLOOR, ...days.map((day) => day.sets));
}

/** Stopień nasycenia kafelka: 0 dla dnia bez serii, dalej od 1 do `HEAT_LEVELS`. */
export function heatLevel(sets: number, peak: number): number {
  if (sets <= 0) return 0;
  return Math.min(HEAT_LEVELS, Math.max(1, Math.ceil((sets / peak) * HEAT_LEVELS)));
}
