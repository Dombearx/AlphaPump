/**
 * Zmiana dnia przesunięciem palca.
 *
 * Trzy rzeczy muszą się tu zgadzać. Kierunek — bo pomylony znak daje nawigację
 * odwrotną do kalendarza i każdy inny gest w telefonie. Przewaga poziomu nad
 * pionem — bo bez niej przewijanie listy serii kończyłoby się skokiem na inny
 * dzień. I granica dnia bieżącego — swipe nie może wpuszczać tam, gdzie
 * strzałka „›" jest wyszarzona.
 */

import { describe, expect, it } from 'vitest';
import {
  SWIPE_CAPTURE_DISTANCE,
  SWIPE_COMMIT_DISTANCE,
  shouldCaptureSwipe,
  swipeTargetDay,
} from '../src/day-swipe';

const TODAY = '2026-08-20';

describe('swipeTargetDay', () => {
  it('przesunięcie w lewo daje dzień następny', () => {
    expect(swipeTargetDay('2026-08-18', TODAY, { dx: -120, dy: 0 })).toBe('2026-08-19');
  });

  it('przesunięcie w prawo daje dzień poprzedni', () => {
    expect(swipeTargetDay('2026-08-18', TODAY, { dx: 120, dy: 0 })).toBe('2026-08-17');
  });

  it('z dnia bieżącego nie da się przesunąć w przyszłość', () => {
    expect(swipeTargetDay(TODAY, TODAY, { dx: -120, dy: 0 })).toBeNull();
    expect(swipeTargetDay(TODAY, TODAY, { dx: 120, dy: 0 })).toBe('2026-08-19');
  });

  it('wstecz działa też przez granicę miesiąca', () => {
    expect(swipeTargetDay('2026-08-01', TODAY, { dx: 120, dy: 0 })).toBe('2026-07-31');
  });

  it('krótkie omsknięcie palca nie zmienia dnia', () => {
    expect(
      swipeTargetDay('2026-08-18', TODAY, { dx: -(SWIPE_COMMIT_DISTANCE - 1), dy: 0 }),
    ).toBeNull();
    expect(swipeTargetDay('2026-08-18', TODAY, { dx: -SWIPE_COMMIT_DISTANCE, dy: 0 })).toBe(
      '2026-08-19',
    );
  });

  it('ruch w pionie zostaje przewijaniem listy', () => {
    expect(swipeTargetDay('2026-08-18', TODAY, { dx: -120, dy: 200 })).toBeNull();
    expect(swipeTargetDay('2026-08-18', TODAY, { dx: 0, dy: -200 })).toBeNull();
  });
});

describe('shouldCaptureSwipe', () => {
  it('odbiera gest liście dopiero po wyraźnym ruchu w bok', () => {
    expect(shouldCaptureSwipe({ dx: SWIPE_CAPTURE_DISTANCE - 1, dy: 0 })).toBe(false);
    expect(shouldCaptureSwipe({ dx: SWIPE_CAPTURE_DISTANCE, dy: 0 })).toBe(true);
    expect(shouldCaptureSwipe({ dx: -SWIPE_CAPTURE_DISTANCE, dy: 0 })).toBe(true);
  });

  it('nie odbiera przewijania w pionie ani ruchu na ukos', () => {
    expect(shouldCaptureSwipe({ dx: 0, dy: 40 })).toBe(false);
    expect(shouldCaptureSwipe({ dx: 30, dy: 25 })).toBe(false);
  });

  it('odbiera wcześniej, niż zmienia dzień — inaczej przesunięcie zaczynałoby się szarpnięciem', () => {
    expect(SWIPE_CAPTURE_DISTANCE).toBeLessThan(SWIPE_COMMIT_DISTANCE);
  });
});
