/**
 * Podpowiadanie ćwiczeń na ekranie wyboru — sklejenie wierszy z bazy z liczeniem
 * z rdzenia.
 *
 * Sam algorytm („co wykonać teraz, żeby domknąć cykl i nie męczyć dwa razy pod
 * rząd tych samych partii") siedzi w `rotation.ts` w `@alphapump/core`, razem
 * z uzasadnieniem każdej stałej. Tutaj jest wyłącznie tłumaczenie: wiersze
 * biblioteki, tagi dodatkowe, dzisiejsze serie i braki cykli na kształt, którego
 * oczekuje rdzeń. Dzięki temu moduł daje się przetestować bez renderowania
 * ekranu — i tam właśnie sprawdzamy to, czego test czystej funkcji nie widzi:
 * że ćwiczenie z dzisiejszych serii ma **te same** tagi, co to samo ćwiczenie
 * na liście.
 */

import {
  CARDIO_TAG_SLUG,
  orderByRotation,
  type RotatedExercise,
  type RotationContext,
} from '@alphapump/core';
import type { CycleNeeds } from './cycle-progress';
import type { DaySetRow, LibraryRow, NamedTag, TagLibraryRow } from './db/queries';

/**
 * Tagi wyłączone z podpowiadania. Rozpoznawane po slugu, bo nazwa bywa
 * przetłumaczona, a slug jest jeden i to z niego liczy się identyfikator tagu.
 * Gdy użytkownik nie ma tagu cardio, zbiór jest pusty i nic się nie wyłącza.
 */
export function excludedTagIds(tags: readonly TagLibraryRow[]): ReadonlySet<string> {
  return new Set(tags.filter((tag) => tag.slug === CARDIO_TAG_SLUG).map((tag) => tag.id));
}

function rotated(
  id: string,
  primaryTagId: string,
  additional: ReadonlyMap<string, NamedTag[]>,
): RotatedExercise {
  return {
    id,
    primaryTagId,
    additionalTagIds: (additional.get(id) ?? []).map((tag) => tag.id),
  };
}

/**
 * Ćwiczenia dzisiejszych serii w kolejności **wykonania**, od najstarszej.
 *
 * Kolejność idzie po czasie zapisu, a nie po `position`: pozycja liczy się
 * w obrębie pary dzień + ćwiczenie, więc każde ćwiczenie zaczyna od zera
 * i sortowanie po niej pomieszałoby ze sobą ćwiczenia robione na zmianę —
 * czyli dokładnie ten przypadek, dla którego cały ten moduł istnieje.
 * Powtórzeń pod rząd nie zwijamy tutaj; robi to rdzeń.
 */
export function performedToday(
  sets: readonly DaySetRow[],
  additional: ReadonlyMap<string, NamedTag[]>,
): RotatedExercise[] {
  return [...sets]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((set) => rotated(set.exerciseId, set.tagId, additional));
}

export interface RotationInput {
  sets: readonly DaySetRow[];
  additional: ReadonlyMap<string, NamedTag[]>;
  needs: CycleNeeds;
  tags: readonly TagLibraryRow[];
}

/**
 * Biblioteka ułożona pod „co wykonać teraz". Wchodzi lista w kolejności, jaką
 * dało zapytanie (najczęściej wykonywane na górze), wychodzi ta sama lista
 * z podpowiedziami wyciągniętymi na górę — sortowanie jest stabilne, więc
 * dotychczasowa kolejność zostaje rozstrzyganiem remisów.
 */
export function orderLibrary(rows: readonly LibraryRow[], input: RotationInput): LibraryRow[] {
  const context: RotationContext = {
    performed: performedToday(input.sets, input.additional),
    tagNeed: input.needs.byTag,
    exerciseNeed: input.needs.byExercise,
    excludedTagIds: excludedTagIds(input.tags),
  };

  return orderByRotation(
    rows.map((row) => ({ ...row, ...rotated(row.id, row.tagId, input.additional) })),
    context,
  );
}
