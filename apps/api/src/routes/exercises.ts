/**
 * Ćwiczenia.
 *
 * Biblioteka jest wspólna — każdy widzi wszystko i każdy może dodać ćwiczenie.
 * Zmieniać i usuwać może **wyłącznie autor albo administrator**; bez tego
 * publiczna biblioteka wchodzi w problemy rodem z wiki, a samo LWW przestaje
 * wystarczać do rozstrzygania konfliktów.
 *
 * Tworzenie jest idempotentne w tym samym sensie co przy tagach: identyfikator
 * wynika z pary autor + slug nazwy, więc dwa telefony bez sieci wyliczą to samo
 * id i po synchronizacji zsumują się w jeden wiersz.
 *
 * Typ logowania jest ustalany raz. Nie da się go zmienić edycją, bo historyczne
 * serie przestałyby pasować do własnego ćwiczenia — kto chce inny typ, tworzy
 * nowe ćwiczenie.
 *
 * Zapis dokłada jeszcze jedną rzecz, niewidoczną w odpowiedzi: **przeliczenie
 * embeddingu** nazwy. Dzieje się to po zapisie i nie ma prawa go
 * wywrócić — ćwiczenie bez wektora jest normalnym stanem, znajdzie się warstwą
 * leksykalną i wektor dostanie przy następnej edycji albo przy zadaniu
 * porządkowym. Odwrotna kolejność, czyli zapis dopiero po odpowiedzi dostawcy
 * modeli, łamałaby regułę „utworzenie ćwiczenia nigdy nie jest blokowane".
 */

import { describeRejection, exerciseId, exerciseSchema, slug } from '@alphapump/core';
import { and, asc, eq, exists, ilike, isNull, ne, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { SYSTEM_USER } from '@alphapump/db';
import type { AppDependencies, AppEnvironment, Principal } from '../context.js';
import { toExerciseDto } from '../dto.js';
import { NO_LAYERS, refreshEmbedding } from '../duplicates/index.js';
import {
  EXERCISE_IN_USE,
  EXERCISE_RULES,
  exerciseNameTaken,
  isExerciseInUse,
  mayModifyExercise,
  repeatsPrimaryTag,
} from '../domain/exercises.js';
import { TAG_RULES, missingTagIds } from '../domain/tags.js';
import { conflict, forbidden, notFound } from '../errors.js';
import { validateJson, validateParam, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import {
  createExerciseBodySchema,
  idParamSchema,
  listExercisesQuerySchema,
  updateExerciseBodySchema,
} from '../schemas.js';
import { exerciseTags, exercises } from '../schema.js';
import { stampDelete, stampWrite } from '../sync-columns.js';

const exerciseListSchema = z.array(exerciseSchema);

export const exerciseRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/exercises',
    summary: 'Biblioteka ćwiczeń',
    description: 'Filtrowanie po tagu (głównym lub dodatkowym), autorze i nazwie.',
    tag: 'ćwiczenia',
    security: 'user',
    query: listExercisesQuerySchema,
    responses: [{ status: 200, description: 'Lista ćwiczeń', schema: exerciseListSchema }],
  },
  {
    method: 'post',
    path: '/exercises',
    summary: 'Dodanie ćwiczenia',
    tag: 'ćwiczenia',
    security: 'user',
    body: createExerciseBodySchema,
    responses: [
      { status: 201, description: 'Ćwiczenie utworzone', schema: exerciseSchema },
      { status: 200, description: 'Ćwiczenie o tej nazwie już istniało', schema: exerciseSchema },
      { status: 404, description: 'Wskazany tag nie istnieje' },
    ],
  },
  {
    method: 'patch',
    path: '/exercises/:id',
    summary: 'Edycja ćwiczenia',
    description: 'Wyłącznie autor albo administrator. Typ logowania jest nieedytowalny.',
    tag: 'ćwiczenia',
    security: 'user',
    params: idParamSchema,
    body: updateExerciseBodySchema,
    responses: [
      { status: 200, description: 'Ćwiczenie zmienione', schema: exerciseSchema },
      { status: 403, description: 'Edytować może wyłącznie autor albo administrator' },
      { status: 404, description: 'No such exercise' },
      { status: 409, description: 'Autor ma już ćwiczenie o takiej nazwie' },
    ],
  },
  {
    method: 'delete',
    path: '/exercises/:id',
    summary: 'Usunięcie ćwiczenia',
    description:
      'Usunięcie miękkie — wiersz zostaje z tombstonem, więc zapisane serie ' +
      'nie tracą tego, na co wskazują. Odmawia, gdy ktokolwiek ma na tym ćwiczeniu ' +
      'zapisaną serię: właściwą operacją jest wtedy scalenie z innym ćwiczeniem.',
    tag: 'ćwiczenia',
    security: 'user',
    params: idParamSchema,
    responses: [
      { status: 204, description: 'Ćwiczenie usunięte' },
      { status: 403, description: 'Usunąć może wyłącznie autor albo administrator' },
      { status: 404, description: 'No such exercise' },
      { status: 409, description: 'Ćwiczenie ma zapisane serie' },
    ],
  },
];

function assertMayModify(exercise: { authorId: string }, principal: Principal): void {
  if (!mayModifyExercise(exercise.authorId, principal))
    throw forbidden(describeRejection(EXERCISE_RULES.notAuthor));
}

/** Reguły wspólne dla tworzenia i edycji — jedno miejsce, dwa handlery. */
async function assertTagsUsable(
  db: AppDependencies['db'],
  primaryTagId: string,
  additionalTagIds: readonly string[],
): Promise<void> {
  if (repeatsPrimaryTag(primaryTagId, additionalTagIds)) {
    throw conflict(describeRejection(EXERCISE_RULES.duplicateTag));
  }
  const missing = await missingTagIds(db, [primaryTagId, ...additionalTagIds], { aliveOnly: true });
  if (missing.length > 0) throw notFound(describeRejection(TAG_RULES.missing, missing.join(', ')));
}

export function createExerciseRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const layers = dependencies.duplicates ?? NO_LAYERS;

  const additionalTagsOf = async (ids: readonly string[]): Promise<Map<string, string[]>> => {
    if (ids.length === 0) return new Map();
    const rows = await db
      .select()
      .from(exerciseTags)
      .where(or(...ids.map((id) => eq(exerciseTags.exerciseId, id))))
      .orderBy(asc(exerciseTags.position));

    const byExercise = new Map<string, string[]>();
    for (const row of rows) {
      const bucket = byExercise.get(row.exerciseId);
      if (bucket) bucket.push(row.tagId);
      else byExercise.set(row.exerciseId, [row.tagId]);
    }
    return byExercise;
  };

  const replaceAdditionalTags = async (id: string, tagIds: readonly string[]): Promise<void> => {
    await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, id));
    if (tagIds.length === 0) return;
    await db
      .insert(exerciseTags)
      .values(tagIds.map((tagId, position) => ({ exerciseId: id, tagId, position })));
  };

  const loadOne = async (id: string) => {
    const [row] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
    if (!row) return null;
    const tagsById = await additionalTagsOf([id]);
    return { row, additionalTagIds: tagsById.get(id) ?? [] };
  };

  router.get('/exercises', validateQuery(listExercisesQuerySchema), async (context) => {
    const query = context.req.valid('query');

    const conditions = [isNull(exercises.deletedAt)];
    if (query.authorId) conditions.push(eq(exercises.authorId, query.authorId));
    if (query.builtIn !== undefined) {
      // Ćwiczenie wbudowane to takie, którego autorem jest konto systemowe —
      // innego znacznika nie potrzebujemy, bo autor i tak wchodzi w klucz id.
      conditions.push(
        query.builtIn
          ? eq(exercises.authorId, SYSTEM_USER.id)
          : ne(exercises.authorId, SYSTEM_USER.id),
      );
    }
    if (query.search) conditions.push(ilike(exercises.slug, `%${slug(query.search)}%`));
    if (query.tagId) {
      const tagId = query.tagId;
      conditions.push(
        or(
          eq(exercises.primaryTagId, tagId),
          exists(
            db
              .select({ one: exerciseTags.tagId })
              .from(exerciseTags)
              .where(and(eq(exerciseTags.exerciseId, exercises.id), eq(exerciseTags.tagId, tagId))),
          ),
        )!,
      );
    }

    const rows = await db
      .select()
      .from(exercises)
      .where(and(...conditions))
      .orderBy(asc(exercises.name));

    const tagsById = await additionalTagsOf(rows.map((row) => row.id));
    return context.json(rows.map((row) => toExerciseDto(row, tagsById.get(row.id) ?? [])));
  });

  router.post('/exercises', validateJson(createExerciseBodySchema), async (context) => {
    const principal = context.get('principal');
    const input = context.req.valid('json');

    await assertTagsUsable(db, input.primaryTagId, input.additionalTagIds);

    const id = exerciseId(principal.id, input.name, input.gym);
    const existing = await loadOne(id);
    if (existing && existing.row.deletedAt === null) {
      return context.json(toExerciseDto(existing.row, existing.additionalTagIds), 200);
    }

    const stamp = stampWrite();
    const values = {
      id,
      name: input.name,
      slug: slug(input.name),
      authorId: principal.id,
      loggingType: input.loggingType,
      primaryTagId: input.primaryTagId,
      note: input.note,
      gym: input.gym,
      ...stamp,
    };

    const [row] = await db
      .insert(exercises)
      .values(values)
      .onConflictDoUpdate({
        target: exercises.id,
        set: { ...values, deletedAt: null },
      })
      .returning();

    await replaceAdditionalTags(id, input.additionalTagIds);
    await refreshEmbedding(db, layers.embedder, id);
    return context.json(toExerciseDto(row!, input.additionalTagIds), 201);
  });

  router.patch(
    '/exercises/:id',
    validateParam(idParamSchema),
    validateJson(updateExerciseBodySchema),
    async (context) => {
      const principal = context.get('principal');
      const { id } = context.req.valid('param');
      const input = context.req.valid('json');

      const existing = await loadOne(id);
      if (!existing || existing.row.deletedAt !== null) throw notFound('No such exercise');
      assertMayModify(existing.row, principal);

      const primaryTagId = input.primaryTagId ?? existing.row.primaryTagId;
      const additionalTagIds = input.additionalTagIds ?? existing.additionalTagIds;
      await assertTagsUsable(db, primaryTagId, additionalTagIds);

      const name = input.name ?? existing.row.name;
      const newSlug = slug(name);
      const gym = input.gym === undefined ? existing.row.gym : input.gym;
      // Id nie zmienia się przy edycji (patrz komentarz niżej), ale wiersz musi
      // dalej być jedyny w obrębie „nazwa + siłownia" tego autora — tę samą
      // unikalność sprawdza push, więc zapytanie mieszka w warstwie reguł.
      const identity = { authorId: existing.row.authorId, slug: newSlug, gym, exceptId: id };
      if (await exerciseNameTaken(db, identity))
        throw conflict(describeRejection(EXERCISE_RULES.nameTaken));

      // Identyfikator zostaje niezmieniony, choć nazwa się zmieniła. Wylicza się
      // z nazwy wyłącznie **przy tworzeniu** — inaczej poprawienie literówki
      // osierociłoby wszystkie serie wskazujące na stare id.
      const [row] = await db
        .update(exercises)
        .set({
          name,
          slug: newSlug,
          primaryTagId,
          note: input.note === undefined ? existing.row.note : input.note,
          gym,
          ...stampWrite(),
        })
        .where(eq(exercises.id, id))
        .returning();

      if (input.additionalTagIds) await replaceAdditionalTags(id, additionalTagIds);
      // Nazwa albo tag główny mogły się zmienić, a wektor liczy się z obojga.
      // `refreshEmbedding` sam rozpozna, że tekst źródłowy jest ten sam, i nie
      // pojedzie po niego do dostawcy modeli.
      await refreshEmbedding(db, layers.embedder, id);
      return context.json(toExerciseDto(row!, additionalTagIds));
    },
  );

  router.delete('/exercises/:id', validateParam(idParamSchema), async (context) => {
    const principal = context.get('principal');
    const { id } = context.req.valid('param');

    const existing = await loadOne(id);
    if (!existing || existing.row.deletedAt !== null) throw notFound('No such exercise');
    assertMayModify(existing.row, principal);

    // Ta sama reguła obowiązuje tombstone przyjeżdżający pushem — dlatego
    // predykat mieszka osobno, a nie w ciele tego handlera.
    if (await isExerciseInUse(db, id)) throw conflict(describeRejection(EXERCISE_IN_USE));

    await db.update(exercises).set(stampDelete()).where(eq(exercises.id, id));
    return context.body(null, 204);
  });

  return router;
}
