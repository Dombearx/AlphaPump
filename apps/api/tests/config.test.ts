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
import { retentionDays } from '../src/cli/prune.js';

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

  it('nie wywala się na pustym TRIAGE_URL — tak Compose przekazuje brak tokenu', () => {
    // `docker-compose.yml` liczy `TRIAGE_URL` z `${TRIAGE_HTTP_TOKEN:+…}`: bez
    // tokenu do kontenera trafia pusty napis, nie brak zmiennej.
    expect(loadConfig({ ...MINIMAL, TRIAGE_URL: '', TRIAGE_HTTP_TOKEN: '' }).triage).toBeNull();
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

  it('trzyma dyktowanie wyłączone, dopóki nie ma obu dostawców naraz', () => {
    // Transkrypcja i model interpretujący tekst stoją u dwóch różnych dostawców,
    // więc sam klucz do jednego z nich nie wystarcza — a dyktowanie z połową
    // przepływu nie jest dyktowaniem, tylko mikrofonem, który zawsze odmawia.
    expect(loadConfig(MINIMAL).voice).toBeNull();
    expect(loadConfig({ ...MINIMAL, SPEECH_TO_TEXT_API_KEY: 'klucz' }).voice).toBeNull();
    expect(loadConfig({ ...MINIMAL, OPENROUTER_API_KEY: 'klucz' }).voice).toBeNull();
  });

  it('włącza dyktowanie przy komplecie kluczy i wyłącza je flagą', () => {
    const both = { ...MINIMAL, SPEECH_TO_TEXT_API_KEY: 'mowa', OPENROUTER_API_KEY: 'model' };

    expect(loadConfig(both).voice).toMatchObject({
      speechUrl: 'https://api.groq.com/openai/v1/audio/transcriptions',
      speechApiKey: 'mowa',
      speechModel: 'whisper-large-v3-turbo',
    });
    expect(loadConfig({ ...both, VOICE_ENABLED: 'false' }).voice).toBeNull();
    // Wyłącznik całej warstwy LLM-owej zabiera dyktowanie razem z resztą —
    // interpretacja transkrypcji jedzie tym samym kluczem co embeddingi.
    expect(loadConfig({ ...both, LLM_ENABLED: 'false' }).voice).toBeNull();
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

describe('okno retencji zadania porządkowego', () => {
  it('bez argumentu bierze wartość domyślną', () => {
    expect(retentionDays(undefined, 90)).toBe(90);
  });

  it('przyjmuje liczbę dni z wiersza poleceń', () => {
    expect(retentionDays('120', 90)).toBe(120);
  });

  /**
   * Cron podaje argumenty jako napisy i nikt ich po drodze nie waliduje.
   * Literówka nie może zamienić się w „zdejmij tombstone'y starsze niż NaN dni",
   * bo to jest operacja nieodwracalna na cudzej historii treningowej.
   */
  it('odrzuca to, co nie jest dodatnią liczbą dni', () => {
    expect(() => retentionDays('0', 90)).toThrow();
    expect(() => retentionDays('-5', 90)).toThrow();
    expect(() => retentionDays('dużo', 90)).toThrow();
  });
});
