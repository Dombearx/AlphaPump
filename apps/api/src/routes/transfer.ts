/**
 * Eksport i import danych przez API.
 *
 * Dwa endpointy i jedna reguła: zwykły użytkownik operuje na swoich danych,
 * administrator dodatkowo na całym systemie. Archiwum systemowe jest tym samym
 * plikiem, który tworzy cron kopii zapasowych — dzięki temu odtworzenie z Dysku
 * i import zrobiony z aplikacji idą tą samą ścieżką kodu.
 *
 * `GET /export` oddaje JSON z nagłówkiem `Content-Disposition`, żeby przeglądarka
 * i panel administracyjny zapisały plik pod czytelną nazwą zamiast wyświetlać go
 * w oknie. Nazwa niesie datę, bo tak nazywają się pliki w retencji na Dysku.
 */

import { archiveSchema, importReportSchema, parseArchive } from '@alphapump/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { badRequest, forbidden } from '../errors.js';
import { validateJson, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { exportArchive, importArchive } from '../transfer/index.js';

export const exportQuerySchema = z.object({
  /**
   * `user` — dane własne, dostępne każdemu. `system` — wszystko, wyłącznie dla
   * administratora, bo w takim archiwum są cudze serie.
   */
  scope: z.enum(['user', 'system']).default('user'),
});

/** Raport importu opisuje rdzeń — tym samym schematem czyta go panel. */
export const importResponseSchema = importReportSchema;

export const transferRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/export',
    summary: 'Eksport danych do JSON',
    description:
      'Serie, ćwiczenia, tagi, cykle i minimalne dane użytkowników. Bez haseł, sesji, ' +
      'kluczy API, embeddingów, rekordów i rankingów — jedno jest wrażliwe, drugie ' +
      'przeliczalne z serii. `scope=system` wymaga roli administratora i jest tym samym ' +
      'plikiem, którego używa kopia zapasowa.',
    tag: 'dane',
    security: 'user',
    query: exportQuerySchema,
    responses: [
      { status: 200, description: 'Archiwum', schema: archiveSchema },
      { status: 403, description: 'Archiwum systemowe wymaga administratora' },
    ],
  },
  {
    method: 'post',
    path: '/import',
    summary: 'Import danych z JSON',
    description:
      'Konflikty rozstrzyga LWW po `updated_at`, tak jak przy synchronizacji, a każdy ' +
      'zapisany wiersz dostaje nowy `server_seq`, więc odtworzone dane schodzą na ' +
      'urządzenia zwykłym pullem. Użytkownicy z archiwum są dopasowywani po adresie ' +
      'e-mail; gdy identyfikator autora się zmienił, identyfikatory jego ćwiczeń są ' +
      'przeliczane, bo wynikają z pary autor + nazwa.',
    tag: 'dane',
    security: 'user',
    body: archiveSchema,
    responses: [
      { status: 200, description: 'Raport importu', schema: importResponseSchema },
      { status: 400, description: 'Plik nie jest archiwum AlphaPump albo jest niespójny' },
      { status: 403, description: 'Archiwum systemowe wymaga administratora' },
    ],
  },
];

export function createTransferRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  router.get('/export', validateQuery(exportQuerySchema), async (context) => {
    const principal = context.get('principal');
    const { scope } = context.req.valid('query');

    if (scope === 'system' && principal.role !== 'admin') {
      throw forbidden('Archiwum systemowe może pobrać wyłącznie administrator');
    }

    const now = new Date();
    const archive = await exportArchive(
      db,
      scope === 'system' ? { kind: 'system' } : { kind: 'user', userId: principal.id },
      now,
    );

    const day = now.toISOString().slice(0, 10);
    context.header('Content-Disposition', `attachment; filename="alphapump-${scope}-${day}.json"`);
    return context.json(archive);
  });

  router.post('/import', validateJson(archiveSchema), async (context) => {
    const principal = context.get('principal');

    // Ciało przeszło już schemat archiwum, ale `parseArchive` wołamy jawnie:
    // to on jest kontraktem formatu i to jego komunikaty widzi osoba odtwarzająca
    // kopię z linii poleceń. Jedna ścieżka walidacji, nie dwie.
    let archive;
    try {
      archive = parseArchive(context.req.valid('json'));
    } catch (error) {
      throw badRequest('Plik nie jest archiwum AlphaPump w znanej wersji', String(error));
    }

    const report = await importArchive(db, archive, {
      actor: { id: principal.id, email: principal.email, role: principal.role },
    });

    return context.json(report);
  });

  return router;
}
