/**
 * Pomiary między bazą a klawiaturą.
 *
 * Baza trzyma liczby całkowite — gramy, sekundy, metry — bo front Pareto
 * porównuje wartości na równość, a na liczbach zmiennoprzecinkowych remis
 * potrafi przestać być remisem. Użytkownik wpisuje jednak kilogramy i czas
 * w postaci `mm:ss`, więc gdzieś musi stać granica między jednym a drugim.
 * Stoi tutaj i tylko tutaj.
 *
 * Wszystko w tym module jest czyste: żadnych komponentów, żadnej bazy. To ta
 * warstwa, którą da się przetestować uczciwie, bez renderowania czegokolwiek.
 */

import {
  gramsToKilograms,
  kilogramsToGrams,
  requiredMeasurements,
  secondsToDuration,
  usesBodyweight,
  type LoggingType,
  type MeasurementKey,
  type SetMeasurements,
} from '@alphapump/core';

/** Sposób, w jaki pole jest wpisywane i pokazywane. */
export type MeasurementKind = 'weight' | 'reps' | 'duration' | 'distance';

export interface MeasurementField {
  key: MeasurementKey | 'bodyweightG';
  kind: MeasurementKind;
  label: string;
  unit: string;
  /** Podpowiedź formatu — pokazywana w pustym polu. */
  placeholder: string;
}

const FIELDS: Readonly<Record<MeasurementKey, MeasurementField>> = {
  weightG: { key: 'weightG', kind: 'weight', label: 'Ciężar', unit: 'kg', placeholder: '0' },
  reps: { key: 'reps', kind: 'reps', label: 'Powtórzenia', unit: '×', placeholder: '0' },
  durationS: { key: 'durationS', kind: 'duration', label: 'Czas', unit: '', placeholder: 'mm:ss' },
  distanceM: { key: 'distanceM', kind: 'distance', label: 'Dystans', unit: 'm', placeholder: '0' },
};

const BODYWEIGHT_FIELD: MeasurementField = {
  key: 'bodyweightG',
  kind: 'weight',
  label: 'Masa ciała',
  unit: 'kg',
  placeholder: 'opcjonalnie',
};

/**
 * Pola formularza dla danego typu logowania — w kolejności wpisywania.
 *
 * Masa ciała idzie na koniec i tylko tam, gdzie ma sens. Jest zapisywana, ale
 * nie bierze udziału w liczeniu rekordów, więc nie może stać przed polami,
 * które o rekordzie decydują.
 */
export function fieldsFor(loggingType: LoggingType): MeasurementField[] {
  const fields = requiredMeasurements(loggingType).map((key) => FIELDS[key]);
  return usesBodyweight(loggingType) ? [...fields, BODYWEIGHT_FIELD] : fields;
}

/* ------------------------------------------------------------------- odczyt */

/**
 * Liczba dziesiętna po polsku, bez ogona zer: `82.5` → `82,5`, `80` → `80`.
 *
 * Zera na końcu nie są kosmetyką — pole formularza wypełniane tą samą funkcją
 * pokazywałoby „82,50" tam, gdzie użytkownik wpisał „82,5".
 */
function decimal(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(3).replace(/0+$/, '').replace(/\.$/, '').replace('.', ',');
}

/** `9000` → `9`, `9500` → `9,5`. Przecinek, bo aplikacja mówi po polsku. */
export function formatWeight(grams: number): string {
  return decimal(gramsToKilograms(grams));
}

/** `95` → `1:35`, `3725` → `1:02:05`. Sekundy zawsze dwucyfrowe. */
export function formatDuration(seconds: number): string {
  const { hours, minutes, seconds: rest } = secondsToDuration(seconds);
  const padded = String(rest).padStart(2, '0');
  if (hours === 0) return `${minutes}:${padded}`;
  return `${hours}:${String(minutes).padStart(2, '0')}:${padded}`;
}

/** `800` → `800 m`, `5000` → `5 km`. */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${String(meters)} m`;
  return `${decimal(meters / 1000)} km`;
}

/** Wartość jednego pola w postaci gotowej do pokazania. */
export function formatValue(kind: MeasurementKind, value: number): string {
  switch (kind) {
    case 'weight':
      return formatWeight(value);
    case 'duration':
      return formatDuration(value);
    case 'distance':
      return String(value);
    case 'reps':
      return String(value);
  }
}

/**
 * Seria jednym napisem — tak, jak wygląda na liście dnia.
 *
 * Format zależy od typu logowania, bo „80 kg × 8" i „5 km w 25:00" to dwa różne
 * zdania o dwóch różnych rzeczach.
 */
export function formatSet(loggingType: LoggingType, measurements: SetMeasurements): string {
  const { weightG, reps, durationS, distanceM } = measurements;

  switch (loggingType) {
    case 'weight_reps':
      return `${formatWeight(weightG ?? 0)} kg × ${reps ?? 0}`;
    case 'weight_time':
      return `${formatWeight(weightG ?? 0)} kg × ${formatDuration(durationS ?? 0)}`;
    case 'bodyweight_reps':
      return `× ${reps ?? 0}`;
    case 'bodyweight_time':
      return formatDuration(durationS ?? 0);
    case 'distance_time':
      return `${formatDistance(distanceM ?? 0)} w ${formatDuration(durationS ?? 0)}`;
  }
}

/* ---------------------------------------------------------------- wpisywanie */

/**
 * Liczba wpisana ręcznie. Przecinek i kropka znaczą to samo — klawiatura
 * numeryczna daje raz jedno, raz drugie, zależnie od systemu i ustawień.
 */
function toNumber(text: string): number | null {
  const normalized = text.trim().replace(',', '.');
  if (normalized.length === 0) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export function parseWeight(text: string): number | null {
  const kilograms = toNumber(text);
  if (kilograms === null || kilograms < 0) return null;
  return kilogramsToGrams(kilograms);
}

export function parseCount(text: string): number | null {
  const value = toNumber(text);
  if (value === null || !Number.isInteger(value) || value <= 0) return null;
  return value;
}

export function parseDistance(text: string): number | null {
  const value = toNumber(text);
  if (value === null || value <= 0) return null;
  return Math.round(value);
}

/**
 * Czas wpisany jako `mm:ss`, `h:mm:ss` albo same sekundy.
 *
 * Samą liczbę czytamy jako sekundy, a nie minuty: przy ćwiczeniach na czas
 * (deska, zwis) mowa zwykle o kilkudziesięciu sekundach, więc „45" znaczy „45
 * sekund". Kto ma na myśli minuty, wpisze `1:30`.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;

  if (!trimmed.includes(':')) {
    const seconds = toNumber(trimmed);
    if (seconds === null || seconds <= 0) return null;
    return Math.round(seconds);
  }

  const parts = trimmed.split(':');
  if (parts.length > 3) return null;

  let total = 0;
  for (const part of parts) {
    const value = toNumber(part);
    if (value === null || value < 0 || !Number.isInteger(value)) return null;
    total = total * 60 + value;
  }

  return total > 0 ? total : null;
}

/** Wartość jednego pola z formularza. `null` znaczy „puste albo niepoprawne". */
export function parseValue(kind: MeasurementKind, text: string): number | null {
  switch (kind) {
    case 'weight':
      return parseWeight(text);
    case 'duration':
      return parseDuration(text);
    case 'distance':
      return parseDistance(text);
    case 'reps':
      return parseCount(text);
  }
}

/** Klawiatura pasująca do pola — czas i ciężar potrzebują znaków spoza cyfr. */
export function keyboardFor(
  kind: MeasurementKind,
): 'numeric' | 'decimal-pad' | 'numbers-and-punctuation' {
  switch (kind) {
    case 'weight':
      return 'decimal-pad';
    case 'duration':
      return 'numbers-and-punctuation';
    default:
      return 'numeric';
  }
}
