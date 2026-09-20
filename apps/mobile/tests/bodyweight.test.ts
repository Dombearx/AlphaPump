/**
 * Masa ciała z ustawień — reguły czytania i zapisu rejestru.
 *
 * Sprawdzamy dokładnie to, co rozstrzyga się poza ekranem: że wpisana masa staje
 * się gramami (tak jak każdy inny ciężar w bazie), że bzdura nie ma jak wejść do
 * formularza kolejnych serii, że historia trzyma po jednym pomiarze na dzień
 * i oddaje najświeższy jako masę aktualną, i że uszkodzony rejestr znaczy „brak
 * ustawienia", a nie błąd odczytu.
 */

import { describe, expect, it } from 'vitest';
import {
  MAX_BODYWEIGHT_G,
  currentBodyweight,
  parseBodyweightHistory,
  parseBodyweightInput,
  recordBodyweight,
  serializeBodyweightHistory,
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

describe('historia masy ciała', () => {
  const may = { on: '2026-05-04', bodyweightG: 82_000 };
  const june = { on: '2026-06-01', bodyweightG: 80_000 };

  it('masą aktualną jest najświeższy pomiar, a nie ostatnio dopisany', () => {
    // Rejestr z dysku bywa w dowolnej kolejności — o tym, co wchodzi do serii,
    // rozstrzyga data, a nie miejsce na liście.
    expect(currentBodyweight([may, june])).toBe(80_000);
    expect(currentBodyweight([])).toBeNull();
  });

  it('dopisuje pomiar i układa historię od najnowszego', () => {
    const history = recordBodyweight([may, june], 78_500, '2026-07-02');

    expect(history).toEqual([{ on: '2026-07-02', bodyweightG: 78_500 }, june, may]);
    expect(currentBodyweight(history)).toBe(78_500);
  });

  it('jeden dzień to jeden pomiar — poprawka zastępuje, a nie dopisuje', () => {
    // Literówka poprawiona minutę później nie jest zmianą masy ciała i nie ma
    // prawa stać w historii jako druga.
    const history = recordBodyweight([june], 79_000, '2026-06-01');

    expect(history).toEqual([{ on: '2026-06-01', bodyweightG: 79_000 }]);
  });
});

describe('rejestr masy ciała', () => {
  const history = [
    { on: '2026-06-01', bodyweightG: 80_000 },
    { on: '2026-05-04', bodyweightG: 82_000 },
  ];

  it('czyta to, co zapisał', () => {
    expect(parseBodyweightHistory(serializeBodyweightHistory(history))).toEqual(history);
    expect(parseBodyweightHistory(serializeBodyweightHistory([]))).toEqual([]);
  });

  it('uszkodzony rejestr znaczy brak ustawienia, a nie błąd', () => {
    expect(parseBodyweightHistory('{')).toEqual([]);
    expect(parseBodyweightHistory('{}')).toEqual([]);
    expect(parseBodyweightHistory('{"entries":"osiemdziesiąt"}')).toEqual([]);
  });

  it('wyrzuca pojedyncze uszkodzone wpisy, a resztę historii zostawia', () => {
    const raw = JSON.stringify({
      entries: [
        { on: '2026-06-01', bodyweightG: 80_000 },
        { on: '2026-05-04', bodyweightG: 82.5 },
        { on: 'wiosną', bodyweightG: 82_000 },
        { on: '2026-04-01', bodyweightG: 800_000 },
      ],
    });

    expect(parseBodyweightHistory(raw)).toEqual([{ on: '2026-06-01', bodyweightG: 80_000 }]);
  });
});
