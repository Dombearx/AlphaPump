/**
 * Healthcheck.
 *
 * Sprawdza to, czego brak faktycznie unieruchamia API: połączenie z bazą.
 * Endpoint zwracający `ok` bez odpytania bazy potwierdza jedynie, że proces
 * żyje — a proces żyjący z martwą bazą to dokładnie ta awaria, którą monitoring
 * ma wychwycić.
 */

import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import type { RouteSpec } from '../openapi.js';

const healthResponseSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['up', 'down']),
  uptimeS: z.number(),
});

export const healthRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/health',
    summary: 'Stan serwera',
    description: 'Zwraca 503, gdy baza jest nieosiągalna.',
    tag: 'system',
    security: 'none',
    responses: [
      { status: 200, description: 'Serwer i baza działają', schema: healthResponseSchema },
      { status: 503, description: 'Baza nieosiągalna', schema: healthResponseSchema },
    ],
  },
];

export function createHealthRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();

  router.get('/health', async (context) => {
    let database: 'up' | 'down' = 'up';
    try {
      await dependencies.db.execute(sql`SELECT 1`);
    } catch {
      database = 'down';
    }

    const body = {
      status: database === 'up' ? ('ok' as const) : ('degraded' as const),
      database,
      uptimeS: Math.round(process.uptime()),
    };
    return context.json(body, database === 'up' ? 200 : 503);
  });

  return router;
}
