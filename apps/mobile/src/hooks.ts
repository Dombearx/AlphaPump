/**
 * Drobne haki wspólne dla ekranów.
 */

import { useEffect, useState } from 'react';
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
