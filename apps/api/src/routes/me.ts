/**
 * Konto zalogowanego użytkownika.
 *
 * Jeden endpoint, ale potrzebny: bot Discord po wygenerowaniu tokenu musi mieć
 * czym sprawdzić, czyim tokenem właściwie dysponuje, a aplikacja — czy sesja
 * jeszcze żyje. Zwraca też, którą drogą przyszło uwierzytelnienie.
 */

import { userSchema } from '@alphapump/core';
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { toUserDto } from '../dto.js';
import { notFound } from '../errors.js';
import type { RouteSpec } from '../openapi.js';
import { users } from '../schema.js';

const meResponseSchema = userSchema.extend({
  credential: z.enum(['session', 'api-key']),
});

export const meRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/me',
    summary: 'Zalogowany użytkownik',
    tag: 'konto',
    security: 'user',
    responses: [{ status: 200, description: 'Dane konta', schema: meResponseSchema }],
  },
];

export function createMeRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();

  router.get('/me', async (context) => {
    const principal = context.get('principal');
    const [row] = await dependencies.db
      .select()
      .from(users)
      .where(eq(users.id, principal.id))
      .limit(1);
    if (!row) throw notFound('No such account');

    return context.json({ ...toUserDto(row), credential: principal.credential });
  });

  return router;
}
