/**
 * Synchronizacja — obie strony protokołu wymiany danych.
 *
 * Dwa endpointy i jedna reguła: telefon wysyła to, co ma w outboxie, i pobiera
 * wszystko, co pojawiło się za jego kursorem. Rozstrzyganie konfliktów siedzi
 * w `@alphapump/core`, więc telefon liczy je tym samym kodem — patrz
 * `src/sync/push.ts` i `src/sync/pull.ts`.
 *
 * Trzeci endpoint, `POST /sync/tombstones/prune`, jest zadaniem porządkowym
 * administratora, a nie częścią przepływu urządzenia.
 */

import {
  syncPullQuerySchema,
  syncPullResponseSchema,
  syncPushRequestSchema,
  syncPushResponseSchema,
} from '@alphapump/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { validateJson, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { recomputeDerived } from '../sync/derived.js';
import { pullChanges } from '../sync/pull.js';
import { applyPush } from '../sync/push.js';
import {
  DEFAULT_TOMBSTONE_RETENTION_DAYS,
  pruneTombstones,
  retentionCutoff,
} from '../sync/tombstones.js';

export const pruneTombstonesBodySchema = z.object({
  /**
   * Wiersze usunięte dawniej niż tyle dni temu znikają na dobre. Okno musi być
   * dłuższe niż najdłuższa realna przerwa w synchronizacji — urządzenie, które
   * przespało tombstone, przywiozłoby usuniętą serię z powrotem.
   */
  olderThanDays: z.int().min(1).max(3650).default(DEFAULT_TOMBSTONE_RETENTION_DAYS),
});

export const pruneTombstonesResponseSchema = z.object({
  removed: z.object({
    sets: z.int().min(0),
    cycles: z.int().min(0),
    exercises: z.int().min(0),
    tags: z.int().min(0),
  }),
});

export const syncRoutes: RouteSpec[] = [
  {
    method: 'post',
    path: '/sync/push',
    summary: 'Wysłanie mutacji z urządzenia',
    description:
      'Każdy wiersz rozstrzygany jest osobno — jeden odrzucony nie zatrzymuje ' +
      'paczki, bo zatrzymałby outbox urządzenia na zawsze. Odpowiedź zwraca stan ' +
      'serwerowy dla wszystkich wierszy z paczki, także tych przyjętych: serwer ' +
      'przycina znaczniki czasu z przyszłości, więc przyjęty wiersz też potrafi ' +
      'wrócić inny, niż pojechał.',
    tag: 'synchronizacja',
    security: 'user',
    body: syncPushRequestSchema,
    responses: [
      { status: 200, description: 'Paczka rozstrzygnięta', schema: syncPushResponseSchema },
      { status: 400, description: 'Paczka nie przeszła walidacji' },
    ],
  },
  {
    method: 'get',
    path: '/sync/pull',
    summary: 'Pobranie zmian od kursora',
    description:
      'Kursorem jest `server_seq` — jeden dla wszystkich tabel. Paczka jest ' +
      'posortowana chronologicznie względem zapisu na serwerze, a nie względem ' +
      'zależności, więc transakcja po stronie telefonu odracza sprawdzanie ' +
      'kluczy obcych do `COMMIT`. Tombstone’y schodzą razem z resztą — to jedyny ' +
      'sposób, w jaki usunięcie dociera na drugie urządzenie.',
    tag: 'synchronizacja',
    security: 'user',
    query: syncPullQuerySchema,
    responses: [{ status: 200, description: 'Paczka zmian', schema: syncPullResponseSchema }],
  },
  {
    method: 'post',
    path: '/sync/tombstones/prune',
    summary: 'Porządkowanie tombstone’ów',
    description:
      'Zdejmuje wiersze usunięte dawniej niż okno retencji, ale wyłącznie takie, ' +
      'na które nic już nie wskazuje — usunięcie twarde łamie spójność, którą ' +
      'usunięcie miękkie utrzymuje.',
    tag: 'synchronizacja',
    security: 'admin',
    body: pruneTombstonesBodySchema,
    responses: [
      {
        status: 200,
        description: 'Liczba zdjętych wierszy',
        schema: pruneTombstonesResponseSchema,
      },
    ],
  },
];

export function createSyncRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const recomputations = dependencies.derived ?? [];

  router.post('/sync/push', validateJson(syncPushRequestSchema), async (context) => {
    const principal = context.get('principal');
    const now = new Date();

    const outcome = await applyPush(db, principal, context.req.valid('json'), now);
    await recomputeDerived(db, outcome.scope, recomputations);

    return context.json({
      serverTime: now.toISOString(),
      cursor: outcome.cursor,
      results: outcome.results,
      changes: outcome.changes,
    });
  });

  router.get('/sync/pull', validateQuery(syncPullQuerySchema), async (context) => {
    const principal = context.get('principal');
    const query = context.req.valid('query');
    return context.json(await pullChanges(db, principal, query, new Date()));
  });

  router.post(
    '/sync/tombstones/prune',
    requireAdmin,
    validateJson(pruneTombstonesBodySchema),
    async (context) => {
      const { olderThanDays } = context.req.valid('json');
      const removed = await pruneTombstones(db, retentionCutoff(olderThanDays, new Date()));
      return context.json({ removed });
    },
  );

  return router;
}
