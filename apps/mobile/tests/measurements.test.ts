/**
 * Granica między klawiaturą a bazą.
 *
 * Baza trzyma liczby całkowite, użytkownik wpisuje kilogramy i `mm:ss`.
 * Pomyłka w tym miejscu jest cicha: seria zapisuje się, tylko z wartością
 * mniejszą tysiąc razy.
 */

import { describe, expect, it } from 'vitest';
import {
  fieldsFor,
  formatDistance,
  formatDuration,
  formatSet,
  formatWeight,
  parseCount,
  parseDistance,
  parseDuration,
  parseWeight,
} from '../src/measurements';

describe('pola formularza', () => {
  it('pyta dokładnie o to, czego wymaga typ logowania', () => {
    expect(fieldsFor('weight_reps').map((field) => field.key)).toEqual(['weightG', 'reps']);
    expect(fieldsFor('distance_time').map((field) => field.key)).toEqual([
      'distanceM',
      'durationS',
    ]);
  });

  it('o masę ciała pyta tylko przy ćwiczeniach na masę ciała', () => {
    expect(fieldsFor('bodyweight_reps').map((field) => field.key)).toEqual(['reps', 'bodyweightG']);
    expect(fieldsFor('weight_reps').map((field) => field.key)).not.toContain('bodyweightG');
  });
});

describe('wpisywanie ciężaru', () => {
  it('zamienia kilogramy na gramy', () => {
    expect(parseWeight('80')).toBe(80_000);
    expect(parseWeight('82.5')).toBe(82_500);
  });

  it('przecinek znaczy to samo co kropka', () => {
    // Klawiatura numeryczna daje raz jedno, raz drugie — zależnie od systemu.
    expect(parseWeight('82,5')).toBe(82_500);
  });

  it('przepuszcza zero, bo goły gryf też jest ciężarem', () => {
    expect(parseWeight('0')).toBe(0);
  });

  it('odrzuca puste i bezsensowne', () => {
    expect(parseWeight('')).toBeNull();
    expect(parseWeight('dużo')).toBeNull();
    expect(parseWeight('-5')).toBeNull();
  });
});

describe('wpisywanie czasu', () => {
  it('samą liczbę czyta jako sekundy', () => {
    // Przy desce czy zwisie mowa o kilkudziesięciu sekundach, nie minutach.
    expect(parseDuration('45')).toBe(45);
  });

  it('czyta zapis minutowy i godzinowy', () => {
    expect(parseDuration('1:30')).toBe(90);
    expect(parseDuration('12:00')).toBe(720);
    expect(parseDuration('1:02:05')).toBe(3725);
  });

  it('odrzuca zapis, którego nie umie przeczytać', () => {
    expect(parseDuration('')).toBeNull();
    expect(parseDuration('1:2:3:4')).toBeNull();
    expect(parseDuration('0')).toBeNull();
  });

  it('pokazuje czas z sekundami zawsze dwucyfrowo', () => {
    expect(formatDuration(95)).toBe('1:35');
    expect(formatDuration(65)).toBe('1:05');
    expect(formatDuration(3725)).toBe('1:02:05');
  });

  it('to, co pokazuje, umie odczytać z powrotem', () => {
    for (const seconds of [5, 45, 90, 605, 3725]) {
      expect(parseDuration(formatDuration(seconds))).toBe(seconds);
    }
  });
});

describe('pozostałe pola', () => {
  it('powtórzenia muszą być dodatnią liczbą całkowitą', () => {
    expect(parseCount('8')).toBe(8);
    expect(parseCount('0')).toBeNull();
    expect(parseCount('8.5')).toBeNull();
  });

  it('dystans jest w metrach', () => {
    expect(parseDistance('1500')).toBe(1500);
    expect(formatDistance(800)).toBe('800 m');
    expect(formatDistance(5000)).toBe('5 km');
  });

  it('ciężar pokazuje się w kilogramach, po polsku', () => {
    expect(formatWeight(80_000)).toBe('80');
    expect(formatWeight(82_500)).toBe('82.5');
  });
});

describe('seria jednym napisem', () => {
  const measurements = { weightG: 80_000, reps: 8, durationS: 90, distanceM: 5000 };

  it('mówi to, co ma sens dla typu logowania', () => {
    expect(formatSet('weight_reps', { ...measurements, durationS: null, distanceM: null })).toBe(
      '80 kg × 8',
    );
    expect(formatSet('bodyweight_reps', { ...measurements, weightG: null })).toBe('× 8');
    expect(formatSet('bodyweight_time', measurements)).toBe('1:30');
    expect(formatSet('distance_time', { ...measurements, weightG: null, reps: null })).toBe(
      '5 km in 1:30',
    );
  });
});
