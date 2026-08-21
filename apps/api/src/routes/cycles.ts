/**
 * Cykle.
 *
 * Cykl należy do użytkownika i tylko on go widzi. Pozycje celu jadą razem
 * z cyklem — edycja podmienia komplet, bo cykl bez pozycji nie ma sensu,
 * a pozycja bez cyklu nie ma czego zliczać.
 *
 * Postępu **nie zapisujemy**. Jest daną pochodną, liczoną z serii przez
 * `computeCycleProgress` w rdzeniu — i to jest powód, dla którego usunięcie
 * serii po prostu zmniejsza postęp, bez korekt wstecznych i bez ryzyka, że
 * licznik rozjedzie się z rzeczywistością.
 */

import { cycleSchema, newCycleGoalId, newCycleId } from '@alphapump/core';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { toCycleDto } from '../dto.js';
import { notFound } from '../errors.js';
import { validateJson, validateParam, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import {
  createCycleBodySchema,
  idParamSchema,
  listCyclesQuerySchema,
  updateCycleBodySchema,
} from '../schemas.js';
import { cycleGoals, cycles } from '../schema.js';
import { stampDelete, stampWrite } from '../sync-columns.js';

const cycleListSchema = z.array(cycleSchema);

export const cycleRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/cycles',
    summary: 'Cykle użytkownika',
    tag: 'cykle',
    security: 'user',
    query: listCyclesQuerySchema,
    responses: [{ status: 200, description: 'Lista cykli', schema: cycleListSchema }],
  },
  {
    method: 'get',
    path: '/cycles/:id',
    summary: 'Pojedynczy cykl',
    tag: 'cykle',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Cykl', schema: cycleSchema },
      { status: 404, description: 'No such cycle' },
    ],
  },
  {
    method: 'post',
    path: '/cycles',
    summary: 'Utworzenie cyklu',
    tag: 'cykle',
    security: 'user',
    body: createCycleBodySchema,
    responses: [{ status: 201, description: 'Cykl utworzony', schema: cycleSchema }],
  },
  {
    method: 'patch',
    path: '/cycles/:id',
    summary: 'Edycja cyklu',
    description:
      'Przesunięcie `startsOn` jest resetem cyklu — historia zostaje w seriach, ' +
      'więc poprzednie realizacje da się przeliczyć w każdej chwili.',
    tag: 'cykle',
    security: 'user',
    params: idParamSchema,
    body: updateCycleBodySchema,
    responses: [
      { status: 200, description: 'Cykl zmieniony', schema: cycleSchema },
      { status: 404, description: 'No such cycle' },
    ],
  },
  {
    method: 'delete',
    path: '/cycles/:id',
    summary: 'Usunięcie cyklu',
    tag: 'cykle',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 204, description: 'Cykl usunięty' },
      { status: 404, description: 'No such cycle' },
    ],
  },
];

export function createCycleRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  const goalsOf = async (cycleIds: readonly string[]) => {
    if (cycleIds.length === 0) return new Map<string, (typeof cycleGoals.$inferSelect)[]>();
    const rows = await db
      .select()
      .from(cycleGoals)
      .where(or(...cycleIds.map((id) => eq(cycleGoals.cycleId, id))))
      .orderBy(asc(cycleGoals.position));

    const byCycle = new Map<string, (typeof cycleGoals.$inferSelect)[]>();
    for (const row of rows) {
      const bucket = byCycle.get(row.cycleId);
      if (bucket) bucket.push(row);
      else byCycle.set(row.cycleId, [row]);
    }
    return byCycle;
  };

  const loadOwnCycle = async (id: string, userId: string) => {
    const [row] = await db
      .select()
      .from(cycles)
      .where(and(eq(cycles.id, id), eq(cycles.userId, userId)))
      .limit(1);
    if (!row || row.deletedAt !== null) throw notFound('No such cycle');
    return { row, goals: (await goalsOf([id])).get(id) ?? [] };
  };

  const replaceGoals = async (
    cycleId: string,
    goals: readonly {
      metric: 'sets' | 'duration' | 'distance';
      target: number;
      exerciseId: string | null;
      tagId: string | null;
    }[],
  ) => {
    await db.delete(cycleGoals).where(eq(cycleGoals.cycleId, cycleId));
    await db.insert(cycleGoals).values(
      goals.map((goal, position) => ({
        id: newCycleGoalId(),
        cycleId,
        metric: goal.metric,
        target: goal.target,
        exerciseId: goal.exerciseId,
        tagId: goal.tagId,
        position,
      })),
    );
  };

  router.get('/cycles', validateQuery(listCyclesQuerySchema), async (context) => {
    const principal = context.get('principal');
    const { includeArchived } = context.req.valid('query');

    const conditions = [eq(cycles.userId, principal.id), isNull(cycles.deletedAt)];
    if (!includeArchived) conditions.push(isNull(cycles.archivedAt));

    const rows = await db
      .select()
      .from(cycles)
      .where(and(...conditions))
      .orderBy(asc(cycles.startsOn), asc(cycles.name));

    const goalsByCycle = await goalsOf(rows.map((row) => row.id));
    return context.json(rows.map((row) => toCycleDto(row, goalsByCycle.get(row.id) ?? [])));
  });

  router.get('/cycles/:id', validateParam(idParamSchema), async (context) => {
    const principal = context.get('principal');
    const { id } = context.req.valid('param');
    const { row, goals } = await loadOwnCycle(id, principal.id);
    return context.json(toCycleDto(row, goals));
  });

  router.post('/cycles', validateJson(createCycleBodySchema), async (context) => {
    const principal = context.get('principal');
    const input = context.req.valid('json');

    const id = newCycleId();
    const [row] = await db
      .insert(cycles)
      .values({
        id,
        userId: principal.id,
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        ...stampWrite(),
      })
      .returning();

    await replaceGoals(id, input.goals);
    const goals = (await goalsOf([id])).get(id) ?? [];
    return context.json(toCycleDto(row!, goals), 201);
  });

  router.patch(
    '/cycles/:id',
    validateParam(idParamSchema),
    validateJson(updateCycleBodySchema),
    async (context) => {
      const principal = context.get('principal');
      const { id } = context.req.valid('param');
      const input = context.req.valid('json');

      const existing = await loadOwnCycle(id, principal.id);

      const startsOn = input.startsOn ?? existing.row.startsOn;
      const endsOn = input.endsOn === undefined ? existing.row.endsOn : input.endsOn;

      const [row] = await db
        .update(cycles)
        .set({
          name: input.name ?? existing.row.name,
          startsOn,
          endsOn,
          ...(input.archived === undefined
            ? {}
            : { archivedAt: input.archived ? new Date() : null }),
          ...stampWrite(),
        })
        .where(eq(cycles.id, id))
        .returning();

      if (input.goals) await replaceGoals(id, input.goals);
      const goals = (await goalsOf([id])).get(id) ?? [];
      return context.json(toCycleDto(row!, goals));
    },
  );

  router.delete('/cycles/:id', validateParam(idParamSchema), async (context) => {
    const principal = context.get('principal');
    const { id } = context.req.valid('param');

    await loadOwnCycle(id, principal.id);
    await db.update(cycles).set(stampDelete()).where(eq(cycles.id, id));
    return context.body(null, 204);
  });

  return router;
}
