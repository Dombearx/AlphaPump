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
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnvironment } from '../context.js';
import { rateLimited } from '../errors.js';
import { logger } from '../logger.js';
import { validateJson } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { submitFeedbackBodySchema } from '@alphapump/core';

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
      { status: 429, description: 'Za dużo zgłoszeń z jednego konta w krótkim czasie' },
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

/**
 * Ile zgłoszeń przyjmujemy od jednego konta na godzinę.
 *
 * Zgłoszenie to plik na dysku minipc, do ~62 KB, a katalog nie miał ani limitu
 * tempa, ani retencji — jedno konto w pętli zapełniało dysk, na którym leży też
 * baza. Limit jest w pamięci procesu, tak jak przy kluczach API: celem jest
 * zatrzymanie pętli w skrypcie, a nie obrona przed kimś, kto naprawdę chce
 * zaszkodzić — na to jest model zaufania całego wdrożenia.
 */
export const FEEDBACK_RATE_LIMIT = 20;
const FEEDBACK_RATE_WINDOW_MS = 60 * 60_000;

/**
 * Po ilu dniach zgłoszenie znika.
 *
 * Pliki niosą adres e-mail i przechwycone logi konsoli, więc katalog rósł jako
 * zbiór danych osobowych, którego nic nie kasowało. Pół roku jest z zapasem
 * względem tego, po co się do nich sięga: usługa `triage` czyta je raz na dobę
 * i po przejrzeniu nie wraca.
 */
export const FEEDBACK_RETENTION_DAYS = 180;
const SWEEP_INTERVAL_MS = 60 * 60_000;

export function createFeedbackRouter(
  feedbackDir: string,
  options: { retentionDays?: number; now?: () => number } = {},
) {
  const router = new Hono<AppEnvironment>();
  const now = options.now ?? (() => Date.now());
  const retentionDays = options.retentionDays ?? FEEDBACK_RETENTION_DAYS;

  /** Znaczniki czasu ostatnich zgłoszeń, per konto. */
  const recent = new Map<string, number[]>();
  let sweptAt = 0;

  const withinLimit = (userId: string, at: number): boolean => {
    const kept = (recent.get(userId) ?? []).filter((stamp) => at - stamp < FEEDBACK_RATE_WINDOW_MS);
    if (kept.length >= FEEDBACK_RATE_LIMIT) {
      recent.set(userId, kept);
      return false;
    }
    kept.push(at);
    recent.set(userId, kept);
    return true;
  };

  /**
   * Sprząta wygasłe zgłoszenia — przy okazji zapisu, nie z osobnego czasomierza.
   *
   * API nie ma planisty i dokładanie go dla jednej operacji na dobę byłoby
   * ceremonią. Przegląd katalogu przy zapisie wystarcza: zgłoszenia przychodzą
   * rzadko, a `sweptAt` pilnuje, żeby nie działo się to częściej niż raz na
   * godzinę. Awaria sprzątania nie ma prawa przewrócić zapisu — zgłoszenie
   * użytkownika jest ważniejsze niż porządek w katalogu.
   */
  const sweepExpired = async (at: number): Promise<void> => {
    if (at - sweptAt < SWEEP_INTERVAL_MS) return;
    sweptAt = at;

    const cutoff = at - retentionDays * 24 * 60 * 60_000;
    try {
      const names = await readdir(feedbackDir);
      await Promise.all(
        names
          .filter((name) => name.endsWith('.json'))
          .map(async (name) => {
            const file = path.join(feedbackDir, name);
            const info = await stat(file);
            if (info.mtimeMs < cutoff) await rm(file, { force: true });
          }),
      );
    } catch (error) {
      logger.warn('nie udało się posprzątać zgłoszeń zwrotnych', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  router.post('/feedback', validateJson(submitFeedbackBodySchema), async (context) => {
    const principal = context.get('principal');
    const { message, logs } = context.req.valid('json');
    const at = now();

    if (!withinLimit(principal.id, at)) {
      throw rateLimited(
        `Za dużo zgłoszeń naraz — przyjmujemy ${String(FEEDBACK_RATE_LIMIT)} na godzinę. ` +
          'Spróbuj ponownie później.',
      );
    }

    const sentAt = new Date(at);

    await mkdir(feedbackDir, { recursive: true });
    await sweepExpired(at);

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
