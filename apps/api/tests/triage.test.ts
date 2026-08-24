/**
 * Klient usługi `services/triage`.
 *
 * Atrapa `fetch` jest podawana jawnie, tak samo jak w kliencie panelu
 * (`apps/admin/tests/api.test.ts`) — z tego samego powodu: nadpisanie
 * globalnego `fetch` potrafi rozlać się na inne testy w tym samym procesie.
 */

import { describe, expect, it } from 'vitest';
import type { ApiError } from '../src/errors.js';
import { createTriageClient } from '../src/triage.js';

interface Call {
  url: string;
  init: RequestInit;
}

function fakeFetch(status: number, body: unknown) {
  const calls: Call[] = [];
  const impl = ((url: string, init: RequestInit = {}) => {
    calls.push({ url, init });
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
  }) as unknown as typeof fetch;

  return { calls, impl };
}

const CONFIG = { url: 'http://triage:8090', token: 'sekret-tokenu' };

const REPORT = { scanned: 2, bugs: 1, changeRequests: 1, duplicates: 0, failures: [] };

describe('klient triage', () => {
  it('woła /run z tokenem w nagłówku', async () => {
    const { calls, impl } = fakeFetch(200, REPORT);
    const report = await createTriageClient(CONFIG, impl).runNow();

    expect(report).toEqual(REPORT);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('http://triage:8090/run');
    expect(calls[0]?.init.method).toBe('POST');
    expect((calls[0]?.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer sekret-tokenu',
    );
  });

  it('zamienia 409 z usługi na konflikt', async () => {
    const { impl } = fakeFetch(409, { error: 'już trwa' });

    await expect(createTriageClient(CONFIG, impl).runNow()).rejects.toMatchObject({
      code: 'conflict',
    } satisfies Partial<ApiError>);
  });

  it('zamienia inny błędny status na błąd wewnętrzny', async () => {
    const { impl } = fakeFetch(500, { error: 'awaria' });

    await expect(createTriageClient(CONFIG, impl).runNow()).rejects.toMatchObject({
      code: 'internal',
    } satisfies Partial<ApiError>);
  });

  it('odmawia odpowiedzi o nieznanym kształcie', async () => {
    const { impl } = fakeFetch(200, { coś: 'innego' });

    await expect(createTriageClient(CONFIG, impl).runNow()).rejects.toMatchObject({
      code: 'internal',
    } satisfies Partial<ApiError>);
  });

  it('zamienia awarię sieci na błąd wewnętrzny', async () => {
    const impl = (() =>
      Promise.reject(new Error('połączenie odrzucone'))) as unknown as typeof fetch;

    await expect(createTriageClient(CONFIG, impl).runNow()).rejects.toMatchObject({
      code: 'internal',
    } satisfies Partial<ApiError>);
  });
});
