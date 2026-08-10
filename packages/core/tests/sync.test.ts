/**
 * Reguły rozstrzygania konfliktów.
 *
 * Tabela z dokumentu stacku ma tu trzy wiersze i wszystkie trzy są sprawdzone:
 * suma (brak konfliktu z definicji), LWW po `updatedAt` i wygrywające usunięcie.
 * Testy integracyjne API (`apps/api/tests/sync.test.ts`) sprawdzają te same
 * reguły na dwóch urządzeniach i prawdziwej bazie — tu chodzi o samą regułę.
 */

import { describe, expect, it } from 'vitest';
import {
  clampRevision,
  clampToNow,
  compareRevisions,
  newDeviceId,
  resolveSyncConflict,
  syncPushRequestSchema,
  type SyncRevision,
} from '../src/sync.js';

const DEVICE_A = '00000000-0000-7000-8000-00000000000a';
const DEVICE_B = '00000000-0000-7000-8000-00000000000b';

function revision(overrides: Partial<SyncRevision> = {}): SyncRevision {
  return {
    createdAt: '2026-08-01T10:00:00.000Z',
    updatedAt: '2026-08-01T10:00:00.000Z',
    deletedAt: null,
    deviceId: DEVICE_A,
    ...overrides,
  };
}

describe('przycinanie znaczników z przyszłości', () => {
  const now = new Date('2026-08-10T12:00:00.000Z');

  it('zostawia znacznik z przeszłości bez zmian', () => {
    expect(clampToNow('2026-08-10T11:59:59.000Z', now)).toBe('2026-08-10T11:59:59.000Z');
  });

  it('ścina znacznik z przyszłości do „teraz" serwera', () => {
    // Telefon z zegarem przestawionym o rok wygrywałby inaczej każdy konflikt,
    // aż do chwili, w której reszta świata by go dogoniła.
    expect(clampToNow('2027-01-01T00:00:00.000Z', now)).toBe(now.toISOString());
  });

  it('normalizuje strefę czasową do UTC', () => {
    expect(clampToNow('2026-08-10T13:30:00.000+02:00', now)).toBe('2026-08-10T11:30:00.000Z');
  });

  it('przycina wszystkie trzy znaczniki wiersza naraz', () => {
    const clamped = clampRevision(
      revision({
        createdAt: '2030-01-01T00:00:00.000Z',
        updatedAt: '2030-01-01T00:00:00.000Z',
        deletedAt: '2030-01-01T00:00:00.000Z',
      }),
      now,
    );

    expect(clamped.createdAt).toBe(now.toISOString());
    expect(clamped.updatedAt).toBe(now.toISOString());
    expect(clamped.deletedAt).toBe(now.toISOString());
  });

  it('odrzuca znacznik, którego nie da się przeczytać', () => {
    expect(() => clampToNow('wczoraj', now)).toThrow(RangeError);
  });
});

describe('porządek LWW', () => {
  it('rozstrzyga po czasie zapisu', () => {
    const older = revision({ updatedAt: '2026-08-01T10:00:00.000Z' });
    const newer = revision({ updatedAt: '2026-08-01T10:00:01.000Z' });
    expect(compareRevisions(newer, older)).toBeGreaterThan(0);
    expect(compareRevisions(older, newer)).toBeLessThan(0);
  });

  it('przy remisie rozstrzyga identyfikator urządzenia', () => {
    const fromA = revision({ deviceId: DEVICE_A });
    const fromB = revision({ deviceId: DEVICE_B });
    expect(compareRevisions(fromB, fromA)).toBeGreaterThan(0);
  });

  it('daje ten sam wynik niezależnie od kolejności pushy', () => {
    const fromA = revision({ deviceId: DEVICE_A });
    const fromB = revision({ deviceId: DEVICE_B });

    // A przychodzi na serwer z B: B zostaje. B przychodzi na serwer z A: B wchodzi.
    expect(resolveSyncConflict(fromB, fromA)).toBe('stale');
    expect(resolveSyncConflict(fromA, fromB)).toBe('update');
  });

  it('porównuje momenty w czasie, a nie napisy', () => {
    const utc = revision({ updatedAt: '2026-08-01T12:00:00.000Z' });
    const shifted = revision({ updatedAt: '2026-08-01T13:00:00.000+02:00' });
    // 13:00+02:00 to 11:00 UTC — czyli wcześniej, choć napis wygląda na późniejszy.
    expect(compareRevisions(shifted, utc)).toBeLessThan(0);
  });
});

describe('rozstrzyganie konfliktu wiersza', () => {
  it('wiersza, którego serwer nie zna, po prostu nie ma z czym skonfliktować', () => {
    expect(resolveSyncConflict(null, revision())).toBe('insert');
  });

  it('przyjmuje tombstone wiersza, którego serwer nigdy nie widział', () => {
    // Urządzenie utworzyło i skasowało wiersz między dwoma synchronizacjami.
    expect(resolveSyncConflict(null, revision({ deletedAt: '2026-08-02T10:00:00.000Z' }))).toBe(
      'insert',
    );
  });

  it('nowsza edycja wymienia wiersz', () => {
    const existing = revision({ updatedAt: '2026-08-01T10:00:00.000Z' });
    const incoming = revision({ updatedAt: '2026-08-02T10:00:00.000Z', deviceId: DEVICE_B });
    expect(resolveSyncConflict(existing, incoming)).toBe('update');
  });

  it('starsza edycja przegrywa', () => {
    const existing = revision({ updatedAt: '2026-08-03T10:00:00.000Z' });
    const incoming = revision({ updatedAt: '2026-08-02T10:00:00.000Z', deviceId: DEVICE_B });
    expect(resolveSyncConflict(existing, incoming)).toBe('stale');
  });

  it('usunięcie wygrywa z żywym wierszem, choćby było starsze', () => {
    const existing = revision({ updatedAt: '2026-08-09T10:00:00.000Z' });
    const incoming = revision({
      updatedAt: '2026-08-02T10:00:00.000Z',
      deletedAt: '2026-08-02T10:00:00.000Z',
      deviceId: DEVICE_B,
    });
    expect(resolveSyncConflict(existing, incoming)).toBe('delete');
  });

  it('usunięcie wygrywa z późniejszą edycją drugiego urządzenia', () => {
    // Kryterium akceptacyjne: „jedno usuwa, drugie edytuje" — usunięcie wygrywa
    // **niezależnie od czasu**, więc edycja z jutra też przegrywa.
    const existing = revision({
      updatedAt: '2026-08-02T10:00:00.000Z',
      deletedAt: '2026-08-02T10:00:00.000Z',
    });
    const incoming = revision({ updatedAt: '2026-08-09T10:00:00.000Z', deviceId: DEVICE_B });
    expect(resolveSyncConflict(existing, incoming)).toBe('deleted');
  });

  it('dwa tombstone’y nie mają czego zapisywać', () => {
    const existing = revision({ deletedAt: '2026-08-02T10:00:00.000Z' });
    const incoming = revision({ deletedAt: '2026-08-03T10:00:00.000Z', deviceId: DEVICE_B });
    expect(resolveSyncConflict(existing, incoming)).toBe('noop');
  });

  it('świadome odtworzenie encji wraca do życia', () => {
    // Identyfikatory ćwiczeń i tagów są deterministyczne, więc bez tej furtki
    // skasowany „Przysiad" nie dałby się już nigdy dodać z powrotem.
    const existing = revision({
      createdAt: '2026-07-01T10:00:00.000Z',
      deletedAt: '2026-08-02T10:00:00.000Z',
    });
    const recreated = revision({
      createdAt: '2026-08-05T10:00:00.000Z',
      updatedAt: '2026-08-05T10:00:00.000Z',
      deviceId: DEVICE_B,
    });
    expect(resolveSyncConflict(existing, recreated)).toBe('insert');
  });
});

describe('kształt paczki pushu', () => {
  it('pusta paczka jest poprawna', () => {
    const parsed = syncPushRequestSchema.parse({ deviceId: DEVICE_A });
    expect(parsed).toEqual({ deviceId: DEVICE_A, tags: [], exercises: [], cycles: [], sets: [] });
  });

  it('wymaga identyfikatora urządzenia', () => {
    expect(syncPushRequestSchema.safeParse({}).success).toBe(false);
  });

  it('nie przyjmuje serii z cudzym właścicielem, bo pola właściciela nie ma', () => {
    const parsed = syncPushRequestSchema.parse({
      deviceId: DEVICE_A,
      sets: [
        {
          id: '00000000-0000-7000-8000-000000000001',
          userId: 'ktos-inny',
          exerciseId: '00000000-0000-7000-8000-000000000002',
          performedOn: '2026-08-10',
          position: 0,
          weightG: 80_000,
          reps: 5,
          durationS: null,
          distanceM: null,
          createdAt: '2026-08-10T10:00:00.000Z',
          updatedAt: '2026-08-10T10:00:00.000Z',
          deletedAt: null,
        },
      ],
    });

    expect(parsed.sets[0]).not.toHaveProperty('userId');
  });

  it('nadaje identyfikator urządzenia w formacie UUID', () => {
    expect(syncPushRequestSchema.safeParse({ deviceId: newDeviceId() }).success).toBe(true);
  });
});
