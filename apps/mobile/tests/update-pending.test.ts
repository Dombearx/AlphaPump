/**
 * Kiedy proponować restart po pobraniu paczki.
 *
 * Testy pilnują dwóch stanów, w których „aktualizacja gotowa, uruchom
 * ponownie" jest prośbą o czynność bez skutku — a obie kończą się tym samym:
 * użytkownik klika, aplikacja wstaje bez zmian i pyta znowu przy następnym
 * otwarciu. Pierwszy to wydanie wgrane ponownie z nową datą, a tą samą treścią;
 * drugi to paczka, która nie wstaje i została przez `expo-updates` odznaczona
 * jako nieudana, ale dalej leży na dysku jako pobrana.
 */

import { describe, expect, it } from 'vitest';
import { restartSucceeded, shouldOfferRestart, type PendingUpdate } from '../src/update/pending';

const RUNNING = '9f2c1b7a-4d3e-4c1a-9b8f-0e5d6a7c8b9d';
const DOWNLOADED = '3a1c5e7f-2b4d-4e6a-8c0b-1d2e3f4a5b6c';

function state(overrides: Partial<PendingUpdate> = {}): PendingUpdate {
  return {
    pending: true,
    downloadedId: DOWNLOADED,
    runningId: RUNNING,
    restartedForId: null,
    ...overrides,
  };
}

describe('shouldOfferRestart', () => {
  it('proponuje restart, gdy czeka paczka inna niż uruchomiona', () => {
    expect(shouldOfferRestart(state())).toBe(true);
  });

  it('milczy, gdy nic nie czeka', () => {
    expect(shouldOfferRestart(state({ pending: false }))).toBe(false);
  });

  it('milczy, gdy serwer podaje paczkę, która już chodzi', () => {
    // Wydanie wgrane ponownie: ta sama treść, ten sam identyfikator, nowa data.
    // Dla `expo-updates` jest to wydanie nowsze, dla telefonu — to samo.
    expect(shouldOfferRestart(state({ runningId: DOWNLOADED }))).toBe(false);
  });

  it('nie prosi o restart dwa razy dla tej samej paczki', () => {
    // Restart był, a chodzi dalej co innego: paczka nie wstaje i kolejne
    // kliknięcie tego nie zmieni — zmieni to dopiero nowe wydanie.
    expect(shouldOfferRestart(state({ restartedForId: DOWNLOADED }))).toBe(false);
  });

  it('proponuje restart dla kolejnej paczki, mimo nieudanej poprzedniej', () => {
    expect(shouldOfferRestart(state({ restartedForId: 'starsza-paczka' }))).toBe(true);
  });

  it('bez identyfikatora wierzy klientowi', () => {
    // Lepsze jedno zbędne pytanie niż wydanie, o które nikt nie zapytał.
    expect(shouldOfferRestart(state({ downloadedId: null }))).toBe(true);
    expect(shouldOfferRestart(state({ downloadedId: null, pending: false }))).toBe(false);
  });

  it('paczka wbudowana nie jest paczką pobraną', () => {
    // `runningId` jest `null`, gdy chodzi kod z pakietu — to najczęstszy stan
    // tuż po instalacji i wtedy propozycja jest jak najbardziej na miejscu.
    expect(shouldOfferRestart(state({ runningId: null }))).toBe(true);
  });
});

describe('restartSucceeded', () => {
  it('rozpoznaje, że zapamiętany restart doszedł do skutku', () => {
    expect(restartSucceeded({ runningId: DOWNLOADED, restartedForId: DOWNLOADED })).toBe(true);
  });

  it('nie uznaje restartu, po którym chodzi co innego', () => {
    expect(restartSucceeded({ runningId: RUNNING, restartedForId: DOWNLOADED })).toBe(false);
  });

  it('bez notatki nie ma czego uznawać', () => {
    expect(restartSucceeded({ runningId: null, restartedForId: null })).toBe(false);
  });
});
