/**
 * Uwierzytelnienie żądania — sesją albo kluczem API.
 *
 * Dwie drogi, jeden wynik. Aplikacja mobilna przychodzi z sesją better-auth
 * (nagłówkiem, nie ciasteczkiem — patrz `auth.ts`), a bot Discord z nagłówkiem
 * `x-api-key`. Reszta API nie musi wiedzieć, którą drogą przyszło żądanie:
 * dostaje `principal` i tyle. Inaczej każdy handler musiałby pamiętać o obu
 * ścieżkach, a przy pierwszym zapomnieniu powstałby endpoint dostępny tylko
 * dla jednej z nich.
 */

import { eq } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import type { UserRole } from '@alphapump/core';
import type { AppDependencies, AppEnvironment, Principal } from '../context.js';
import { users } from '../schema.js';
import { forbidden, rateLimited, unauthorized } from '../errors.js';

const API_KEY_HEADER = 'x-api-key';

async function loadPrincipal(
  dependencies: AppDependencies,
  userId: string,
  credential: Principal['credential'],
): Promise<Principal> {
  const [row] = await dependencies.db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!row) throw unauthorized('Konto powiązane z tym uwierzytelnieniem już nie istnieje');
  if (row.banned) throw forbidden('Konto jest zablokowane');

  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    role: row.role as UserRole,
    credential,
  };
}

/**
 * Wymusza uwierzytelnienie. Klucz API sprawdzamy jawnie, zamiast polegać na
 * tym, że plugin dołoży sesję — dzięki temu wygasły albo wyłączony klucz daje
 * czytelne 401 zamiast cichego „brak sesji".
 */
export function authenticate(dependencies: AppDependencies) {
  return createMiddleware<AppEnvironment>(async (context, next) => {
    const apiKeyValue = context.req.header(API_KEY_HEADER);

    if (apiKeyValue) {
      const result = await dependencies.auth.api.verifyApiKey({
        body: { key: apiKeyValue },
      });
      if (result.error?.code === 'RATE_LIMITED') {
        throw rateLimited('Przekroczony limit żądań dla tego klucza API');
      }
      if (!result.valid || !result.key) {
        throw unauthorized('Klucz API jest nieprawidłowy, wyłączony albo wygasł');
      }
      context.set(
        'principal',
        await loadPrincipal(dependencies, result.key.referenceId, 'api-key'),
      );
      return next();
    }

    const session = await dependencies.auth.api.getSession({ headers: context.req.raw.headers });
    if (!session?.user) throw unauthorized();

    context.set('principal', await loadPrincipal(dependencies, session.user.id, 'session'));
    return next();
  });
}

/** Operacje zastrzeżone dla administratora — edycja i usuwanie tagów. */
export const requireAdmin = createMiddleware<AppEnvironment>(async (context, next) => {
  if (context.get('principal').role !== 'admin') {
    throw forbidden('Operacja zastrzeżona dla administratora');
  }
  return next();
});
