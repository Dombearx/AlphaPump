/**
 * Masa ciała z ustawień — reguły czytania i zapisu rejestru.
 *
 * Sprawdzamy dokładnie to, co rozstrzyga się poza ekranem: że wpisana masa staje
 * się gramami (tak jak każdy inny ciężar w bazie), że bzdura nie ma jak wejść do
 * formularza kolejnych serii i że uszkodzony rejestr znaczy „brak ustawienia",
 * a nie błąd odczytu.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BODYWEIGHT_G,
  parseBodyweight,
  parseBodyweightInput,
  serializeBodyweight,
} from '../src/bodyweight/state';

describe('masa ciała wpisana w ustawieniach', () => {
  it('zamienia kilogramy na gramy', () => {
    expect(parseBodyweightInput('80')).toBe(80_000);
    // Przecinek i kropka znaczą to samo — klawiatura numeryczna daje raz jedno,
    // raz drugie.
    expect(parseBodyweightInput('80,5')).toBe(80_500);
  });

  it('odrzuca to, czego nie da się podstawić do serii', () => {
    expect(parseBodyweightInput('')).toBeNull();
    expect(parseBodyweightInput('ciężko')).toBeNull();
    expect(parseBodyweightInput('0')).toBeNull();
    expect(parseBodyweightInput('-80')).toBeNull();
  });

  it('odrzuca masę spoza zakresu, bo literówka wchodziłaby do każdej serii', () => {
    expect(parseBodyweightInput('800')).toBeNull();
    expect(parseBodyweightInput('500')).toBe(MAX_BODYWEIGHT_G);
  });
});

describe('rejestr masy ciała', () => {
  it('czyta to, co zapisał', () => {
    expect(parseBodyweight(serializeBodyweight(78_000))).toBe(78_000);
    expect(parseBodyweight(serializeBodyweight(null))).toBeNull();
  });

  it('uszkodzony rejestr znaczy brak ustawienia, a nie błąd', () => {
    expect(parseBodyweight('{')).toBeNull();
    expect(parseBodyweight('{"bodyweightG":"osiemdziesiąt"}')).toBeNull();
    expect(parseBodyweight('{"bodyweightG":80.5}')).toBeNull();
    expect(parseBodyweight('{}')).toBeNull();
  });
});
