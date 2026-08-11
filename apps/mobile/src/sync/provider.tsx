/**
 * Wpięcie silnika synchronizacji w cykl życia aplikacji.
 *
 * Silnik powstaje dopiero wtedy, gdy są komplet: zalogowane konto i nadany
 * identyfikator urządzenia. Wcześniej nie ma czym się synchronizować, a próba
 * pushu bez sesji kończyłaby się serią 401 przy każdym starcie.
 *
 * Powrót aplikacji na wierzch jest tu najważniejszym wyzwalaczem. Nie mamy jak
 * dowiedzieć się o powrocie łączności ze stanu sieci systemu: synchronizacja
 * jedzie przez NetBirda, więc telefon z pełnym LTE bywa poza VPN-em, a system
 * i tak mówi „połączony". Jedynym uczciwym testem jest próba dobicia się do
 * serwera — a najczęstszy moment, w którym warunki faktycznie się zmieniły, to
 * właśnie wyjęcie telefonu z kieszeni.
 *
 * Praca „w tle" znaczy tu: poza wątkiem interfejsu i bez blokowania ekranu.
 * Budzenie aplikacji przez system, gdy jest zamknięta, wymagałoby natywnego
 * zadania w tle — a przy danych, które i tak wysyłają się przy każdym otwarciu
 * i po każdym zapisie, kupiłoby to wyłącznie kolejny element do utrzymania.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { sessionCookie, useSession } from '../auth/client';
import { appConfig } from '../config/index';
import { db } from '../db/client';
import { getDeviceId } from '../device';
import { createSyncEngine, type SyncEngine, type SyncSnapshot } from './engine';
import { createHttpTransport } from './transport';

/** Stan pokazywany, zanim silnik w ogóle powstanie. */
const IDLE: SyncSnapshot = {
  phase: 'idle',
  pending: 0,
  lastSyncedAt: null,
  lastError: null,
  rejected: 0,
};

const SyncContext = createContext<SyncEngine | null>(null);

export function SyncProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const userId = session?.user.id ?? null;
  const [engine, setEngine] = useState<SyncEngine | null>(null);

  useEffect(() => {
    if (userId === null) return;

    let created: SyncEngine | null = null;
    let cancelled = false;

    void getDeviceId().then((deviceId) => {
      if (cancelled) return;

      created = createSyncEngine({
        db,
        deviceId,
        transport: createHttpTransport({
          baseUrl: appConfig.apiUrl,
          // Sesja żyje krócej niż transport, więc ciasteczko czytamy przy każdym
          // żądaniu, a nie raz przy tworzeniu klienta.
          cookie: sessionCookie,
        }),
      });

      setEngine(created);
      created.request();
    });

    return () => {
      cancelled = true;
      created?.stop();
      setEngine(null);
    };
  }, [userId]);

  useEffect(() => {
    if (engine === null) return;

    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') engine.request();
    });

    return () => subscription.remove();
  }, [engine]);

  return <SyncContext.Provider value={engine}>{children}</SyncContext.Provider>;
}

export function useSyncEngine(): SyncEngine | null {
  return useContext(SyncContext);
}

/** Stan synchronizacji do pokazania w interfejsie. */
export function useSyncSnapshot(): SyncSnapshot {
  const engine = useSyncEngine();

  return useSyncExternalStore(
    useMemo(
      () => (listener: () => void) =>
        engine === null ? () => undefined : engine.subscribe(listener),
      [engine],
    ),
    () => engine?.snapshot() ?? IDLE,
  );
}

/**
 * Zgłoszenie „mam coś do wysłania", wołane po każdym zapisie lokalnym.
 *
 * Funkcja nic nie zwraca i niczego nie czeka — ekran ma po zapisie odrysować się
 * z bazy, a nie stać w kolejce do sieci.
 */
export function useRequestSync(): () => void {
  const engine = useSyncEngine();
  return useMemo(() => () => engine?.request(), [engine]);
}
