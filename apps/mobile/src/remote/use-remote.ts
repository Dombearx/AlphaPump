/**
 * Odczyt sieciowy w kształcie, który da się pokazać na ekranie.
 *
 * Ekrany rekordów globalnych i rankingów są jedynymi, które w ogóle czekają na
 * sieć — reszta aplikacji czyta z bazy lokalnej. Dlatego stan „czekamy" istnieje
 * tylko tutaj, i tylko tutaj brak łączności jest osobną sytuacją: **offline nie
 * jest błędem**. Telefon poza VPN-em ma pełny zasięg i żadnego dostępu do API,
 * więc komunikat o awarii byłby po prostu nieprawdziwy.
 *
 * Hak nie cache'uje. Dane pochodne serwera zmieniają się po każdym cudzym
 * treningu, a nieświeży ranking pokazany jako świeży myli bardziej, niż pomaga.
 */

import { useCallback, useEffect, useState } from 'react';
import { SyncAuthError, isOffline } from '../sync/transport';

export type RemoteState<T> =
  | { status: 'loading' }
  | { status: 'ready'; data: T }
  /** Serwer nieosiągalny — normalny stan pracy, nie awaria. */
  | { status: 'offline' }
  | { status: 'error'; message: string };

export interface Remote<T> {
  state: RemoteState<T>;
  reload: () => void;
}

export function useRemote<T>(load: () => Promise<T>, deps: readonly unknown[]): Remote<T> {
  const [state, setState] = useState<RemoteState<T>>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  // Zależności podaje wołający — to on wie, od czego zależy jego odczyt.
  const run = useCallback(load, deps);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });

    void (async () => {
      try {
        const data = await run();
        if (!cancelled) setState({ status: 'ready', data });
      } catch (error) {
        if (cancelled) return;
        if (isOffline(error)) {
          setState({ status: 'offline' });
        } else if (error instanceof SyncAuthError) {
          setState({ status: 'error', message: 'Sesja wygasła — zaloguj się ponownie' });
        } else {
          setState({
            status: 'error',
            message: error instanceof Error ? error.message : 'Nie udało się pobrać danych',
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [run, attempt]);

  return { state, reload: useCallback(() => setAttempt((value) => value + 1), []) };
}
