/**
 * Stan konta po stronie serwera i zmiana hasła tymczasowego.
 *
 * Warstwa jest cienka, ale stoi na ścieżce, która potrafi zablokować wejście do
 * aplikacji, więc sprawdzamy dokładnie to, co o tym decyduje: że odpowiedź
 * przechodzi przez schemat, że brak sieci jest „offline", a nie awarią (telefon
 * bez VPN-u ma zapisywać serie dalej), i że zmiana hasła idzie POST-em z sesją.
 */

import { describe, expect, it, vi } from 'vitest';
import { createAccountClient } from '../src/remote/account';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../src/sync/transport';

const ACCOUNT = {
  id: '00000000-0000-7000-8000-00000000000a',
  email: 'kuba@example.com',
  nickname: 'Kuba',
  role: 'user',
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
  deletedAt: null,
  credential: 'session',
  mustChangePassword: true,
};

const client = (fetchImpl: typeof fetch) =>
  createAccountClient({ baseUrl: 'http://api.test', cookie: () => 'sesja=abc', fetchImpl });

const respond = (body: unknown, status = 200) =>
  vi.fn(
    async () => new Response(body === null ? null : JSON.stringify(body), { status }),
  ) as unknown as typeof fetch;

describe('stan konta', () => {
  it('czyta flagę hasła tymczasowego i wysyła sesję', async () => {
    const fetchImpl = respond(ACCOUNT);

    const account = await client(fetchImpl).me();

    expect(account.mustChangePassword).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/me',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ cookie: 'sesja=abc' }),
      }),
    );
  });

  it('odpowiedź o nieznanym kształcie jest błędem serwera, a nie wpuszczana dalej', async () => {
    const fetchImpl = respond({ id: ACCOUNT.id });
    await expect(client(fetchImpl).me()).rejects.toBeInstanceOf(SyncServerError);
  });

  it('brak łączności znaczy offline, a nie awarię', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('Network request failed')),
    ) as unknown as typeof fetch;

    await expect(client(fetchImpl).me()).rejects.toBeInstanceOf(SyncOfflineError);
  });

  it('wygasła sesja jest błędem uwierzytelnienia', async () => {
    const fetchImpl = respond({ error: { code: 'unauthorized', message: 'nope' } }, 401);
    await expect(client(fetchImpl).me()).rejects.toBeInstanceOf(SyncAuthError);
  });
});

describe('ustawienie własnego hasła', () => {
  it('idzie POST-em na /me/password', async () => {
    const fetchImpl = respond(null, 204);

    await client(fetchImpl).setPassword('moje-wlasne-haslo');

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/me/password',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ newPassword: 'moje-wlasne-haslo' }),
      }),
    );
  });

  it('hasło krótsze niż minimum odpada przed lotem do API', async () => {
    const fetchImpl = respond(null, 204);

    await expect(client(fetchImpl).setPassword('krótkie')).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
