/**
 * Tapeta w cyklu życia aplikacji.
 *
 * Stan trzyma korzeń, a nie ekran konta: zdjęcie widać pod **każdym** ekranem,
 * więc zmiana w ustawieniach ma przerysować całą aplikację od razu, bez
 * wychodzenia i wracania.
 *
 * Implementację magazynu dostajemy z zewnątrz (`store`), a nie importujemy jej
 * tutaj. Dzięki temu ten plik nie ciągnie za sobą Expo i daje się wyrenderować
 * poza telefonem — razem z ekranem ustawień, który na nim stoi.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { BackgroundStore } from './state';

export interface AppBackground {
  /** Adres tapety albo `null`, gdy obowiązuje tło domyślne. */
  uri: string | null;
  /** Trwa wybór albo zapis — przyciski mają wtedy pokazywać kręciołek. */
  busy: boolean;
  /** Powód odmowy do pokazania pod przyciskami albo `null`. */
  problem: string | null;
  choose: () => Promise<void>;
  restore: () => Promise<void>;
}

const BackgroundContext = createContext<AppBackground | null>(null);

export function BackgroundProvider({
  store,
  children,
}: {
  store: BackgroundStore;
  children: ReactNode;
}) {
  const [uri, setUri] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    // Tapeta doczytuje się po pierwszym renderze, a nie przed nim: dysk jest
    // wolniejszy niż pierwszy ekran, a treningu nikt nie zapisuje po to, żeby
    // popatrzeć na tło.
    void store
      .read()
      .then((stored) => {
        if (!cancelled) setUri(stored);
      })
      .catch(() => {
        if (!cancelled) setUri(null);
      });

    return () => {
      cancelled = true;
    };
  }, [store]);

  const choose = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      const picked = await store.pick();
      // `null` znaczy „zrezygnował" — tapeta zostaje ta, która była.
      if (picked !== null) setUri(picked);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Failed to set the background.');
    } finally {
      setBusy(false);
    }
  }, [store]);

  const restore = useCallback(async () => {
    setBusy(true);
    setProblem(null);
    try {
      await store.clear();
      setUri(null);
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Failed to restore the background.');
    } finally {
      setBusy(false);
    }
  }, [store]);

  const value = useMemo<AppBackground>(
    () => ({ uri, busy, problem, choose, restore }),
    [uri, busy, problem, choose, restore],
  );

  return <BackgroundContext.Provider value={value}>{children}</BackgroundContext.Provider>;
}

export function useAppBackground(): AppBackground {
  const value = useContext(BackgroundContext);
  if (value === null) throw new Error('useAppBackground outside BackgroundProvider');
  return value;
}
