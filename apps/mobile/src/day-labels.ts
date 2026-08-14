/**
 * Dni po polsku.
 *
 * Nazwy są wpisane wprost, zamiast wołać `Intl`. Powód jest praktyczny: Hermes
 * bywa budowany bez pełnych danych ICU i wtedy `toLocaleDateString('pl')` cicho
 * oddaje angielskie nazwy — na urządzeniu, nie na maszynie dewelopera. Dwanaście
 * napisów jest tańsze niż taka niespodzianka.
 *
 * Moduł jest czysty: dostaje dzień jako `YYYY-MM-DD` i nie sięga po zegar.
 */

import { addDays, parseIsoDate, toIsoDate, type IsoDate } from '@alphapump/core';

const WEEKDAYS = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

const MONTHS = [
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

function weekdayOf(day: IsoDate): string {
  const { year, month, day: date } = parseIsoDate(day);
  return WEEKDAYS[new Date(Date.UTC(year, month - 1, date)).getUTCDay()] as string;
}

/** „11 sierpnia 2026". Rok tylko wtedy, gdy inny niż rok odniesienia. */
export function formatDate(day: IsoDate, reference: IsoDate): string {
  const { year, month, day: date } = parseIsoDate(day);
  const name = MONTHS[month - 1] as string;
  const sameYear = year === parseIsoDate(reference).year;
  return sameYear ? `${String(date)} ${name}` : `${String(date)} ${name} ${String(year)}`;
}

/**
 * Nagłówek widoku dnia. „Dziś" i „wczoraj" mają pierwszeństwo przed datą —
 * to one padają w rozmowie o treningu.
 */
export function formatDayTitle(day: IsoDate, today: IsoDate): string {
  if (day === today) return 'Today';
  if (day === addDays(today, -1)) return 'Yesterday';
  if (day === addDays(today, 1)) return 'Tomorrow';
  return `${capitalize(weekdayOf(day))}, ${formatDate(day, today)}`;
}

/** Podtytuł — pełna data także wtedy, gdy tytuł mówi „Dziś". */
export function formatDaySubtitle(day: IsoDate, today: IsoDate): string {
  return `${capitalize(weekdayOf(day))}, ${formatDate(day, today)}`;
}

/**
 * „13.08" — podpis pod słupkiem wykresu. Same cyfry dnia miesiąca („13") w
 * wąskiej kolumnie obok liczby wyglądały jak kolejna wartość, nie jak data —
 * kropka i miesiąc jednoznacznie mówią, że to dzień.
 */
export function formatShortDate(day: IsoDate): string {
  const { month, day: date } = parseIsoDate(day);
  return `${String(date).padStart(2, '0')}.${String(month).padStart(2, '0')}`;
}

export function today(now: Date = new Date()): IsoDate {
  return toIsoDate(now);
}

export function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** Singular/plural of "set" — used by both the day view and the calendar. */
export function setsPlural(count: number): string {
  return count === 1 ? 'set' : 'sets';
}
