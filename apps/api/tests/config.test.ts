/**
 * Konfiguracja — walidowana raz, przy starcie.
 *
 * Serwer wstający z krótkim sekretem albo bez adresu bazy to awaria, która
 * ujawnia się dopiero przy pierwszym logowaniu i wygląda wtedy jak błąd
 * aplikacji. Dlatego `loadConfig` ma rzucać od razu.
 */

import { describe, expect, it } from 'vitest';
import { deriveNickname } from '../src/auth.js';
import { loadConfig } from '../src/config.js';

const MINIMAL = {
  DATABASE_URL: 'postgres://alphapump@localhost:5432/alphapump',
  BETTER_AUTH_SECRET: 'sekret-o-dlugosci-znacznie-ponad-32-znaki',
};

describe('konfiguracja', () => {
  it('czyta minimalny zestaw zmiennych i dopełnia resztę', () => {
    const config = loadConfig(MINIMAL);
    expect(config).toMatchObject({
      nodeEnv: 'development',
      host: '0.0.0.0',
      port: 3000,
      google: null,
    });
  });

  it('rzuca, gdy brakuje adresu bazy', () => {
    expect(() => loadConfig({ BETTER_AUTH_SECRET: MINIMAL.BETTER_AUTH_SECRET })).toThrow(
      /DATABASE_URL/,
    );
  });

  it('rzuca, gdy sekret jest za krótki', () => {
    expect(() => loadConfig({ ...MINIMAL, BETTER_AUTH_SECRET: 'krotki' })).toThrow(
      /BETTER_AUTH_SECRET/,
    );
  });

  it('trzyma Google wyłączone, dopóki nikt go nie włączy', () => {
    // Wyłączone **domyślnie**, a nie „wyłączone, bo zapomniano poświadczeń".
    expect(loadConfig(MINIMAL).google).toBeNull();
  });

  it('nie włącza Google samymi poświadczeniami', () => {
    // To jest cały powód istnienia flagi: wklejenie poświadczeń z powrotem do
    // `deploy/.env` nie może po cichu przywrócić metody logowania.
    expect(
      loadConfig({ ...MINIMAL, GOOGLE_CLIENT_ID: 'id', GOOGLE_CLIENT_SECRET: 'sekret' }).google,
    ).toBeNull();
  });

  it('nie włącza Google samą flagą', () => {
    // Włączona metoda bez poświadczeń nie ma czym rozmawiać z Google, a
    // better-auth dostałby pustego klienta.
    expect(loadConfig({ ...MINIMAL, GOOGLE_SIGN_IN_ENABLED: 'true' }).google).toBeNull();
    expect(
      loadConfig({ ...MINIMAL, GOOGLE_SIGN_IN_ENABLED: 'true', GOOGLE_CLIENT_ID: 'samo-id' })
        .google,
    ).toBeNull();
  });

  it('włącza Google przy fladze i komplecie poświadczeń', () => {
    expect(
      loadConfig({
        ...MINIMAL,
        GOOGLE_SIGN_IN_ENABLED: 'true',
        GOOGLE_CLIENT_ID: 'id',
        GOOGLE_CLIENT_SECRET: 'sekret',
      }).google,
    ).toEqual({ clientId: 'id', clientSecret: 'sekret' });
  });

  it('trzyma triage wyłączone, dopóki nie skonfigurowano obu wartości naraz', () => {
    expect(loadConfig(MINIMAL).triage).toBeNull();
    expect(loadConfig({ ...MINIMAL, TRIAGE_URL: 'http://triage:8090' }).triage).toBeNull();
    expect(loadConfig({ ...MINIMAL, TRIAGE_HTTP_TOKEN: 'sekret' }).triage).toBeNull();
  });

  it('włącza triage przy komplecie adresu i tokenu', () => {
    expect(
      loadConfig({
        ...MINIMAL,
        TRIAGE_URL: 'http://triage:8090',
        TRIAGE_HTTP_TOKEN: 'sekret',
      }).triage,
    ).toEqual({ url: 'http://triage:8090', token: 'sekret' });
  });

  it('dokłada BETTER_AUTH_URL do zaufanych origin-ów', () => {
    const config = loadConfig({
      ...MINIMAL,
      BETTER_AUTH_URL: 'http://alphapump.netbird:3000',
      TRUSTED_ORIGINS: 'alphapump://, http://localhost:5173',
    });
    expect(config.trustedOrigins).toEqual([
      'http://alphapump.netbird:3000',
      'alphapump://',
      'http://localhost:5173',
    ]);
  });
});

describe('nick', () => {
  it('bierze nazwę konta, gdy jest', () => {
    expect(deriveNickname({ name: 'Kuba', email: 'kuba@example.com' })).toBe('Kuba');
  });

  it('spada na część adresu przed małpą, gdy nazwy brak', () => {
    // Rejestracja e-mailem nie pyta o nick, a kolumna jest `NOT NULL` —
    // musi więc istnieć wartość, którą da się pokazać przy rekordzie globalnym.
    expect(deriveNickname({ name: null, email: 'kuba.nowak@example.com' })).toBe('kuba.nowak');
    expect(deriveNickname({ name: '   ', email: 'pusty@example.com' })).toBe('pusty');
  });
});
