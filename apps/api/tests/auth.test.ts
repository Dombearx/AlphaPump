/**
 * Autoryzacja — kryterium ukończenia etapu 3 wprost:
 *
 * > można założyć konto, zalogować się oboma metodami, wygenerować token API
 * > i wykonać nim CRUD serii.
 *
 * Logowanie Google jest tu sprawdzone do granicy, do której da się je sprawdzić
 * bez Google: że provider jest zarejestrowany i że endpoint go zna. Sam obieg
 * `idToken` weryfikują klucze publiczne Google, więc jego test wymagałby
 * wystawienia na zewnątrz sieci.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

describe('autoryzacja', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('zakłada konto e-mailem i hasłem', async () => {
    const user = await harness.signUp('rejestracja@example.com');
    expect(user.id).toMatch(/^[0-9a-f-]{36}$/);

    const me = await harness.json<{ email: string; role: string; credential: string }>(
      'GET',
      '/me',
      { headers: user.headers },
    );
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('rejestracja@example.com');
    expect(me.body.role).toBe('user');
    expect(me.body.credential).toBe('session');
  });

  it('nadaje nick, mimo że rejestracja e-mailem o niego nie pyta', async () => {
    const user = await harness.signUp('nick@example.com', 'haslo-testowe-123', 'Kuba');
    const me = await harness.json<{ nickname: string }>('GET', '/me', { headers: user.headers });
    expect(me.body.nickname).toBe('Kuba');
  });

  it('loguje ponownie tym samym hasłem', async () => {
    const user = await harness.signUp('logowanie@example.com');
    const headers = await harness.signIn(user.email, user.password);

    const me = await harness.json<{ email: string }>('GET', '/me', { headers });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('logowanie@example.com');
  });

  it('odrzuca logowanie złym hasłem', async () => {
    await harness.signUp('zlehaslo@example.com');
    const response = await harness.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'zlehaslo@example.com', password: 'nie-to-haslo' }),
    });
    expect(response.ok).toBe(false);
  });

  it('zna logowanie przez Google', async () => {
    // Bez `idToken` endpoint musi odmówić — ale ma odmówić dlatego, że brakuje
    // tokenu, a nie dlatego, że nie wie, czym jest Google.
    const response = await harness.request('/api/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'google', idToken: { token: 'nieprawidlowy' } }),
    });
    const body = await response.text();
    expect(response.ok).toBe(false);
    expect(body).not.toMatch(/provider not found/i);
  });

  it('bez uwierzytelnienia nie wpuszcza do danych', async () => {
    const response = await harness.json<{ error: { code: string } }>('GET', '/sets');
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('generuje token API i wpuszcza nim do danych', async () => {
    const user = await harness.signUp('token@example.com');
    const key = await harness.createApiKey(user);

    const me = await harness.json<{ email: string; credential: string }>('GET', '/me', {
      headers: { 'x-api-key': key },
    });
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('token@example.com');
    expect(me.body.credential).toBe('api-key');
  });

  it('pozwala mieć wiele tokenów API naraz', async () => {
    const user = await harness.signUp('wiele-tokenow@example.com');
    const first = await harness.createApiKey(user, 'bot');
    const second = await harness.createApiKey(user, 'skrypt');

    expect(first).not.toBe(second);
    for (const key of [first, second]) {
      const me = await harness.json('GET', '/me', { headers: { 'x-api-key': key } });
      expect(me.status).toBe(200);
    }
  });

  it('odrzuca zmyślony token API', async () => {
    const response = await harness.json<{ error: { code: string } }>('GET', '/me', {
      headers: { 'x-api-key': 'zmyslony-klucz' },
    });
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('unauthorized');
  });

  it('healthcheck odpowiada bez uwierzytelnienia', async () => {
    const response = await harness.json<{ status: string; database: string }>('GET', '/health');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: 'ok', database: 'up' });
  });
});
