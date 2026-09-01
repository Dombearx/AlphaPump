/**
 * Komunikat o odpowiedzi, która nie przeszła schematu.
 *
 * Sprawdzamy dokładnie to, po co ten opis istnieje: że ze zgłoszenia zwrotnego
 * da się wskazać **wiersz w bazie** — pole, powód i identyfikator — bo bez tego
 * „Pull response has an unknown shape" nie mówi nic poza tym, że coś jest nie
 * tak, a paczka pullu potrafi mieć pięćset wierszy.
 */

import { syncPullResponseSchema } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import { createHttpTransport, SyncServerError } from '../src/sync/transport';

const USER = '00000000-0000-7000-8000-00000000000a';
const TAG = '00000000-0000-7000-8000-00000000000b';
const EXERCISE = '00000000-0000-7000-8000-00000000000c';

const AT = '2026-08-31T07:38:35.982Z';
const sync = { createdAt: AT, updatedAt: AT, deletedAt: null };

const exercise = (overrides: Record<string, unknown> = {}) => ({
  id: EXERCISE,
  name: 'Przysiad ze sztangą',
  slug: 'przysiad-ze-sztanga',
  authorId: USER,
  loggingType: 'weight_reps',
  primaryTagId: TAG,
  additionalTagIds: [],
  note: null,
  gym: null,
  translations: null,
  ...sync,
  serverSeq: 412,
  ...overrides,
});

const pullBody = (changes: Record<string, unknown>) => ({
  serverTime: AT,
  cursor: 412,
  hasMore: false,
  changes: { users: [], tags: [], exercises: [], cycles: [], sets: [], ...changes },
});

const transport = (body: unknown) =>
  createHttpTransport({
    baseUrl: 'http://api.test',
    cookie: () => 'sesja=abc',
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch,
  });

/** Powód odmowy tak, jak zobaczy go człowiek czytający zgłoszenie. */
const messageOf = async (body: unknown): Promise<string> => {
  try {
    await transport(body).pull(0);
  } catch (error) {
    expect(error).toBeInstanceOf(SyncServerError);
    return (error as SyncServerError).message;
  }
  throw new Error('Odpowiedź przeszła schemat, a nie powinna');
};

describe('odpowiedź pullu o nieznanym kształcie', () => {
  it('nazywa pole, powód i wiersz, którego dotyczy', async () => {
    // Dokładnie ten wiersz, na którym wykładały się pull #85 i #89: nazwa bez
    // jednej litery i cyfry, więc bez sluga, więc poza `displayNameSchema`.
    const message = await messageOf(pullBody({ exercises: [exercise({ name: '—' })] }));

    expect(message).toContain('changes.exercises[0].name');
    expect(message).toContain('literę');
    expect(message).toContain(`id ${EXERCISE}`);
    expect(message).toContain('server_seq 412');
  });

  it('wskazuje wiersz także wtedy, gdy niezgodny jest cały wiersz, a nie pole', async () => {
    const message = await messageOf(
      pullBody({
        cycles: [
          {
            id: TAG,
            userId: USER,
            name: 'Cykl',
            startsOn: '2026-08-01',
            endsOn: null,
            archivedAt: null,
            goals: [],
            ...sync,
            serverSeq: 77,
          },
        ],
      }),
    );

    expect(message).toContain('changes.cycles[0].goals');
    expect(message).toContain(`id ${TAG}`);
    expect(message).toContain('server_seq 77');
  });

  it('liczy pozostałe znaleziska, żeby było widać skalę', async () => {
    const message = await messageOf(
      pullBody({ exercises: [exercise({ name: '—', slug: 'Przysiad' })] }),
    );

    expect(message).toMatch(/\(\+\d+ more\)/);
  });

  it('nie niesie wartości pól — log jedzie na serwer', async () => {
    const message = await messageOf(
      pullBody({ exercises: [exercise({ note: 'x'.repeat(1001) })] }),
    );

    expect(message).toContain('changes.exercises[0].note');
    expect(message).not.toContain('xxxxx');
  });

  it('radzi sobie z odpowiedzią, która nie jest nawet obiektem', async () => {
    const message = await messageOf('not json object');

    expect(message).toContain('Pull response has an unknown shape');
  });

  it('trzyma się limitu długości — komunikat idzie na ekran i do bufora logów', async () => {
    const message = await messageOf(pullBody({ exercises: [exercise({ name: '—' })] }));

    expect(message.length).toBeLessThanOrEqual(300);
  });
});

describe('odpowiedź, która schemat przechodzi', () => {
  it('wraca bez zmian', async () => {
    const body = pullBody({ exercises: [exercise()] });

    await expect(transport(body).pull(0)).resolves.toEqual(syncPullResponseSchema.parse(body));
  });
});
