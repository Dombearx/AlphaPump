/**
 * Status synchronizacji pokazywany użytkownikowi.
 *
 * Jedna reguła jest tu ważniejsza od reszty: **brak łączności nie jest błędem.**
 * Synchronizacja jedzie przez NetBirda, więc telefon poza VPN-em to codzienność.
 * Czerwony komunikat o awarii w takiej sytuacji uczyłby, że aplikacja jest
 * zepsuta.
 */

import { describe, expect, it } from 'vitest';
import { describeSync, lastSyncSentence } from '../src/sync/describe';
import type { SyncSnapshot } from '../src/sync/engine';

const NOW = new Date('2026-08-11T12:00:00.000Z');

const snapshot = (patch: Partial<SyncSnapshot> = {}): SyncSnapshot => ({
  phase: 'idle',
  pending: 0,
  lastSyncedAt: NOW,
  lastError: null,
  rejected: 0,
  ...patch,
});

describe('opis statusu', () => {
  it('brak serwera jest spokojnym „offline", nie awarią', () => {
    const description = describeSync(snapshot({ phase: 'offline', pending: 3 }), NOW);

    expect(description.label).toBe('Offline');
    expect(description.tone).toBe('neutral');
    expect(description.detail).toContain('VPN');
    expect(description.detail).toContain('3 changes');
  });

  it('błąd serwera jest oznaczony jako błąd', () => {
    const description = describeSync(
      snapshot({ phase: 'error', lastError: 'Server responded 500' }),
      NOW,
    );

    expect(description.tone).toBe('danger');
    expect(description.detail).toContain('500');
  });

  it('czekające zmiany widać, zanim pojadą', () => {
    const description = describeSync(snapshot({ pending: 1 }), NOW);

    expect(description.label).toBe('To send: 1');
    expect(description.detail).toContain('1 change');
  });

  it('wszystko wysłane mówi krótko', () => {
    expect(describeSync(snapshot(), NOW).label).toBe('Synced');
  });

  it('wygasła sesja prosi o zalogowanie', () => {
    expect(describeSync(snapshot({ phase: 'signed-out' }), NOW).label).toBe('Sign in');
  });

  it('odmienia liczbę zmian', () => {
    const label = (pending: number) =>
      describeSync(snapshot({ phase: 'offline', pending }), NOW).detail;

    expect(label(1)).toContain('1 change');
    expect(label(3)).toContain('3 changes');
    expect(label(5)).toContain('5 changes');
    expect(label(22)).toContain('22 changes');
    expect(label(13)).toContain('13 changes');
  });
});

describe('czas ostatniej wymiany', () => {
  it('mówi o minutach, godzinach i dniach', () => {
    expect(lastSyncSentence(new Date('2026-08-11T11:59:30Z'), NOW)).toContain('just now');
    expect(lastSyncSentence(new Date('2026-08-11T11:30:00Z'), NOW)).toContain('30 min');
    expect(lastSyncSentence(new Date('2026-08-11T08:00:00Z'), NOW)).toContain('4 hr');
    expect(lastSyncSentence(new Date('2026-08-08T12:00:00Z'), NOW)).toContain('3 d');
  });

  it('urządzenie bez historii mówi to wprost', () => {
    expect(lastSyncSentence(null, NOW)).toContain("hasn't synced");
  });
});
