/**
 * Drobne haki wspólne dla ekranów.
 */

import type { UserRole } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { useEffect, useState } from 'react';
import { useSession } from './auth/client';
import { db } from './db/client';
import { localUser } from './db/queries';
import { getDeviceId } from './device';

/**
 * Identyfikator urządzenia. Czytany z bezpiecznego magazynu systemowego, więc
 * pierwszy render jeszcze go nie ma — a bez niego nie wolno zapisywać, bo to on
 * rozstrzyga remisy `updatedAt` przy synchronizacji. Ekran czeka na tę jedną
 * wartość i dopiero potem pozwala zapisać serię.
 */
export function useDeviceId(): string | null {
  const [deviceId, setDeviceId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getDeviceId().then((value) => {
      if (!cancelled) setDeviceId(value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return deviceId;
}

/**
 * Kto zapisuje: konto, urządzenie i rola.
 *
 * Rola jest czytana z cache'u kont w bazie lokalnej, a nie z sesji, bo zmiana
 * uprawnień przyjeżdża pullem i ma być widoczna bez ponownego logowania.
 * `null` znaczy „jeszcze nie wiadomo" — ekran nie może wtedy zapisywać, bo bez
 * identyfikatora urządzenia nie da się rozstrzygnąć remisów przy synchronizacji.
 */
export interface LocalAuthor {
  userId: string;
  deviceId: string;
  role: UserRole;
}

export function useLocalAuthor(): LocalAuthor | null {
  const { data: session } = useSession();
  const deviceId = useDeviceId();
  const userId = session?.user.id ?? '';
  const account = useLiveQuery(localUser(db, userId));

  if (userId.length === 0 || deviceId === null) return null;
  return { userId, deviceId, role: account.data[0]?.role ?? 'user' };
}
