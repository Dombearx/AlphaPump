/**
 * Konflikty w bazie: przegląd i naprawa z panelu.
 *
 * Endpointy są dwa i celowo rozdzielone. `GET` niczego nie zmienia — wolno go
 * odświeżać, ile się chce, i to on jest ekranem. `POST` naprawia wskazane
 * zgłoszenia, czyli jest **decyzją administratora**, a nie skutkiem ubocznym
 * wejścia na ekran. Gdyby przegląd naprawiał od razu, nikt nigdy nie zobaczyłby,
 * co system zrobił z jego danymi — a część tych napraw zdejmuje wiersze.
 *
 * Zestaw możliwych napraw jest zamknięty i mieszka w `domain/integrity.ts`.
 * Tutaj nie ma żadnego zapytania do bazy i nie ma go być: panel przez ten
 * endpoint nie może zrobić bazie niczego, czego ktoś wcześniej nie opisał jako
 * konkretnego konfliktu z konkretnym rozstrzygnięciem.
 */

import {
  integrityRepairInputSchema,
  integrityRepairReportSchema,
  integrityReportSchema,
} from '@alphapump/core';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { repairIssues, scanIntegrity } from '../domain/integrity.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { validateJson } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';

export const integrityRepairBodySchema = integrityRepairInputSchema;

export const integrityRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/admin/integrity',
    summary: 'Konflikty w danych',
    description:
      'Wiersze, których nie przyjmuje własny schemat aplikacji albo które wskazują na coś, ' +
      'czego już nie ma: powtórzony tag główny, tag z tombstonem pod żywym ćwiczeniem, ' +
      'tłumaczenia i kolory poza formatem. Odczyt takie wiersze obchodzi (patrz `dto.ts`), ' +
      'więc nic nie stoi — ale w bazie zostają i wracają przy kolejnym zapisie. ' +
      'Każde zgłoszenie niesie opis konfliktu i to, co zrobi naprawa; ' +
      '`repair: null` znaczy, że automatu nie ma i trzeba poprawić wiersz ręcznie.',
    tag: 'administracja',
    security: 'admin',
    responses: [{ status: 200, description: 'Stan bazy', schema: integrityReportSchema }],
  },
  {
    method: 'post',
    path: '/admin/integrity/repair',
    summary: 'Naprawa wskazanych konfliktów',
    description:
      'Naprawia wyłącznie zgłoszenia o podanych identyfikatorach i wyłącznie te, które ' +
      'nadal istnieją — przegląd leci jeszcze raz wewnątrz transakcji. Zgłoszenie, które ' +
      'w międzyczasie zniknęło, ląduje w `skipped`, a nie w błędzie. W odpowiedzi jedzie ' +
      'stan po naprawie, więc panel nie musi pytać drugi raz.',
    tag: 'administracja',
    security: 'admin',
    body: integrityRepairBodySchema,
    responses: [
      { status: 200, description: 'Raport naprawy', schema: integrityRepairReportSchema },
      { status: 400, description: 'Pusta albo za długa lista zgłoszeń' },
    ],
  },
];

export function createIntegrityRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  router.use('/admin/integrity', requireAdmin);
  router.use('/admin/integrity/*', requireAdmin);

  router.get('/admin/integrity', async (context) =>
    context.json({ checkedAt: new Date().toISOString(), issues: await scanIntegrity(db) }),
  );

  router.post(
    '/admin/integrity/repair',
    validateJson(integrityRepairBodySchema),
    async (context) => {
      const { ids } = context.req.valid('json');
      const outcome = await repairIssues(db, ids);

      return context.json({
        ...outcome,
        checkedAt: new Date().toISOString(),
        issues: await scanIntegrity(db),
      });
    },
  );

  return router;
}
