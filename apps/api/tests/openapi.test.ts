/**
 * OpenAPI.
 *
 * Najważniejszy jest tu test parzystości: **każda trasa zarejestrowana w Hono
 * musi mieć swój opis, i odwrotnie.** Dokumentacja, która milczy o nowym
 * endpoincie albo opisuje endpoint już usunięty, jest gorsza niż jej brak —
 * bot Discord czyta ją jako kontrakt.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { API_VERSION, documentedRoutes } from '../src/app.js';
import { buildOpenApiDocument, toOpenApiPath } from '../src/openapi.js';
import { createHarness, TEST_CONFIG, type Harness } from './harness.js';

/** Trasy obsługiwane przez better-auth i sam dokument OpenAPI — poza opisem. */
const NOT_DOCUMENTED = ['/api/auth/*', '/openapi.json', '/*'];

describe('OpenAPI', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('wystawia dokument bez uwierzytelnienia', async () => {
    const response = await harness.json<Record<string, unknown>>('GET', '/openapi.json');
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ openapi: '3.1.0' });
    expect(response.body.info).toMatchObject({ title: 'AlphaPump API', version: API_VERSION });
  });

  it('opisuje wszystkie trasy CRUD i healthcheck', () => {
    const document = buildOpenApiDocument(documentedRoutes, {
      title: 'AlphaPump API',
      version: API_VERSION,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    const paths = document.paths as Record<string, Record<string, unknown>>;

    for (const path of ['/health', '/me', '/tags', '/exercises', '/sets', '/cycles']) {
      expect(Object.keys(paths)).toContain(path);
    }
    expect(Object.keys(paths['/sets/{id}'] ?? {}).sort()).toEqual(['delete', 'get', 'patch']);
  });

  it('zamienia parametry ścieżki na notację OpenAPI', () => {
    expect(toOpenApiPath('/sets/:id')).toBe('/sets/{id}');
    expect(toOpenApiPath('/health')).toBe('/health');
  });

  it('opisuje uwierzytelnienie sesją i kluczem API, a healthcheck zostawia otwarty', () => {
    const document = buildOpenApiDocument(documentedRoutes, {
      title: 'AlphaPump API',
      version: API_VERSION,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    const paths = document.paths as Record<string, Record<string, Record<string, unknown>>>;

    expect(paths['/sets']?.get?.security).toEqual([{ sessionCookie: [] }, { apiKey: [] }]);
    expect(paths['/health']?.get?.security).toBeUndefined();
  });

  it('generuje schematy ciała żądania z tych samych schematów Zod', () => {
    const document = buildOpenApiDocument(documentedRoutes, {
      title: 'AlphaPump API',
      version: API_VERSION,
      baseUrl: TEST_CONFIG.baseUrl,
    });
    const paths = document.paths as Record<string, Record<string, Record<string, never>>>;
    const body = paths['/sets']?.post?.requestBody as
      | { content: { 'application/json': { schema: { properties: Record<string, unknown> } } } }
      | undefined;

    const properties = body?.content['application/json'].schema.properties ?? {};
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['exerciseId', 'performedOn', 'weightG', 'reps']),
    );
  });

  it('każda trasa Hono ma swój opis i odwrotnie', async () => {
    // Sięgamy po tabelę tras samej aplikacji, żeby test nie opierał się na
    // pamięci autora — nowy endpoint bez opisu wywali ten test od razu.
    const { createApp } = await import('../src/app.js');
    const { createAuth } = await import('../src/auth.js');
    const app = createApp(
      { db: harness.db, auth: createAuth(harness.db, TEST_CONFIG) },
      TEST_CONFIG,
    );

    const registered = new Set(
      app.routes
        .filter((route) => route.method !== 'ALL' && !NOT_DOCUMENTED.includes(route.path))
        // Middleware rejestruje się na `*`; interesują nas same handlery tras.
        .filter((route) => !route.path.endsWith('*'))
        .map((route) => `${route.method.toLowerCase()} ${route.path}`),
    );

    const documented = new Set(documentedRoutes.map((route) => `${route.method} ${route.path}`));

    expect([...registered].sort()).toEqual([...documented].sort());
  });
});
