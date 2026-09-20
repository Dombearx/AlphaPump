/**
 * Kolejność listy ćwiczeń zapisana na urządzeniu.
 *
 * Ta sama reguła odporności co przy języku i przy dyktowaniu: rejestr
 * uszkodzony, pusty albo z wartością, której nie znamy, ma dawać kolejność
 * domyślną, a nie błąd. Utrata tego ustawienia kosztuje jedno stuknięcie,
 * a wyjątek przy wejściu na ekran kosztuje zapisanie serii.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_EXERCISE_ORDER,
  parseExerciseOrder,
  serializeExerciseOrder,
} from '../src/exercise-order/state';

describe('rejestr kolejności ćwiczeń', () => {
  it('domyślnie podpowiada, co wykonać', () => {
    expect(DEFAULT_EXERCISE_ORDER).toBe('rotation');
  });

  it('czyta zapisany wybór', () => {
    expect(parseExerciseOrder(serializeExerciseOrder('usage'))).toBe('usage');
    expect(parseExerciseOrder(serializeExerciseOrder('rotation'))).toBe('rotation');
  });

  it('nieczytelny rejestr znaczy kolejność domyślną', () => {
    expect(parseExerciseOrder('to nie jest JSON')).toBe(DEFAULT_EXERCISE_ORDER);
  });

  it('nieznana wartość znaczy kolejność domyślną', () => {
    expect(parseExerciseOrder(JSON.stringify({ order: 'losowo' }))).toBe(DEFAULT_EXERCISE_ORDER);
    expect(parseExerciseOrder(JSON.stringify({}))).toBe(DEFAULT_EXERCISE_ORDER);
  });
});
