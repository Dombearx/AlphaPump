/**
 * Masa ciała w cyklu życia ekranu.
 *
 * Hak, a nie provider nad całą aplikacją — ta sama decyzja co przy dyktowaniu
 * (`dictation/use-dictation.ts`) i z tego samego powodu: język i tapetę widać na
 * **każdym** ekranie, a masę ciała czytają trzy — ustawienia, formularz serii
 * i dyktowanie. Formularz montuje się od nowa przy każdym wejściu w ćwiczenie,
 * więc bierze wtedy aktualną wartość z dysku, a ustawienie zmienia się raz na
 * kilka tygodni, nie w trakcie treningu.
 */

import { useCallback, useEffect, useState } from 'react';
import { today } from '../day-labels';
import { currentBodyweight, recordBodyweight, type BodyweightEntry } from './state';
import type { BodyweightStore } from './state';

export interface AppBodyweight {
  /** Pomiary najświeższym do przodu; pusta lista, gdy nikt masy nie podał. */
  history: readonly BodyweightEntry[];
  /** Masa aktualna w gramach albo `null` — to ona wchodzi do serii. */
  bodyweightG: number | null;
  /** Trwa zapis — przycisk pokazuje wtedy, że jest zajęty. */
  busy: boolean;
  /** `null` kasuje ustawienie razem z historią; liczba dopisuje pomiar dzisiejszy. */
  save: (bodyweightG: number | null) => Promise<void>;
}

export function useBodyweight(store: BodyweightStore): AppBodyweight {
  const [history, setHistory] = useState<readonly BodyweightEntry[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Masa doczytuje się po pierwszym renderze: dysk jest wolniejszy niż
    // pierwszy ekran. Przez tę jedną klatkę formularz wygląda dokładnie tak,
    // jak wyglądał przed dodaniem ustawienia — pole masy ciała jest puste.
    void store
      .read()
      .then((stored) => {
        if (!cancelled) setHistory(stored);
      })
      .catch(() => {
        if (!cancelled) setHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const save = useCallback(
    async (next: number | null) => {
      setBusy(true);
      // Pomiar dostaje dzień dzisiejszy, a nie znacznik czasu: historia masy
      // ciała jest historią dni, jak dzień treningowy — i tak samo nie ma
      // w sobie strefy czasowej.
      const updated = next === null ? [] : recordBodyweight(history, next, today());

      // Ekran przestawia się od razu, a zapis idzie w tle — jak przy języku
      // i dyktowaniu. Nieudany zapis znaczy tyle, że po restarcie wróci
      // poprzednia wartość, a nie że przycisk przez sekundę nie robi nic.
      setHistory(updated);
      try {
        await store.write(updated);
      } catch {
        // Celowo bez komunikatu: patrz wyżej.
      } finally {
        setBusy(false);
      }
    },
    [store, history],
  );

  return { history, bodyweightG: currentBodyweight(history), busy, save };
}
