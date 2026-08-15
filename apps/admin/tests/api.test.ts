/**
 * Klient API panelu.
 *
 * Testujemy tę warstwę, bo tu mieszkają błędy niewidoczne na ekranie: pomylona
 * metoda, zgubione ciasteczko sesji, odpowiedź o innym kształcie przyjęta bez
 * mrugnięcia. Renderowania komponentów tu nie ma świadomie — dla panelu tej
 * wielkości test „czy tabela się wyświetliła" sprawdzałby głównie Reacta, za cenę
 * całego stosu jsdom w CI.
 *
 * Atrapa `fetch` jest podawana jawnie, a nie podmieniana globalnie: test, który
 * nadpisuje globalny `fetch`, potrafi rozlać się na inne testy w tym samym
 * procesie.
 */

import { describe, expect, it } from 'vitest';
import {
  ApiError,
  createExercise,
  createTag,
  listUsers,
  pruneTombstones,
  request,
  updateExercise,
} from '../src/lib/api';
import { z } from 'zod';

interface Call {
  url: string;
  init: RequestInit;
}

/** Atrapa `fetch`: oddaje zadaną odpowiedź i notuje, o co ją poproszono. */
function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const impl = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    // `null` zamiast pustego napisu: konstruktor `Response` nie przyjmuje ciała
    // przy statusie 204, a to jest dokładnie ten przypadek, który sprawdzamy.
    return Promise.resolve(
      new Response(body === null ? null : JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;

  return { calls, impl };
}

const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'kuba@example.com',
  nickname: 'Kuba',
  role: 'user',
  banned: false,
  banReason: null,
  setCount: 3,
  exerciseCount: 1,
  createdAt: '2026-08-01T08:00:00.000Z',
  updatedAt: '2026-08-01T08:00:00.000Z',
  deletedAt: null,
};

describe('request', () => {
  it('wysyła ciasteczko sesji — bez niego API nie rozpozna administratora', async () => {
    const fake = fakeFetch(200, { users: [] });
    await listUsers(fake.impl);

    expect(fake.calls[0]?.init.credentials).toBe('include');
    expect(fake.calls[0]?.url).toContain('/admin/users');
  });

  it('zamienia błąd API w czytelny wyjątek z kodem', async () => {
    const fake = fakeFetch(403, {
      error: { code: 'forbidden', message: 'Operacja zastrzeżona dla administratora' },
    });

    await expect(listUsers(fake.impl)).rejects.toMatchObject({
      name: 'ApiError',
      status: 403,
      code: 'forbidden',
      message: 'Operacja zastrzeżona dla administratora',
    });
  });

  it('odpowiedź błędu bez znanego kształtu też daje sensowny komunikat', async () => {
    const fake = fakeFetch(502, 'Bad Gateway');
    await expect(listUsers(fake.impl)).rejects.toThrow(/502/);
  });

  it('odrzuca odpowiedź o nieznanym kształcie, zamiast wpuszczać ją na ekran', async () => {
    const fake = fakeFetch(200, { users: [{ email: 'kuba@example.com' }] });

    const failure = await listUsers(fake.impl).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe('schema_mismatch');
  });

  it('czyta listę kont, gdy odpowiedź jest zgodna z kontraktem rdzenia', async () => {
    const fake = fakeFetch(200, { users: [USER] });
    const users = await listUsers(fake.impl);

    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({ nickname: 'Kuba', setCount: 3 });
  });

  it('pusta odpowiedź 204 przechodzi jako brak treści', async () => {
    const fake = fakeFetch(204, null);
    await expect(
      request('/exercises/x', z.null(), { method: 'DELETE', fetchImpl: fake.impl }),
    ).resolves.toBeNull();
  });
});

describe('mutacje', () => {
  it('zmiana ćwiczenia idzie PATCH-em z samą łatką', async () => {
    const fake = fakeFetch(200, {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Zwis jednoręczny',
      slug: 'zwis-jednoreczny',
      authorId: USER.id,
      loggingType: 'bodyweight_time',
      primaryTagId: '33333333-3333-4333-8333-333333333333',
      additionalTagIds: [],
      note: null,
      gym: null,
      createdAt: USER.createdAt,
      updatedAt: USER.updatedAt,
      deletedAt: null,
    });

    await updateExercise(
      '22222222-2222-4222-8222-222222222222',
      { name: 'Zwis jednoręczny' },
      fake.impl,
    );

    const call = fake.calls[0];
    expect(call?.init.method).toBe('PATCH');
    expect(call?.init.body).toBe(JSON.stringify({ name: 'Zwis jednoręczny' }));
  });

  it('utworzenie ćwiczenia idzie POST-em z kompletem pól', async () => {
    const fake = fakeFetch(201, {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Zwis jednoręczny',
      slug: 'zwis-jednoreczny',
      authorId: USER.id,
      loggingType: 'bodyweight_time',
      primaryTagId: '33333333-3333-4333-8333-333333333333',
      additionalTagIds: [],
      note: null,
      gym: null,
      createdAt: USER.createdAt,
      updatedAt: USER.updatedAt,
      deletedAt: null,
    });

    await createExercise(
      {
        name: 'Zwis jednoręczny',
        loggingType: 'bodyweight_time',
        primaryTagId: '33333333-3333-4333-8333-333333333333',
        additionalTagIds: [],
        note: null,
        gym: null,
      },
      fake.impl,
    );

    const call = fake.calls[0];
    expect(call?.url).toMatch(/\/exercises$/);
    expect(call?.init.method).toBe('POST');
  });

  it('utworzenie tagu nie podaje koloru — wylicza go serwer', async () => {
    // Kolor jest funkcją nazwy, żeby tag utworzony offline miał od razu
    // finalny kolor. Panel, który by go wysyłał, byłby drugim źródłem prawdy.
    const fake = fakeFetch(201, {
      id: '33333333-3333-4333-8333-333333333333',
      name: 'Plecy',
      slug: 'plecy',
      color: '#4ade80',
      createdAt: USER.createdAt,
      updatedAt: USER.updatedAt,
      deletedAt: null,
    });

    await createTag('Plecy', fake.impl);

    expect(fake.calls[0]?.init.method).toBe('POST');
    expect(fake.calls[0]?.init.body).toBe(JSON.stringify({ name: 'Plecy' }));
  });

  it('porządkowanie tombstone’ów nie narzuca okna retencji — to wie serwer', async () => {
    const fake = fakeFetch(200, { removed: { sets: 2, cycles: 0, exercises: 1, tags: 0 } });
    const result = await pruneTombstones(fake.impl);

    expect(fake.calls[0]?.init.body).toBe('{}');
    expect(result.removed.sets).toBe(2);
  });
});
