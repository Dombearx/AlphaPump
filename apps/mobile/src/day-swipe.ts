/**
 * Zmiana dnia przesunięciem palca po widoku dnia.
 *
 * Kierunek jest taki, jak w kalendarzu i w każdej galerii zdjęć: przesunięcie
 * **w lewo** wysuwa bieżący dzień z ekranu i wsuwa następny, przesunięcie
 * **w prawo** — poprzedni.
 *
 * Cała decyzja siedzi tutaj, a nie w ekranie, z dwóch powodów. Po pierwsze,
 * ekranów nie renderujemy w testach, a to jest ta część, w której da się
 * pomylić znak albo przepuścić gest w przyszłość. Po drugie, ograniczenie
 * „nie w przyszłość" musi być dokładnie to samo, co wyłącza strzałkę „›" —
 * gdyby gest miał własną regułę, rozjechałyby się przy pierwszej zmianie.
 *
 * Moduł jest czysty: dostaje przesunięcie palca w pikselach i dwie daty.
 */

import { addDays, type IsoDate } from '@alphapump/core';

/** Przesunięcie palca od początku gestu — pola zgodne z `PanResponderGestureState`. */
export interface SwipeMove {
  dx: number;
  dy: number;
}

/**
 * Po tylu pikselach w poziomie odbieramy gest liście. Próg jest niski, bo
 * odebranie i tak wymaga przewagi poziomu nad pionem — a przy wyższym progu
 * lista zdążyłaby ruszyć i przesunięcie zaczynałoby się szarpnięciem.
 */
export const SWIPE_CAPTURE_DISTANCE = 12;

/** Dopiero takie przesunięcie zmienia dzień. Krótsze to omsknięcie palca. */
export const SWIPE_COMMIT_DISTANCE = 60;

/**
 * Ile razy poziom musi przeważyć nad pionem. To jest jedyne, co pilnuje, żeby
 * gest nie wchodził w drogę przewijaniu listy serii: ukośne pociągnięcie
 * zostaje przewijaniem, bo o dzień prosi się ruchem wyraźnie poziomym.
 */
const DIRECTION_RATIO = 2;

function horizontal(move: SwipeMove, distance: number): boolean {
  return Math.abs(move.dx) >= distance && Math.abs(move.dx) > DIRECTION_RATIO * Math.abs(move.dy);
}

/** Czy ruch palca jest już przesunięciem dnia, a nie przewijaniem widoku. */
export function shouldCaptureSwipe(move: SwipeMove): boolean {
  return horizontal(move, SWIPE_CAPTURE_DISTANCE);
}

/**
 * Dzień, na który przenosi zakończony gest; `null`, gdy gest nie zmienia dnia —
 * bo był za krótki, za bardzo pionowy albo prosił o dzień z przyszłości.
 */
export function swipeTargetDay(day: IsoDate, today: IsoDate, move: SwipeMove): IsoDate | null {
  if (!horizontal(move, SWIPE_COMMIT_DISTANCE)) return null;
  if (move.dx > 0) return addDays(day, -1);
  // To samo ograniczenie, co `disabled` na strzałce „›" — dopisywanie serii
  // w przyszłość nie ma sensu, więc gest też tam nie prowadzi.
  return day >= today ? null : addDays(day, 1);
}
