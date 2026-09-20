/**
 * Kolejność listy ćwiczeń w cyklu życia ekranu.
 *
 * Hak, a nie provider nad całą aplikacją — z tego samego powodu co przy
 * dyktowaniu (`dictation/use-dictation.ts`): ustawienie czyta jeden ekran,
 * a stan trzymany nad całą aplikacją byłby stanem daleko od swojego jedynego
 * czytelnika. Ekran wyboru ćwiczenia montuje się od nowa przy każdym wejściu
 * (wchodzi się w niego z dnia), więc czyta wtedy aktualną wartość z dysku.
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_EXERCISE_ORDER, type ExerciseOrder, type ExerciseOrderStore } from './state';

export interface AppExerciseOrder {
  order: ExerciseOrder;
  /** Trwa zapis wyboru — przełącznik pokazuje wtedy, że jest zajęty. */
  busy: boolean;
  choose: (order: ExerciseOrder) => Promise<void>;
}

export function useExerciseOrder(store: ExerciseOrderStore): AppExerciseOrder {
  const [order, setOrder] = useState<ExerciseOrder>(DEFAULT_EXERCISE_ORDER);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Wybór doczytuje się po pierwszym renderze: dysk jest wolniejszy niż
    // pierwszy ekran. Przez tę jedną klatkę obowiązuje kolejność domyślna,
    // a że zmienia się tu wyłącznie kolejność tej samej listy, pomyłka w tę
    // stronę nie ma jak niczego zepsuć.
    void store
      .read()
      .then((stored) => {
        if (!cancelled) setOrder(stored);
      })
      .catch(() => {
        if (!cancelled) setOrder(DEFAULT_EXERCISE_ORDER);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const choose = useCallback(
    async (next: ExerciseOrder) => {
      setBusy(true);
      // Przełącznik przestawia się od razu, a zapis idzie w tle — jak przy
      // języku i przy dyktowaniu. Nieudany zapis znaczy tyle, że po restarcie
      // wróci poprzednia wartość.
      setOrder(next);
      try {
        await store.write(next);
      } catch {
        // Celowo bez komunikatu: patrz wyżej.
      } finally {
        setBusy(false);
      }
    },
    [store],
  );

  return { order, busy, choose };
}
