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
  const queue = pending > 0 ? ` ${String(pending)} ${plural(pending)} pending.` : '';
  const last = lastSyncSentence(snapshot.lastSyncedAt, now);

  switch (snapshot.phase) {
    case 'syncing':
      return {
        label: 'Syncing…',
        tone: 'progress',
        detail: `Exchanging data with the server.${queue}`,
      };

    case 'offline':
      return {
        label: 'Offline',
        tone: 'neutral',
        detail:
          `The server is unreachable — check your VPN connection. Changes will be sent once it's back.${queue} ${last}`.trim(),
      };

    case 'signed-out':
      return {
        label: 'Sign in',
        tone: 'warning',
        detail: `The session expired, so data is waiting on the device.${queue} ${last}`.trim(),
      };

    case 'error':
      return {
        label: 'Error',
        tone: 'danger',
        detail:
          `${snapshot.lastError ?? 'The server responded with an error.'}${queue} ${last}`.trim(),
      };

    case 'idle':
      if (pending > 0) {
        return {
          label: `To send: ${String(pending)}`,
          tone: 'warning',
          detail: `${queue.trim()} It will go out on the next sync. ${last}`.trim(),
        };
      }
      return { label: 'Synced', tone: 'neutral', detail: last };
  }
}

function plural(count: number): string {
  return count === 1 ? 'change' : 'changes';
}

/** "Last sync: 5 min ago". No seconds — that precision doesn't help anyone. */
export function lastSyncSentence(at: Date | null, now: Date): string {
  if (at === null) return "This device hasn't synced yet.";

  const minutes = Math.floor((now.getTime() - at.getTime()) / 60_000);
  if (minutes < 1) return 'Last sync: just now.';
  if (minutes < 60) return `Last sync: ${String(minutes)} min ago.`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Last sync: ${String(hours)} hr ago.`;

  const days = Math.floor(hours / 24);
  return `Last sync: ${String(days)} d ago.`;
}
