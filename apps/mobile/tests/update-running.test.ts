/**
 * Opis paczki, na której chodzi aplikacja.
 *
 * Testy pilnują tego, po co ta sekcja powstała: **wydanie OTA nie rusza numeru
 * wersji**, więc o tym, czy telefon dostał to, co wyszło, musi mówić data
 * paczki i to, czy paczka jest pobrana, czy wbudowana w pakiet. Osobno start
 * awaryjny — jedyny stan, w którym „zrestartowałem, a zmiany nie ma" jest
 * awarią, a nie nieporozumieniem.
 */

import { describe, expect, it } from 'vitest';
import { describeRunningBundle, type RunningBundle } from '../src/update/running';

const TODAY = '2026-08-20';

const BASE: RunningBundle = {
  versionName: '0.2.0',
  versionCode: 57,
  embedded: false,
  createdAt: new Date(2026, 7, 20, 20, 53),
  updateId: '9f2c1b7a-4d3e-4c1a-9b8f-0e5d6a7c8b9d',
  runtimeVersion: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
  emergency: false,
  emergencyReason: null,
};

function bundle(overrides: Partial<RunningBundle> = {}): RunningBundle {
  return { ...BASE, ...overrides };
}

describe('describeRunningBundle', () => {
  it('numer pakietu łączy nazwę wersji z numerem wydania', () => {
    expect(describeRunningBundle(bundle(), TODAY).version).toBe('0.2.0 (57)');
  });

  it('bez numeru wydania zostaje sama nazwa wersji', () => {
    expect(describeRunningBundle(bundle({ versionCode: null }), TODAY).version).toBe('0.2.0');
  });

  it('nieodczytana wersja mówi o sobie, zamiast pokazywać pustkę', () => {
    expect(describeRunningBundle(bundle({ versionName: null }), TODAY).version).toBe(
      'Version unknown',
    );
  });

  it('pobrana paczka niesie datę i godzinę — to ona rozstrzyga o wydaniu', () => {
    expect(describeRunningBundle(bundle(), TODAY).source).toBe(
      'Running a downloaded bundle from 20 August, 20:53.',
    );
  });

  it('godzina przed południem zostaje dwucyfrowa', () => {
    const early = bundle({ createdAt: new Date(2026, 7, 20, 7, 5) });
    expect(describeRunningBundle(early, TODAY).source).toBe(
      'Running a downloaded bundle from 20 August, 07:05.',
    );
  });

  it('paczka z innego roku dostaje rok w dacie', () => {
    const old = bundle({ createdAt: new Date(2025, 11, 31, 23, 59) });
    expect(describeRunningBundle(old, TODAY).source).toBe(
      'Running a downloaded bundle from 31 December 2025, 23:59.',
    );
  });

  it('paczka wbudowana mówi wprost, że nic się nie pobrało', () => {
    const embedded = bundle({ embedded: true, updateId: null, createdAt: null });
    expect(describeRunningBundle(embedded, TODAY).source).toBe(
      'Running the bundle built into the installed package.',
    );
  });

  it('pobrana paczka bez daty dalej jest pobraną paczką', () => {
    expect(describeRunningBundle(bundle({ createdAt: null }), TODAY).source).toBe(
      'Running a downloaded bundle.',
    );
  });

  it('identyfikator i odcisk są skrócone, ale rozróżnialne', () => {
    expect(describeRunningBundle(bundle(), TODAY).detail).toBe(
      'bundle 9f2c1b7a-4d3… · native layer a1b2c3d4e5f6…',
    );
  });

  it('brak identyfikatorów zostawia pusty wiersz do pominięcia', () => {
    const bare = bundle({ updateId: null, runtimeVersion: null });
    expect(describeRunningBundle(bare, TODAY).detail).toBe('');
  });

  it('zwykły start nie ostrzega przed niczym', () => {
    expect(describeRunningBundle(bundle(), TODAY).warning).toBeNull();
  });

  it('start awaryjny mówi, że pobrana paczka nie wstała', () => {
    const fallback = bundle({ embedded: true, emergency: true, emergencyReason: null });
    expect(describeRunningBundle(fallback, TODAY).warning).toContain('failed to start');
  });

  it('powód startu awaryjnego wchodzi do ostrzeżenia w całości', () => {
    const fallback = bundle({
      embedded: true,
      emergency: true,
      emergencyReason: 'Failed to load JS bundle',
    });
    expect(describeRunningBundle(fallback, TODAY).warning).toContain('Failed to load JS bundle');
  });
});
