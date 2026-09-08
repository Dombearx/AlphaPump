/**
 * Masa ciała w cyklu życia ekranu.
 *
 * Hak, a nie provider nad całą aplikacją — ta sama decyzja co przy dyktowaniu
 * (`dictation/use-dictation.ts`) i z tego samego powodu: język i tapetę widać na
 * **każdym** ekranie, a masę ciała czytają dwa — ustawienia i formularz serii.
 * Formularz montuje się od nowa przy każdym wejściu w ćwiczenie, więc bierze
 * wtedy aktualną wartość z dysku, a ustawienie zmienia się raz na kilka
 * tygodni, nie w trakcie treningu.
 */

import { useCallback, useEffect, useState } from 'react';
import type { BodyweightStore } from './state';

export interface AppBodyweight {
  /** Zapisana masa w gramach albo `null`, gdy nikt jeszcze jej nie podał. */
  bodyweightG: number | null;
  /** Trwa zapis — przycisk pokazuje wtedy, że jest zajęty. */
  busy: boolean;
  save: (bodyweightG: number | null) => Promise<void>;
}

export function useBodyweight(store: BodyweightStore): AppBodyweight {
  const [bodyweightG, setBodyweightG] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Masa doczytuje się po pierwszym renderze: dysk jest wolniejszy niż
    // pierwszy ekran. Przez tę jedną klatkę formularz wygląda dokładnie tak,
    // jak wyglądał przed dodaniem ustawienia — pole masy ciała jest puste.
    void store
      .read()
      .then((stored) => {
        if (!cancelled) setBodyweightG(stored);
      })
      .catch(() => {
        if (!cancelled) setBodyweightG(null);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const save = useCallback(
    async (next: number | null) => {
      setBusy(true);
      // Ekran przestawia się od razu, a zapis idzie w tle — jak przy języku
      // i dyktowaniu. Nieudany zapis znaczy tyle, że po restarcie wróci
      // poprzednia wartość, a nie że przycisk przez sekundę nie robi nic.
      setBodyweightG(next);
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

  return { bodyweightG, busy, save };
}
