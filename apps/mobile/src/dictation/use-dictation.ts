/**
 * Tryb dyktowania w cyklu życia ekranu.
 *
 * Hak, a nie provider nad całą aplikacją — i to jest różnica względem języka
 * i tapety. Tamte dwa widać na **każdym** ekranie, więc ich stan musi stać nad
 * nawigacją, żeby zmiana w ustawieniach przerysowała wszystko od razu. Ten
 * dotyczy jednego ekranu i czyta go jeden ekran: stan trzymany nad całą
 * aplikacją byłby stanem daleko od swojego jedynego czytelnika.
 *
 * Ekran dyktowania montuje się od nowa przy każdym wejściu (wchodzi się w niego
 * z dnia), więc czyta wtedy aktualną wartość z dysku — a ustawienie zmienia się
 * raz na kilka miesięcy, nie w trakcie serii.
 */

import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_DICTATION_MODE, type DictationMode, type DictationStore } from './state';

export interface AppDictation {
  mode: DictationMode;
  /** Trwa zapis wyboru — przełącznik pokazuje wtedy, że jest zajęty. */
  busy: boolean;
  choose: (mode: DictationMode) => Promise<void>;
}

export function useDictationMode(store: DictationStore): AppDictation {
  const [mode, setMode] = useState<DictationMode>(DEFAULT_DICTATION_MODE);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // Wybór doczytuje się po pierwszym renderze: dysk jest wolniejszy niż
    // pierwszy ekran. Przez tę jedną klatkę obowiązuje tryb domyślny, czyli ten
    // ostrożniejszy — pomyłka w tę stronę nie ma jak nic zapisać.
    void store
      .read()
      .then((stored) => {
        if (!cancelled) setMode(stored);
      })
      .catch(() => {
        if (!cancelled) setMode(DEFAULT_DICTATION_MODE);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const choose = useCallback(
    async (next: DictationMode) => {
      setBusy(true);
      // Przełącznik przestawia się od razu, a zapis idzie w tle — jak przy
      // języku. Nieudany zapis znaczy tyle, że po restarcie wróci poprzednia
      // wartość, a nie że przycisk przez sekundę nie robi nic.
      setMode(next);
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

  return { mode, busy, choose };
}
