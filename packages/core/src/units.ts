/**
 * Jednostki.
 *
 * Wszystkie wartości pomiarowe przechowywane są jako liczby **całkowite**:
 * ciężar w gramach, czas w sekundach, dystans w metrach. Powód jest jeden i
 * twardy: front Pareto porównuje wartości na równość, a na liczbach
 * zmiennoprzecinkowych `80.0 kg !== 80.0 kg` potrafi być prawdą. Dokładny remis
 * — który zgodnie ze specyfikacją nie pokazuje komunikatu o rekordzie —
 * zaczynałby wtedy losowo wyskakiwać jako rekord.
 *
 * Konwersje na jednostki „ludzkie" należą wyłącznie do warstwy prezentacji.
 */

/** Ciężar w gramach (liczba całkowita). */
export type Grams = number;

/** Czas w sekundach (liczba całkowita). */
export type Seconds = number;

/** Dystans w metrach (liczba całkowita). */
export type Meters = number;

export const GRAMS_IN_KILOGRAM = 1000;
export const METERS_IN_KILOMETER = 1000;
export const SECONDS_IN_MINUTE = 60;
export const SECONDS_IN_HOUR = 3600;

/** Zaokrągla do liczby całkowitej — połówki w górę, symetrycznie dla ujemnych. */
function roundToInteger(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function kilogramsToGrams(kilograms: number): Grams {
  return roundToInteger(kilograms * GRAMS_IN_KILOGRAM);
}

export function gramsToKilograms(grams: Grams): number {
  return grams / GRAMS_IN_KILOGRAM;
}

export function kilometersToMeters(kilometers: number): Meters {
  return roundToInteger(kilometers * METERS_IN_KILOMETER);
}

export function metersToKilometers(meters: Meters): number {
  return meters / METERS_IN_KILOMETER;
}

export function minutesToSeconds(minutes: number): Seconds {
  return roundToInteger(minutes * SECONDS_IN_MINUTE);
}

export function secondsToMinutes(seconds: Seconds): number {
  return seconds / SECONDS_IN_MINUTE;
}

export interface DurationParts {
  hours: number;
  minutes: number;
  seconds: number;
}

export function durationToSeconds({ hours, minutes, seconds }: DurationParts): Seconds {
  return hours * SECONDS_IN_HOUR + minutes * SECONDS_IN_MINUTE + seconds;
}

export function secondsToDuration(total: Seconds): DurationParts {
  const abs = Math.abs(total);
  return {
    hours: Math.floor(abs / SECONDS_IN_HOUR),
    minutes: Math.floor((abs % SECONDS_IN_HOUR) / SECONDS_IN_MINUTE),
    seconds: abs % SECONDS_IN_MINUTE,
  };
}

export function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

export function isNonNegativeInteger(value: unknown): value is number {
  return isInteger(value) && value >= 0;
}

export function isPositiveInteger(value: unknown): value is number {
  return isInteger(value) && value > 0;
}
