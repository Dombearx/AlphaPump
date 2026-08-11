/**
 * Złożenie aplikacji Hono.
 *
 * `createApp` dostaje gotowe zależności zamiast tworzyć je samo. Dzięki temu
 * testy integracyjne stawiają tę samą aplikację na bazie w pamięci i sprawdzają
 * **ten sam kod**, który pojedzie na minipc — bez atrap i bez drugiej ścieżki
 * konfiguracji, która mogłaby po cichu odejść od produkcyjnej.
 *
 * Kolejność jest istotna: `/health` i `/api/auth/*` są przed uwierzytelnieniem,
 * bo healthcheck ma odpowiadać bez konta, a logowanie z definicji jeszcze go
 * nie ma.
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import type { AppConfig } from './config.js';
import type { AppDependencies, AppEnvironment } from './context.js';
import { ApiError, toErrorResponse } from './errors.js';
import { DERIVED_RECOMPUTATIONS } from './derived/index.js';
import { authenticate } from './middleware/authenticate.js';
import { buildOpenApiDocument, type RouteSpec } from './openapi.js';
import { createCycleRouter, cycleRoutes } from './routes/cycles.js';
import { createExerciseRouter, exerciseRoutes } from './routes/exercises.js';
import { createHealthRouter, healthRoutes } from './routes/health.js';
import { createMeRouter, meRoutes } from './routes/me.js';
import { createRankingRouter, rankingRoutes } from './routes/rankings.js';
import { createRecordRouter, recordRoutes } from './routes/records.js';
import { createSetRouter, setRoutes } from './routes/sets.js';
import { createSyncRouter, syncRoutes } from './routes/sync.js';
import { createTagRouter, tagRoutes } from './routes/tags.js';

/** Wersja wystawiana w OpenAPI i w healthchecku. */
export const API_VERSION = '0.1.0';

/** Wszystkie trasy opisane dla OpenAPI. Test pilnuje, że lista pokrywa się z Hono. */
export const documentedRoutes: RouteSpec[] = [
  ...healthRoutes,
  ...meRoutes,
  ...tagRoutes,
  ...exerciseRoutes,
  ...setRoutes,
  ...cycleRoutes,
  ...recordRoutes,
  ...rankingRoutes,
  ...syncRoutes,
];

export function createApp(dependencies: AppDependencies, config: AppConfig) {
  const app = new Hono<AppEnvironment>();

  // Pominięcie listy przeliczeń daje zestaw domyślny, a nie brak przeliczania:
  // rekordy globalne nie mają jak zostać nieprzeliczone przez przeoczenie
  // w złożeniu aplikacji. Test, który chce zajrzeć w zakres, podstawia własną.
  const resolved: AppDependencies = {
    ...dependencies,
    derived: dependencies.derived ?? DERIVED_RECOMPUTATIONS,
  };

  if (config.nodeEnv !== 'test') app.use('*', logger());

  app.use(
    '*',
    cors({
      origin: config.trustedOrigins,
      credentials: true,
      allowHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
    }),
  );

  app.onError((error, context) => {
    if (error instanceof ApiError) {
      return context.json(toErrorResponse(error), error.status as 400);
    }
    console.error('Nieobsłużony błąd żądania', error);
    return context.json(toErrorResponse(new ApiError('internal', 'Wewnętrzny błąd serwera')), 500);
  });

  app.notFound((context) =>
    context.json(toErrorResponse(new ApiError('not_found', 'Nie ma takiego zasobu')), 404),
  );

  // --- bez uwierzytelnienia -------------------------------------------------
  app.route('/', createHealthRouter(resolved));

  app.get('/openapi.json', (context) =>
    context.json(
      buildOpenApiDocument(documentedRoutes, {
        title: 'AlphaPump API',
        version: API_VERSION,
        baseUrl: config.baseUrl,
      }),
    ),
  );

  /** better-auth obsługuje rejestrację, logowanie, sesje i klucze API. */
  app.all('/api/auth/*', (context) => dependencies.auth.handler(context.req.raw));

  // --- reszta wymaga konta --------------------------------------------------
  const secured = new Hono<AppEnvironment>();
  secured.use('*', authenticate(resolved));
  secured.route('/', createMeRouter(resolved));
  secured.route('/', createTagRouter(resolved));
  secured.route('/', createExerciseRouter(resolved));
  secured.route('/', createSetRouter(resolved));
  secured.route('/', createCycleRouter(resolved));
  secured.route('/', createRecordRouter(resolved));
  secured.route('/', createRankingRouter(resolved));
  secured.route('/', createSyncRouter(resolved));

  app.route('/', secured);

  return app;
}

export type App = ReturnType<typeof createApp>;
