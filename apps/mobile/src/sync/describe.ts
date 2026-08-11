/**
 * Stan synchronizacji po polsku.
 *
 * Wydzielone z komponentu, bo to jest ta część, która ma reguły warte
 * sprawdzenia testem — a komponentu React Native nie da się uczciwie
 * wyrenderować w Node.
 *
 * Najważniejsza reguła: **brak łączności nie jest błędem.** Synchronizacja jedzie
 * przez NetBirda, więc telefon poza VPN-em to codzienność, a nie awaria. Ma o tym
 * mówić spokojne „offline", a czerwone „błąd synchronizacji" zostaje dla sytuacji,
 * w których serwer odpowiedział czymś, czego nie umiemy przyjąć.
 */

import type { SyncSnapshot } from './engine';

export type SyncTone = 'neutral' | 'progress' | 'warning' | 'danger';

export interface SyncDescription {
  /** Napis w pigułce statusu — możliwie krótki. */
  label: string;
  tone: SyncTone;
  /** Zdanie pokazywane po tapnięciu w pigułkę. */
  detail: string;
}

export function describeSync(snapshot: SyncSnapshot, now: Date = new Date()): SyncDescription {
  const pending = snapshot.pending;
  const queue = pending > 0 ? ` Czeka ${String(pending)} ${plural(pending)}.` : '';
  const last = lastSyncSentence(snapshot.lastSyncedAt, now);

  switch (snapshot.phase) {
    case 'syncing':
      return {
        label: 'Synchronizacja…',
        tone: 'progress',
        detail: `Wymiana danych z serwerem.${queue}`,
      };

    case 'offline':
      return {
        label: 'Offline',
        tone: 'neutral',
        detail:
          `Serwer jest poza zasięgiem — sprawdź połączenie z VPN. Zmiany zostaną wysłane, gdy wróci.${queue} ${last}`.trim(),
      };

    case 'signed-out':
      return {
        label: 'Zaloguj się',
        tone: 'warning',
        detail: `Sesja wygasła, więc dane czekają na urządzeniu.${queue} ${last}`.trim(),
      };

    case 'error':
      return {
        label: 'Błąd',
        tone: 'danger',
        detail: `${snapshot.lastError ?? 'Serwer odpowiedział błędem.'}${queue} ${last}`.trim(),
      };

    case 'idle':
      if (pending > 0) {
        return {
          label: `Do wysłania: ${String(pending)}`,
          tone: 'warning',
          detail: `${queue.trim()} Pojedzie przy najbliższej wymianie. ${last}`.trim(),
        };
      }
      return { label: 'Zsynchronizowano', tone: 'neutral', detail: last };
  }
}

function plural(count: number): string {
  if (count === 1) return 'zmiana';
  const tens = count % 100;
  const ones = count % 10;
  const few = ones >= 2 && ones <= 4 && !(tens >= 12 && tens <= 14);
  return few ? 'zmiany' : 'zmian';
}

/** „Ostatnia wymiana: 5 min temu". Bez sekund — precyzja i tak nikomu nie służy. */
export function lastSyncSentence(at: Date | null, now: Date): string {
  if (at === null) return 'Jeszcze nie synchronizowano na tym urządzeniu.';

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'Ostatnia wymiana: przed chwilą.';
  if (minutes < 60) return `Ostatnia wymiana: ${String(minutes)} min temu.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Ostatnia wymiana: ${String(hours)} godz. temu.`;

  const days = Math.floor(hours / 24);
  return `Ostatnia wymiana: ${String(days)} dni temu.`;
}
