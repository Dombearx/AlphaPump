/**
 * Identyfikator urządzenia.
 *
 * Nadawany raz, przy pierwszym uruchomieniu, i trzymany w bezpiecznym magazynie
 * systemowym. Nie identyfikuje użytkownika — służy wyłącznie do rozstrzygania
 * remisów `updated_at` przy synchronizacji, żeby dwa telefony, których zegary
 * wskazały tę samą milisekundę, zbiegły się do tej samej wersji wiersza.
 *
 * Musi przeżyć restart aplikacji: identyfikator losowany przy każdym starcie
 * zamieniłby deterministyczne rozstrzygnięcie w rzut monetą.
 */

import { newDeviceId } from '@alphapump/core';
import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'alphapump.device-id';

let cached: string | null = null;

export async function getDeviceId(): Promise<string> {
  if (cached !== null) return cached;

  const stored = await SecureStore.getItemAsync(STORAGE_KEY);
  if (stored !== null) {
    cached = stored;
    return stored;
  }

  const created = newDeviceId();
  await SecureStore.setItemAsync(STORAGE_KEY, created);
  cached = created;
  return created;
}

/** Wyłącznie dla testów — czyści pamięć podręczną procesu. */
export function forgetCachedDeviceId(): void {
  cached = null;
}
