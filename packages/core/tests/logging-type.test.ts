import { describe, expect, it } from 'vitest';
import {
  hasCompleteMeasurements,
  isLoggingType,
  LOGGING_TYPES,
  recordAxes,
  requiredMeasurements,
  usesBodyweight,
} from '../src/logging-type.js';
import { makeSet } from './helpers.js';

describe('typy logowania', () => {
  it('obejmują wszystkie pięć wariantów ze specyfikacji', () => {
    expect(LOGGING_TYPES).toEqual([
      'weight_reps',
      'weight_time',
      'bodyweight_reps',
      'bodyweight_time',
      'distance_time',
    ]);
  });

  it('każdy ma co najmniej jedną oś rekordu', () => {
    for (const loggingType of LOGGING_TYPES) {
      expect(recordAxes(loggingType).length).toBeGreaterThan(0);
    }
  });

  it('masa ciała nie jest osią rekordu w żadnym typie', () => {
    for (const loggingType of LOGGING_TYPES) {
      expect(recordAxes(loggingType)).not.toContain('bodyweightG');
    }
  });

  it('masa ciała jest zapisywana tylko przy typach opartych o masę ciała', () => {
    expect(usesBodyweight('bodyweight_reps')).toBe(true);
    expect(usesBodyweight('bodyweight_time')).toBe(true);
    expect(usesBodyweight('weight_reps')).toBe(false);
    expect(usesBodyweight('distance_time')).toBe(false);
  });

  it('isLoggingType odrzuca wartości spoza listy', () => {
    expect(isLoggingType('weight_reps')).toBe(true);
    expect(isLoggingType('weight_distance')).toBe(false);
    expect(isLoggingType(null)).toBe(false);
  });
});

describe('hasCompleteMeasurements', () => {
  it('wymaga wszystkich pól typu logowania', () => {
    expect(hasCompleteMeasurements('weight_reps', makeSet({ weightG: 80_000, reps: 5 }))).toBe(
      true,
    );
    expect(hasCompleteMeasurements('weight_reps', makeSet({ weightG: 80_000 }))).toBe(false);
    expect(hasCompleteMeasurements('weight_reps', makeSet({ reps: 5 }))).toBe(false);
  });

  it('dopuszcza zerowy ciężar, ale nie zerowy czas, dystans ani powtórzenia', () => {
    expect(hasCompleteMeasurements('weight_reps', makeSet({ weightG: 0, reps: 5 }))).toBe(true);
    expect(hasCompleteMeasurements('bodyweight_reps', makeSet({ reps: 0 }))).toBe(false);
    expect(hasCompleteMeasurements('bodyweight_time', makeSet({ durationS: 0 }))).toBe(false);
    expect(hasCompleteMeasurements('distance_time', makeSet({ distanceM: 0, durationS: 10 }))).toBe(
      false,
    );
  });

  it('odrzuca wartości niecałkowite', () => {
    expect(hasCompleteMeasurements('weight_reps', makeSet({ weightG: 80_000.5, reps: 5 }))).toBe(
      false,
    );
  });

  it('pola wymagane pokrywają się z osiami rekordu', () => {
    for (const loggingType of LOGGING_TYPES) {
      expect(requiredMeasurements(loggingType)).toEqual(recordAxes(loggingType));
    }
  });
});
