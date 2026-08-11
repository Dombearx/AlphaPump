/**
 * Rekordy globalne ćwiczeń.
 *
 * Jedyny endpoint w całym API, który oddaje coś pochodzącego z cudzych serii —
 * i dlatego jest tu zapisana granica prywatności wprost: na zewnątrz wychodzą
 * **wyłącznie wartość, nick, data i notatka serii**. Nie ma tu identyfikatora
 * serii ani identyfikatora użytkownika, bo jedno i drugie byłoby punktem
 * zaczepienia do historii, która pozostaje prywatna.
 *
 * Odczyt idzie z `exercise_records`, czyli z cache'u przeliczanego po każdej
 * zmianie serii (patrz `src/derived/`). Liczenie frontu w locie przy każdym
 * pytaniu wymagałoby przejścia po wszystkich seriach ćwiczenia — a to jest
 * dokładnie ten koszt, dla którego cache istnieje.
 */

import { globalRecordsResponseSchema, type GlobalRecord } from '@alphapump/core';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { notFound } from '../errors.js';
import { validateParam } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { idParamSchema } from '../schemas.js';
import { exerciseRecords, exercises, users } from '../schema.js';

export const recordRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/exercises/:id/records',
    summary: 'Rekordy globalne ćwiczenia',
    description:
      'Front Pareto po seriach wszystkich użytkowników, liczony tym samym ' +
      'algorytmem co rekordy indywidualne na telefonie. Odpowiedź niesie wyłącznie ' +
      'wartość, nick, datę i notatkę serii — historia serii pozostaje prywatna.',
    tag: 'rekordy',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Rekordy ćwiczenia', schema: globalRecordsResponseSchema },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
    ],
  },
];

export function createRecordRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  router.get('/exercises/:id/records', validateParam(idParamSchema), async (context) => {
    const { id } = context.req.valid('param');

    const [exercise] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(and(eq(exercises.id, id), isNull(exercises.deletedAt)))
      .limit(1);
    if (!exercise) throw notFound('Ćwiczenie nie istnieje');

    const rows = await db
      .select({
        nickname: users.nickname,
        performedOn: exerciseRecords.performedOn,
        note: exerciseRecords.note,
        weightG: exerciseRecords.weightG,
        reps: exerciseRecords.reps,
        durationS: exerciseRecords.durationS,
        distanceM: exerciseRecords.distanceM,
      })
      .from(exerciseRecords)
      .innerJoin(users, eq(users.id, exerciseRecords.userId))
      .where(eq(exerciseRecords.exerciseId, id))
      .orderBy(asc(exerciseRecords.position));

    return context.json({ exerciseId: id, records: rows satisfies GlobalRecord[] });
  });

  return router;
}
