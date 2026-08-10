/**
 * Serie — najważniejsza część API.
 *
 * To ten zakres realizuje kryterium akceptacyjne „API z tokenem pozwala wykonać
 * CRUD serii" i to z niego korzysta bot Discord.
 *
 * Serie są **prywatne**: każde zapytanie jest zawężone do właściciela, także
 * dla administratora. Rekordy globalne i rankingi (etap 11) pokazują na
 * zewnątrz wyłącznie wartość, nick, datę i notatkę — nigdy historii serii.
 *
 * Pomiary są walidowane względem typu logowania **ćwiczenia**, a nie samego
 * ciała żądania: dystans przy wyciskaniu sztangi nie ma jak się prześlizgnąć,
 * bo to ćwiczenie decyduje, które pola w ogóle istnieją.
 */

import { newSetId, setInputSchemaFor, workoutSetSchema } from '@alphapump/core';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { toSetDto } from '../dto.js';
import { badRequest, notFound } from '../errors.js';
import { validateJson, validateParam, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import {
  createSetBodySchema,
  idParamSchema,
  listSetsQuerySchema,
  updateSetBodySchema,
} from '../schemas.js';
import { exercises, workoutSets } from '../schema.js';
import { stampDelete, stampWrite } from '../sync-columns.js';

const setListSchema = z.array(workoutSetSchema);

export const setRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/sets',
    summary: 'Serie użytkownika',
    description: 'Zawsze wyłącznie własne serie. Zakres dat obustronnie domknięty.',
    tag: 'serie',
    security: 'user',
    query: listSetsQuerySchema,
    responses: [{ status: 200, description: 'Lista serii', schema: setListSchema }],
  },
  {
    method: 'get',
    path: '/sets/:id',
    summary: 'Pojedyncza seria',
    tag: 'serie',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Seria', schema: workoutSetSchema },
      { status: 404, description: 'Seria nie istnieje' },
    ],
  },
  {
    method: 'post',
    path: '/sets',
    summary: 'Zapisanie serii',
    description:
      'Identyfikator można podać — seria dostaje UUIDv7 już na telefonie, bez ' +
      'sieci. Ponowne wysłanie tej samej serii po zerwanym połączeniu nie tworzy ' +
      'wtedy duplikatu.',
    tag: 'serie',
    security: 'user',
    body: createSetBodySchema,
    responses: [
      { status: 201, description: 'Seria zapisana', schema: workoutSetSchema },
      { status: 400, description: 'Pomiary nie pasują do typu logowania ćwiczenia' },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
    ],
  },
  {
    method: 'patch',
    path: '/sets/:id',
    summary: 'Edycja serii',
    tag: 'serie',
    security: 'user',
    params: idParamSchema,
    body: updateSetBodySchema,
    responses: [
      { status: 200, description: 'Seria zmieniona', schema: workoutSetSchema },
      { status: 400, description: 'Pomiary nie pasują do typu logowania ćwiczenia' },
      { status: 404, description: 'Seria nie istnieje' },
    ],
  },
  {
    method: 'delete',
    path: '/sets/:id',
    summary: 'Usunięcie serii',
    description: 'Usunięcie miękkie — tombstone musi mieć jak dojechać na inne urządzenia.',
    tag: 'serie',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 204, description: 'Seria usunięta' },
      { status: 404, description: 'Seria nie istnieje' },
    ],
  },
];

export function createSetRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  const loadExercise = async (exerciseId: string) => {
    const [row] = await db
      .select()
      .from(exercises)
      .where(and(eq(exercises.id, exerciseId), isNull(exercises.deletedAt)))
      .limit(1);
    if (!row) throw notFound('Ćwiczenie nie istnieje');
    return row;
  };

  const loadOwnSet = async (id: string, userId: string) => {
    const [row] = await db
      .select()
      .from(workoutSets)
      .where(and(eq(workoutSets.id, id), eq(workoutSets.userId, userId)))
      .limit(1);
    if (!row || row.deletedAt !== null) throw notFound('Seria nie istnieje');
    return row;
  };

  /** Nowa seria ląduje na końcu listy danego dnia dla danego ćwiczenia. */
  const nextPositionFor = async (userId: string, exerciseId: string, performedOn: string) => {
    const rows = await db
      .select({ position: workoutSets.position })
      .from(workoutSets)
      .where(
        and(
          eq(workoutSets.userId, userId),
          eq(workoutSets.exerciseId, exerciseId),
          eq(workoutSets.performedOn, performedOn),
          isNull(workoutSets.deletedAt),
        ),
      );
    return rows.length === 0 ? 0 : Math.max(...rows.map((row) => row.position)) + 1;
  };

  const assertMeasurementsMatchExercise = (
    loggingType: Parameters<typeof setInputSchemaFor>[0],
    candidate: Record<string, unknown>,
  ) => {
    const result = setInputSchemaFor(loggingType).safeParse(candidate);
    if (!result.success) {
      throw badRequest(
        `Pomiary nie pasują do typu logowania ${loggingType}`,
        result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      );
    }
  };

  router.get('/sets', validateQuery(listSetsQuerySchema), async (context) => {
    const principal = context.get('principal');
    const query = context.req.valid('query');

    const conditions = [eq(workoutSets.userId, principal.id), isNull(workoutSets.deletedAt)];
    if (query.from) conditions.push(gte(workoutSets.performedOn, query.from));
    if (query.to) conditions.push(lte(workoutSets.performedOn, query.to));
    if (query.exerciseId) conditions.push(eq(workoutSets.exerciseId, query.exerciseId));

    const rows = await db
      .select()
      .from(workoutSets)
      .where(and(...conditions))
      .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position), asc(workoutSets.id))
      .limit(query.limit)
      .offset(query.offset);

    return context.json(rows.map(toSetDto));
  });

  router.get('/sets/:id', validateParam(idParamSchema), async (context) => {
    const principal = context.get('principal');
    const { id } = context.req.valid('param');
    return context.json(toSetDto(await loadOwnSet(id, principal.id)));
  });

  router.post('/sets', validateJson(createSetBodySchema), async (context) => {
    const principal = context.get('principal');
    const { id, position, ...input } = context.req.valid('json');

    const exercise = await loadExercise(input.exerciseId);
    assertMeasurementsMatchExercise(exercise.loggingType, input);

    const setId = id ?? newSetId();
    const [existing] = await db
      .select({ id: workoutSets.id, userId: workoutSets.userId })
      .from(workoutSets)
      .where(eq(workoutSets.id, setId))
      .limit(1);
    if (existing) {
      // Ten sam identyfikator to ta sama seria wysłana ponownie, a nie nowa.
      // Zwracamy stan bieżący zamiast tworzyć duplikat albo krzyczeć błędem.
      if (existing.userId !== principal.id) throw notFound('Seria nie istnieje');
      return context.json(toSetDto(await loadOwnSet(setId, principal.id)), 200);
    }

    const [row] = await db
      .insert(workoutSets)
      .values({
        id: setId,
        userId: principal.id,
        exerciseId: input.exerciseId,
        performedOn: input.performedOn,
        position:
          position ?? (await nextPositionFor(principal.id, input.exerciseId, input.performedOn)),
        weightG: input.weightG,
        reps: input.reps,
        durationS: input.durationS,
        distanceM: input.distanceM,
        bodyweightG: input.bodyweightG,
        note: input.note,
        ...stampWrite(),
      })
      .returning();

    return context.json(toSetDto(row!), 201);
  });

  router.patch(
    '/sets/:id',
    validateParam(idParamSchema),
    validateJson(updateSetBodySchema),
    async (context) => {
      const principal = context.get('principal');
      const { id } = context.req.valid('param');
      const input = context.req.valid('json');

      const existing = await loadOwnSet(id, principal.id);
      const exerciseId = input.exerciseId ?? existing.exerciseId;
      const exercise = await loadExercise(exerciseId);

      // Walidujemy stan **po** scaleniu, a nie samą łatkę: zmiana jednego pola
      // może dopiero w połączeniu z resztą dać zestaw niepasujący do typu.
      const merged = {
        exerciseId,
        performedOn: input.performedOn ?? existing.performedOn,
        weightG: input.weightG === undefined ? existing.weightG : input.weightG,
        reps: input.reps === undefined ? existing.reps : input.reps,
        durationS: input.durationS === undefined ? existing.durationS : input.durationS,
        distanceM: input.distanceM === undefined ? existing.distanceM : input.distanceM,
        bodyweightG: input.bodyweightG === undefined ? existing.bodyweightG : input.bodyweightG,
        note: input.note === undefined ? existing.note : input.note,
      };
      assertMeasurementsMatchExercise(exercise.loggingType, merged);

      const [row] = await db
        .update(workoutSets)
        .set({
          ...merged,
          ...(input.position === undefined ? {} : { position: input.position }),
          ...stampWrite(),
        })
        .where(eq(workoutSets.id, id))
        .returning();

      return context.json(toSetDto(row!));
    },
  );

  router.delete('/sets/:id', validateParam(idParamSchema), async (context) => {
    const principal = context.get('principal');
    const { id } = context.req.valid('param');

    await loadOwnSet(id, principal.id);
    await db.update(workoutSets).set(stampDelete()).where(eq(workoutSets.id, id));
    return context.body(null, 204);
  });

  return router;
}
