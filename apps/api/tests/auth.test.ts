/**
 * Autoryzacja. Zakres wprost:
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

  it('wystawia tokeny na ścieżkach, których używa ekran w aplikacji', async () => {
    // Ekran „Konto → Tokeny API" woła te trzy ścieżki wprost, bez wtyczki
    // klienckiej (patrz `apps/mobile/src/screens/api-keys.tsx`). Gdyby któraś
    // zmieniła kształt przy aktualizacji better-autha, nie zauważyłby tego ani
    // typecheck, ani żaden inny test — a ekran przestałby działać po cichu.
    const user = await harness.signUp('zarzadzanie-tokenami@example.com');
    const headers = { 'Content-Type': 'application/json', ...user.headers };

    const created = await harness.json<{ id: string; key: string; name: string; start: string }>(
      'POST',
      '/api/auth/api-key/create',
      { headers, body: { name: 'bot Discord' } },
    );
    expect(created.status).toBe(200);
    expect(created.body.name).toBe('bot Discord');
    // Lista pokazuje wyłącznie początek tokenu, więc `start` musi przyjechać.
    expect(created.body.start).toBeTruthy();

    // Lista przyjeżdża w kopercie `{ apiKeys, total }`, a nie jako tablica —
    // aplikacja rozpakowuje ją w `readApiKeyList`.
    const listed = await harness.json<{ apiKeys: { id: string; start: string }[] }>(
      'GET',
      '/api/auth/api-key/list',
      { headers },
    );
    expect(listed.status).toBe(200);
    expect(listed.body.apiKeys.map((key) => key.id)).toContain(created.body.id);
    // Sekret jest nie do odzyskania — lista nie może go nieść.
    expect(JSON.stringify(listed.body)).not.toContain(created.body.key);

    const removed = await harness.json('POST', '/api/auth/api-key/delete', {
      headers,
      body: { keyId: created.body.id },
    });
    expect(removed.status).toBe(200);

    // Unieważniony token przestaje wpuszczać do danych.
    const rejected = await harness.json('GET', '/me', {
      headers: { 'x-api-key': created.body.key },
    });
    expect(rejected.status).toBe(401);
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

  /**
   * Limit prób logowania (`rateLimit` w `src/auth.ts`).
   *
   * Test istnieje dlatego, że licznik siedzi w bazie, a nie w pamięci procesu —
   * a to jest dokładnie ta zmiana, której nie widać w żadnym innym teście
   * i która psuje się cicho: przy braku tabeli `rate_limits` albo przy
   * rozjeździe jej kolumn z tym, czego szuka better-auth, limit po prostu
   * przestaje działać, zamiast rzucić błędem.
   */
  it('ucina lawinę prób logowania', async () => {
    const user = await harness.signUp('lawina@example.com');

    const attempt = () =>
      harness.request('/api/auth/sign-in/email', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: user.email, password: 'zle-haslo-do-zgadywania' }),
      });

    const statuses: number[] = [];
    for (let index = 0; index < 12; index += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses).toContain(429);
    // Poprawne hasło też odbija się od limitu — inaczej wystarczyłoby zgadywać
    // dalej, byle z prawidłową odpowiedzią na końcu.
    const afterLimit = await harness.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, password: user.password }),
    });
    expect(afterLimit.status).toBe(429);
  });
});
