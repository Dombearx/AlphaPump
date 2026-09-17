/**
 * Podpis pozycji celu cyklu.
 *
 * Trzy ekrany pokazują tę samą pozycję — cykl, lista cykli i formularz — więc
 * podpis powstaje w jednym miejscu. Bez tego „12 serii na biceps" potrafiłoby
 * nazywać się na każdym z nich inaczej, a po dodaniu języków także w innym
 * języku, bo tłumaczenie trzeba wybrać przy renderowaniu.
 *
 * Zapasowe „Goal item" nie jest ozdobą: pozycja może wskazywać ćwiczenie albo
 * tag, którego lokalna baza jeszcze nie ma (cykl przyjechał pullem wcześniej niż
 * biblioteka). Pusty wiersz wyglądałby wtedy jak błąd aplikacji.
 *
 * Pozycja o zakresie intensywnościowym nie wskazuje żadnego wiersza — jej nazwa
 * jest stałą z `measurements.ts` i nie podlega tłumaczeniu nazw encji, bo nie
 * ma encji do przetłumaczenia.
 */

import type { Translatable } from '@alphapump/core';
import { goalTarget, type CycleGoalRow } from './db/queries';
import { INTENSITY_GOAL_LABELS } from './measurements';

export type GoalTargetRow = Pick<
  CycleGoalRow,
  'exerciseName' | 'exerciseTranslations' | 'tagName' | 'tagTranslations' | 'intensity'
>;

export function goalName(
  row: GoalTargetRow | null | undefined,
  named: (entity: Translatable) => string,
): string {
  if (row?.intensity != null) return INTENSITY_GOAL_LABELS[row.intensity];

  const target = goalTarget(row ?? null);
  return target === null ? 'Goal item' : named(target);
}
