/**
 * Reset hasła z panelu i wymuszona zmiana po zalogowaniu.
 *
 * Test przechodzi całą drogę, bo dopiero cała droga jest wymaganiem: poczty
 * w stosie nie ma, więc administrator nadaje hasło tymczasowe, przekazuje je
 * osobiście, a właściciel konta ustawia sobie własne przy pierwszym logowaniu.
 * Sprawdzane jest przy tym to, co odróżnia tę operację od zwykłej zmiany hasła:
 * stare sesje mają zniknąć, hasło jawne ma wrócić **raz**, a konto ma nie umieć
 * zostać przy haśle nadanym przez kogoś innego w ciszy.
 */

import type { AdminUser, PasswordResetResult } from '@alphapump/core';
import { SYSTEM_USER } from '@alphapump/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

interface Me {
  id: string;
  email: string;
  mustChangePassword: boolean;
}

describe('reset hasła przez administratora', () => {
  let harness: Harness;
  let admin: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    admin = await harness.signUp('szef@example.com', 'haslo-testowe-123', 'Szef');
    member = await harness.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
    await harness.promoteToAdmin(admin);
  });

  afterAll(async () => {
    await harness.close();
  });

  const reset = (id: string, headers: Record<string, string>) =>
    harness.json<PasswordResetResult>('POST', `/admin/users/${id}/reset-password`, { headers });

  it('jest zastrzeżony dla administratora', async () => {
    const denied = await reset(admin.id, member.headers);
    expect(denied.status).toBe(403);
  });

  it('nie dotyczy konta systemowego ani własnego', async () => {
    const system = await reset(SYSTEM_USER.id, admin.headers);
    expect(system.status).toBe(403);

    // Reset kasuje sesje konta — własne hasło resetowane stąd wylogowałoby
    // administratora w chwili, w której panel pokazuje mu hasło do przepisania.
    const self = await reset(admin.id, admin.headers);
    expect(self.status).toBe(409);
  });

  it('nie zna konta, którego nie ma', async () => {
    const missing = await reset('00000000-0000-7000-8000-000000000000', admin.headers);
    expect(missing.status).toBe(404);
  });

  it('nadaje hasło tymczasowe, którym da się zalogować, i unieważnia stare sesje', async () => {
    const response = await reset(member.id, admin.headers);

    expect(response.status).toBe(200);
    expect(response.body.userId).toBe(member.id);
    expect(response.body.email).toBe('kuba@example.com');
    expect(response.body.password.length).toBeGreaterThanOrEqual(8);

    // Sesja sprzed resetu przestaje istnieć — inaczej reset nie znaczyłby nic
    // dla telefonu, który jest już zalogowany.
    const stale = await harness.json('GET', '/me', { headers: member.headers });
    expect(stale.status).toBe(401);

    // Stare hasło nie działa, nowe działa.
    await expect(harness.signIn('kuba@example.com', 'haslo-testowe-123')).rejects.toThrow();
    member.headers = await harness.signIn('kuba@example.com', response.body.password);
    member.password = response.body.password;
  });

  it('konto z hasłem tymczasowym wie, że ma je zmienić', async () => {
    const me = await harness.json<Me>('GET', '/me', { headers: member.headers });
    expect(me.body.mustChangePassword).toBe(true);
  });

  it('panel widzi, że reset nadal czeka na odebranie', async () => {
    const list = await harness.json<{ users: AdminUser[] }>('GET', '/admin/users', {
      headers: admin.headers,
    });
    const kuba = list.body.users.find((user) => user.id === member.id);
    expect(kuba?.passwordResetAt).not.toBeNull();
  });

  it('hasło krótsze niż wymagane minimum nie przechodzi', async () => {
    const tooShort = await harness.json('POST', '/me/password', {
      body: { newPassword: 'krótkie' },
      headers: member.headers,
    });
    expect(tooShort.status).toBe(400);
  });

  it('właściciel konta ustawia własne hasło, a flaga znika', async () => {
    const changed = await harness.json('POST', '/me/password', {
      body: { newPassword: 'moje-wlasne-haslo' },
      headers: member.headers,
    });
    expect(changed.status).toBe(204);

    // Sesja, z której przyszło żądanie, działa dalej — człowiek nie wylatuje
    // z aplikacji w nagrodę za zrobienie tego, o co go poproszono.
    const me = await harness.json<Me>('GET', '/me', { headers: member.headers });
    expect(me.status).toBe(200);
    expect(me.body.mustChangePassword).toBe(false);

    // Hasło tymczasowe przestaje działać, własne działa.
    await expect(harness.signIn('kuba@example.com', member.password)).rejects.toThrow();
    await expect(harness.signIn('kuba@example.com', 'moje-wlasne-haslo')).resolves.toBeTruthy();

    const list = await harness.json<{ users: AdminUser[] }>('GET', '/admin/users', {
      headers: admin.headers,
    });
    expect(list.body.users.find((user) => user.id === member.id)?.passwordResetAt).toBeNull();
  });

  it('bez hasła tymczasowego zmiana tą drogą jest odmawiana', async () => {
    const again = await harness.json('POST', '/me/password', {
      body: { newPassword: 'jeszcze-inne-haslo' },
      headers: member.headers,
    });
    expect(again.status).toBe(409);
  });

  it('kluczem API hasła się nie zmienia', async () => {
    await reset(member.id, admin.headers);
    const headers = await harness.signIn('kuba@example.com', 'moje-wlasne-haslo').catch(() => null);
    expect(headers).toBeNull();

    const key = await harness.createApiKey(admin);
    const denied = await harness.json('POST', '/me/password', {
      body: { newPassword: 'haslo-z-klucza-api' },
      headers: { 'x-api-key': key },
    });
    expect(denied.status).toBe(403);
  });
});
