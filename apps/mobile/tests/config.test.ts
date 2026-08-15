/**
 * Konfiguracja aplikacji.
 *
 * Brakujący albo przekręcony adres API ma wywalić się przy starcie z czytelnym
 * komunikatem, a nie objawić się po zalogowaniu jako „coś nie działa".
 */

import { describe, expect, it } from 'vitest';
import { isGoogleSignInConfigured, parseAppConfig } from '../src/config/schema';

describe('konfiguracja aplikacji', () => {
  it('przyjmuje komplet i ucina końcowy ukośnik adresu', () => {
    const config = parseAppConfig({
      apiUrl: 'http://alphapump.local:3000/',
      googleWebClientId: 'web.apps.googleusercontent.com',
      googleIosClientId: null,
    });

    expect(config.apiUrl).toBe('http://alphapump.local:3000');
    expect(isGoogleSignInConfigured(config)).toBe(true);
  });

  it('działa bez konfiguracji Google', () => {
    // Brak jednej metody logowania nie może zablokować uruchomienia aplikacji.
    const config = parseAppConfig({ apiUrl: 'http://alphapump.local:3000' });
    expect(isGoogleSignInConfigured(config)).toBe(false);
  });

  it('odrzuca brak adresu API', () => {
    expect(() => parseAppConfig({})).toThrow(/apiUrl/);
  });

  it('odrzuca adres, który nie jest adresem', () => {
    expect(() => parseAppConfig({ apiUrl: 'minipc:3000' })).toThrow(/Invalid app configuration/);
  });

  it('wylicza katalog wydań z adresu API', () => {
    // Wydania leżą pod tym samym hostem co API: Caddy oddaje `/alphapump/download`
    // z woluminu obok niego. Jeden adres w konfiguracji zamiast dwóch, które
    // dałoby się rozjechać.
    const config = parseAppConfig({ apiUrl: 'http://alphapump.local:3000/' });
    expect(config.updateBaseUrl).toBe('http://alphapump.local:3000/alphapump/download');
  });

  it('pozwala rozdzielić katalog wydań od API', () => {
    const config = parseAppConfig({
      apiUrl: 'http://alphapump.local:3000',
      updateBaseUrl: 'http://wydania.local/apk/',
    });
    expect(config.updateBaseUrl).toBe('http://wydania.local/apk');
  });

  it('traktuje puste obiekty z manifestu Expo Go jak brak konfiguracji Google', () => {
    // Klasyczny protokół manifestu Expo Go serializuje `null` w `extra` jako `{}`.
    const config = parseAppConfig({
      apiUrl: 'http://alphapump.local:3000',
      googleWebClientId: {},
      googleIosClientId: {},
    });

    expect(isGoogleSignInConfigured(config)).toBe(false);
  });
});
