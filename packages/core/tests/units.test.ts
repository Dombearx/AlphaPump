import { describe, expect, it } from 'vitest';
import {
  durationToSeconds,
  gramsToKilograms,
  isNonNegativeInteger,
  isPositiveInteger,
  kilogramsToGrams,
  kilometersToMeters,
  metersToKilometers,
  minutesToSeconds,
  secondsToDuration,
  secondsToMinutes,
} from '../src/units.js';

describe('konwersje ciężaru', () => {
  it('zamieniają kilogramy na całkowitą liczbę gramów', () => {
    expect(kilogramsToGrams(80)).toBe(80_000);
    expect(kilogramsToGrams(82.5)).toBe(82_500);
    expect(kilogramsToGrams(0.1)).toBe(100);
  });

  it('nie zostawiają śladów arytmetyki zmiennoprzecinkowej', () => {
    expect(Number.isInteger(kilogramsToGrams(0.1 + 0.2))).toBe(true);
    expect(kilogramsToGrams(0.1 + 0.2)).toBe(300);
  });

  it('dwie drogi do tej samej wartości dają identyczny wynik — kluczowe dla remisów', () => {
    expect(kilogramsToGrams(80)).toBe(kilogramsToGrams(79.9999));
    expect(kilogramsToGrams(2.5 * 32)).toBe(kilogramsToGrams(80));
  });

  it('wracają do kilogramów', () => {
    expect(gramsToKilograms(82_500)).toBe(82.5);
  });
});

describe('konwersje dystansu i czasu', () => {
  it('zamieniają kilometry na metry i z powrotem', () => {
    expect(kilometersToMeters(10)).toBe(10_000);
    expect(kilometersToMeters(1.5)).toBe(1500);
    expect(metersToKilometers(2500)).toBe(2.5);
  });

  it('zamieniają minuty na sekundy i z powrotem', () => {
    expect(minutesToSeconds(1.5)).toBe(90);
    expect(secondsToMinutes(90)).toBe(1.5);
  });

  it('składają i rozkładają czas na godziny, minuty i sekundy', () => {
    expect(durationToSeconds({ hours: 1, minutes: 5, seconds: 3 })).toBe(3903);
    expect(secondsToDuration(3903)).toEqual({ hours: 1, minutes: 5, seconds: 3 });
    expect(secondsToDuration(59)).toEqual({ hours: 0, minutes: 0, seconds: 59 });
  });
});

describe('predykaty całkowitości', () => {
  it('rozpoznają liczby całkowite nieujemne i dodatnie', () => {
    expect(isNonNegativeInteger(0)).toBe(true);
    expect(isPositiveInteger(0)).toBe(false);
    expect(isPositiveInteger(1)).toBe(true);
    expect(isNonNegativeInteger(-1)).toBe(false);
    expect(isNonNegativeInteger(1.5)).toBe(false);
    expect(isNonNegativeInteger('10')).toBe(false);
    expect(isNonNegativeInteger(Number.NaN)).toBe(false);
  });
});
