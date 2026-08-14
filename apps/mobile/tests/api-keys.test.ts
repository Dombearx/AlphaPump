/**
 * Tokeny API — reguły listy i nazwy.
 *
 * Ekran jest cienki, więc testy celują w to, co jest pod nim: zawężenie
 * odpowiedzi serwera, porządek listy i walidację nazwy. Sieci tu nie ma —
 * tokeny wydaje better-auth, a to jest sprawdzone po stronie API
 * (`apps/api/tests/auth.test.ts`).
 */

import { describe, expect, it } from 'vitest';
import {
  API_KEY_NAME_MAX_LENGTH,
  UNNAMED_API_KEY,
  apiKeyNameProblem,
  describeApiKey,
  maskApiKey,
  normalizeApiKeyName,
  readApiKeyList,
  toApiKeySummaries,
  type ApiKeySummary,
} from '../src/api-keys';

const TODAY = '2026-08-12';

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: 'key-1',
    name: 'bot Discord',
    start: 'ap_1234',
    createdAt: '2026-08-10T10:00:00.000Z',
    lastRequest: null,
    ...overrides,
  };
}

describe('zawężanie odpowiedzi', () => {
  it('bierze z odpowiedzi wyłącznie pola, na których stoi ekran', () => {
    const [key] = toApiKeySummaries([
      row({ enabled: true, rateLimitMax: 120, permissions: null, metadata: null }),
    ]);

    expect(key).toEqual({
      id: 'key-1',
      name: 'bot Discord',
      start: 'ap_1234',
      createdAt: new Date('2026-08-10T10:00:00.000Z'),
      lastUsedAt: null,
    });
  });

  it('przyjmuje datę zarówno jako obiekt, jak i jako napis ISO', () => {
    const asDate = toApiKeySummaries([row({ createdAt: new Date('2026-08-10T10:00:00.000Z') })]);
    const asText = toApiKeySummaries([row({ createdAt: '2026-08-10T10:00:00.000Z' })]);

    expect(asDate[0]?.createdAt).toEqual(asText[0]?.createdAt);
  });

  it('podstawia etykietę zastępczą za brak nazwy', () => {
    expect(toApiKeySummaries([row({ name: null })])[0]?.name).toBe(UNNAMED_API_KEY);
    expect(toApiKeySummaries([row({ name: '   ' })])[0]?.name).toBe(UNNAMED_API_KEY);
  });

  it('pomija wiersz w nieznanym kształcie, zamiast wywracać listę', () => {
    // Jeden dziwny wpis nie może odciąć użytkownika od unieważnienia reszty.
    const keys = toApiKeySummaries([row(), { id: 42 }, null, row({ id: 'key-2' })]);

    expect(keys.map((key) => key.id)).toEqual(['key-1', 'key-2']);
  });

  it('układa najnowsze u góry, a remis rozstrzyga stabilnie', () => {
    const keys = toApiKeySummaries([
      row({ id: 'b', createdAt: '2026-08-10T10:00:00.000Z' }),
      row({ id: 'c', createdAt: '2026-08-11T10:00:00.000Z' }),
      row({ id: 'a', createdAt: '2026-08-10T10:00:00.000Z' }),
    ]);

    expect(keys.map((key) => key.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('odczyt listy z odpowiedzi serwera', () => {
  it('wyjmuje tokeny z koperty, którą oddaje better-auth', () => {
    // `GET /api/auth/api-key/list` zwraca `{ apiKeys, total }`, a nie tablicę.
    const keys = readApiKeyList({ apiKeys: [row(), row({ id: 'key-2' })], total: 2 });

    expect(keys.map((key) => key.id)).toEqual(['key-1', 'key-2']);
  });

  it('z nierozpoznanej odpowiedzi robi pustą listę, a nie błąd', () => {
    // Ekran ma wtedy powiedzieć „nie masz tokenów", a nie zamienić się w awarię.
    expect(readApiKeyList([row()])).toEqual([]);
    expect(readApiKeyList(null)).toEqual([]);
    expect(readApiKeyList({ total: 0 })).toEqual([]);
  });
});

describe('nazwa tokenu', () => {
  it('sprząta spacje', () => {
    expect(normalizeApiKeyName('  bot   Discord  ')).toBe('bot Discord');
  });

  it('przycina do dopuszczalnej długości', () => {
    expect(normalizeApiKeyName('x'.repeat(100))).toHaveLength(API_KEY_NAME_MAX_LENGTH);
  });

  it('wymaga nazwy, bo po niej poznaje się token do unieważnienia', () => {
    expect(apiKeyNameProblem('   ')).not.toBeNull();
    expect(apiKeyNameProblem('bot')).toBeNull();
  });
});

describe('opis tokenu', () => {
  const key: ApiKeySummary = {
    id: 'key-1',
    name: 'bot Discord',
    start: 'ap_1234',
    createdAt: new Date('2026-08-10T10:00:00.000Z'),
    lastUsedAt: null,
  };

  it('mówi wprost, że token nigdy nie był używany', () => {
    expect(describeApiKey(key, TODAY)).toBe('created 10 August · never used');
  });

  it('pokazuje datę ostatniego użycia, gdy token pracuje', () => {
    const used = { ...key, lastUsedAt: new Date('2026-08-12T06:00:00.000Z') };

    expect(describeApiKey(used, TODAY)).toBe('created 10 August · last used 12 August');
  });

  it('pokazuje wyłącznie początek tokenu — reszty serwer już nie zna', () => {
    expect(maskApiKey(key)).toBe('ap_1234••••');
    expect(maskApiKey({ ...key, start: null })).toBe('••••');
  });
});
