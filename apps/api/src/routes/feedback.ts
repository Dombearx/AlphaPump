/**
 * Zgłoszenia zwrotne od użytkowników.
 *
 * Dowolny tekst plus do trzydziestu ostatnich wpisów z bufora logów telefonu
 * (patrz `apps/mobile/src/app-log.ts`) — tyle, ile ma sens do przeczytania
 * ręcznie, i tyle, ile telefon w ogóle trzyma.
 *
 * Ląduje na dysku minipc, nie w bazie: jeden plik JSON na zgłoszenie, w
 * katalogu z `AppConfig.feedbackDir`. To jest świadomie doraźna skrzynka
 * wsparcia, a nie encja produktu — nie ma po co jej migrować, indeksować ani
 * synchronizować, wystarczy `cat` i `ls` na maszynie, na której stoi backend.
 *
 * Nick i data wchodzą z sesji i z zegara serwera, **nie** z ciała żądania —
 * inaczej zgłoszenie dałoby się podpisać cudzym nickiem.
 */

import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../context.js';
import { validateJson } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { submitFeedbackBodySchema } from '../schemas.js';

const feedbackResponseSchema = z.object({ ok: z.literal(true) });

export const feedbackRoutes: RouteSpec[] = [
  {
    method: 'post',
    path: '/feedback',
    summary: 'Zgłoszenie zwrotne',
    description:
      'Tekst od zalogowanego użytkownika plus do 30 ostatnich wpisów z logu ' +
      'aplikacji, jeśli telefon je zebrał. Zapisywane jako plik na komputerze, ' +
      'na którym działa backend — nick i data wchodzą z sesji, nie z ciała ' +
      'żądania.',
    tag: 'zgłoszenia',
    security: 'user',
    body: submitFeedbackBodySchema,
    responses: [
      { status: 201, description: 'Zgłoszenie zapisane', schema: feedbackResponseSchema },
    ],
  },
];

/**
 * Nazwa pliku bez znaków, które psują ścieżkę — nick jest dowolnym napisem
 * wpisanym przy rejestracji, nie sluggiem.
 */
function fileSafeSlug(value: string): string {
  const slug = value
    .normalize('NFKD')
    // Usuwa znaki diakrytyczne odlaczone przez normalizacje NFKD.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'uzytkownik';
}

export function createFeedbackRouter(feedbackDir: string) {
  const router = new Hono<AppEnvironment>();

  router.post('/feedback', validateJson(submitFeedbackBodySchema), async (context) => {
    const principal = context.get('principal');
    const { message, logs } = context.req.valid('json');
    const sentAt = new Date();

    await mkdir(feedbackDir, { recursive: true });

    // Znacznik czasu w nazwie sortuje pliki chronologicznie samym `ls`;
    // krótki losowy sufiks rozdziela dwa zgłoszenia tej samej sekundy.
    const fileName =
      `${sentAt.toISOString().replace(/[:.]/g, '-')}` +
      `_${fileSafeSlug(principal.nickname)}` +
      `_${randomUUID().slice(0, 8)}.json`;

    const record = {
      nickname: principal.nickname,
      email: principal.email,
      sentAt: sentAt.toISOString(),
      message,
      logs,
    };

    await writeFile(
      path.join(feedbackDir, fileName),
      `${JSON.stringify(record, null, 2)}\n`,
      'utf8',
    );

    return context.json({ ok: true }, 201);
  });

  return router;
}
