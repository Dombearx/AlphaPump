/**
 * Typy logowania serii i osie, na których liczone są rekordy.
 *
 * Typ logowania jest ustalany przy tworzeniu ćwiczenia i nigdy się nie zmienia —
 * inaczej historyczne serie przestałyby pasować do własnego ćwiczenia.
 */

export const LOGGING_TYPES = [
  /** ciężar + powtórzenia */
  'weight_reps',
  /** ciężar + czas */
  'weight_time',
  /** masa ciała + powtórzenia */
  'bodyweight_reps',
  /** masa ciała + czas */
  'bodyweight_time',
  /** dystans + czas */
  'distance_time',
] as const;

export type LoggingType = (typeof LOGGING_TYPES)[number];

/** Pola pomiarowe serii. */
export const MEASUREMENT_KEYS = ['weightG', 'reps', 'durationS', 'distanceM'] as const;

export type MeasurementKey = (typeof MEASUREMENT_KEYS)[number];

/** Zestaw pomiarów serii; `null` oznacza „nie dotyczy tego typu logowania". */
export type SetMeasurements = Readonly<Record<MeasurementKey, number | null>>;

/**
 * Osie frontu Pareto dla danego typu logowania. **Każda oś jest maksymalizowana**
 * — cięższy, dłuższy, dalszy i na więcej powtórzeń jest zawsze lepszy.
 *
 * Masa ciała zapisana przy serii świadomie nie jest osią: specyfikacja mówi
 * wprost, że nie bierze udziału w liczeniu rekordów.
 */
const RECORD_AXES: Readonly<Record<LoggingType, readonly MeasurementKey[]>> = {
  weight_reps: ['weightG', 'reps'],
  weight_time: ['weightG', 'durationS'],
  bodyweight_reps: ['reps'],
  bodyweight_time: ['durationS'],
  distance_time: ['distanceM', 'durationS'],
};

export function recordAxes(loggingType: LoggingType): readonly MeasurementKey[] {
  return RECORD_AXES[loggingType];
}

/**
 * Pola, które użytkownik wypełnia dla danego typu logowania. Różnią się od osi
 * rekordu wyłącznie o masę ciała — ta jest zapisywana, ale nie punktowana.
 */
const REQUIRED_MEASUREMENTS: Readonly<Record<LoggingType, readonly MeasurementKey[]>> = RECORD_AXES;

export function requiredMeasurements(loggingType: LoggingType): readonly MeasurementKey[] {
  return REQUIRED_MEASUREMENTS[loggingType];
}

/** Czy przy tym typie logowania ma sens zapisywanie masy ciała użytkownika. */
export function usesBodyweight(loggingType: LoggingType): boolean {
  return loggingType === 'bodyweight_reps' || loggingType === 'bodyweight_time';
}

export function isLoggingType(value: unknown): value is LoggingType {
  return typeof value === 'string' && (LOGGING_TYPES as readonly string[]).includes(value);
}

/**
 * Czy pomiary serii są kompletne dla danego typu logowania — to znaczy czy
 * wszystkie wymagane pola są dodatnimi liczbami całkowitymi.
 *
 * Ciężar może być zerowy (gryf bez obciążenia, ćwiczenie z własną masą
 * zapisywane jako `weight_reps` z zerem), pozostałe osie muszą być dodatnie.
 */
export function hasCompleteMeasurements(
  loggingType: LoggingType,
  measurements: SetMeasurements,
): boolean {
  return requiredMeasurements(loggingType).every((key) => {
    const value = measurements[key];
    if (value === null || !Number.isInteger(value)) return false;
    return key === 'weightG' ? value >= 0 : value > 0;
  });
}
