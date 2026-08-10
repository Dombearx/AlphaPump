/**
 * Dzień treningowy.
 *
 * Dzień jest kalendarzowy i **bez strefy czasowej** — trzymamy go jako
 * `YYYY-MM-DD`, osobno od znacznika czasu utworzenia rekordu. Inaczej seria
 * zapisana o 23:00 podczas wyjazdu wylądowałaby po synchronizacji w innym dniu
 * niż ten, w którym użytkownik ją wykonał.
 *
 * Porównania dat sprowadzają się dzięki temu do porównania napisów — format
 * `YYYY-MM-DD` jest leksykograficznie zgodny z porządkiem chronologicznym.
 */

/** Dzień kalendarzowy w formacie `YYYY-MM-DD`. */
export type IsoDate = string;

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Sprawdza format oraz to, czy data faktycznie istnieje (odrzuca `2026-02-30`). */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) return false;

  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1) return false;

  return day <= daysInMonth(year, month);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Zamienia `Date` na dzień kalendarzowy **w czasie lokalnym urządzenia** —
 * to dzień, który użytkownik widzi na zegarku, gdy zapisuje serię.
 */
export function toIsoDate(date: Date): IsoDate {
  const year = String(date.getFullYear()).padStart(4, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Rozkłada dzień na składowe; rzuca dla wartości spoza formatu. */
export function parseIsoDate(value: IsoDate): { year: number; month: number; day: number } {
  if (!isIsoDate(value)) throw new RangeError(`Niepoprawny dzień: ${value}`);
  return {
    year: Number(value.slice(0, 4)),
    month: Number(value.slice(5, 7)),
    day: Number(value.slice(8, 10)),
  };
}

export function addDays(value: IsoDate, days: number): IsoDate {
  const { year, month, day } = parseIsoDate(value);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const shiftedYear = String(shifted.getUTCFullYear()).padStart(4, '0');
  const shiftedMonth = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const shiftedDay = String(shifted.getUTCDate()).padStart(2, '0');
  return `${shiftedYear}-${shiftedMonth}-${shiftedDay}`;
}

/** Zwraca ujemną liczbę, zero lub dodatnią — jak komparator `Array#sort`. */
export function compareIsoDates(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Zakres domknięty obustronnie; `null` w `to` oznacza brak końca. */
export function isWithinRange(day: IsoDate, from: IsoDate, to: IsoDate | null): boolean {
  if (day < from) return false;
  return to === null || day <= to;
}

export function differenceInDays(from: IsoDate, to: IsoDate): number {
  const a = parseIsoDate(from);
  const b = parseIsoDate(to);
  const start = Date.UTC(a.year, a.month - 1, a.day);
  const end = Date.UTC(b.year, b.month - 1, b.day);
  return Math.round((end - start) / 86_400_000);
}
