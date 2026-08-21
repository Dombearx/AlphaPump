/**
 * Tagi w panelu biblioteki: widok użycia, scalenie, przywrócenie.
 *
 * Tag jest bytem globalnym — nie ma autora i nie należy do nikogo — więc
 * „wbudowany" rozpoznaje się po identyfikatorze z seeda, a nie po właścicielu.
 * Scalenie przepina ćwiczenia po obu rolach (tag główny i dodatkowy) oraz cele
 * cykli; zestaw tagów ćwiczenia jest **zbiorem**, więc wiersz, który po
 * przepięciu byłby powtórzeniem, znika zamiast się zdublować.
 */

import { type LibraryTag } from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../../context.js';
import { toTagDto } from '../../dto.js';
import { NO_BACKLOG } from '../../duplicates/index.js';
import { conflict, notFound } from '../../errors.js';
import { validateJson, validateParam, validateQuery } from '../../middleware/validate.js';
import { cycleGoals, exerciseTags, exercises, tags } from '../../schema.js';
import { idParamSchema } from '../../schemas.js';
import { stampDelete, stampWrite } from '../../sync-columns.js';
import {
  SEED_TAG_IDS,
  goalCounts,
  libraryTagsQuerySchema,
  mergeBodySchema,
  setStatsByExercise,
} from './shared.js';

export function createLibraryTagRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const embeddings = dependencies.embeddings ?? NO_BACKLOG;

  const loadTag = async (id: string) => {
    const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    return row ?? null;
  };

  router.get('/admin/library/tags', validateQuery(libraryTagsQuerySchema), async (context) => {
    const query = context.req.valid('query');

    const rows = await db
      .select()
      .from(tags)
      .where(query.includeDeleted ? undefined : isNull(tags.deletedAt))
      .orderBy(asc(tags.name));

    // Pary „tag → ćwiczenie" zamiast gotowych sum: liczba ćwiczeń unikalnych
    // nie jest sumą głównych i dodatkowych, bo ten sam tag bywa główny jednego
    // ćwiczenia i dodatkowy drugiego. Biblioteka ma rozmiar setek wierszy,
    // a to jest ekran administracyjny.
    const live = await db
      .select({ id: exercises.id, primaryTagId: exercises.primaryTagId })
      .from(exercises)
      .where(isNull(exercises.deletedAt));
    const liveIds = new Set(live.map((row) => row.id));

    const links = await db.select().from(exerciseTags);
    const stats = await setStatsByExercise(db);
    const goals = await goalCounts(db);

    const primary = new Map<string, string[]>();
    for (const row of live) {
      const bucket = primary.get(row.primaryTagId);
      if (bucket) bucket.push(row.id);
      else primary.set(row.primaryTagId, [row.id]);
    }

    const additional = new Map<string, string[]>();
    for (const link of links) {
      if (!liveIds.has(link.exerciseId)) continue;
      const bucket = additional.get(link.tagId);
      if (bucket) bucket.push(link.exerciseId);
      else additional.set(link.tagId, [link.exerciseId]);
    }

    const payload: LibraryTag[] = rows.map((row) => {
      const primaryIds = primary.get(row.id) ?? [];
      const additionalIds = additional.get(row.id) ?? [];
      const unique = new Set([...primaryIds, ...additionalIds]);

      let sets = 0;
      for (const exerciseId of unique) sets += stats.get(exerciseId)?.sets ?? 0;

      return {
        tag: toTagDto(row),
        builtIn: SEED_TAG_IDS.has(row.id),
        usage: {
          primaryExercises: primaryIds.length,
          additionalExercises: additionalIds.length,
          exercises: unique.size,
          sets,
          goals: goals.byTag.get(row.id) ?? 0,
        },
      };
    });

    return context.json({ tags: payload });
  });

  router.post(
    '/admin/library/tags/:id/merge',
    validateParam(idParamSchema),
    validateJson(mergeBodySchema),
    async (context) => {
      const { id } = context.req.valid('param');
      const { targetId } = context.req.valid('json');

      if (id === targetId) throw conflict('Source and target are the same tag');

      const source = await loadTag(id);
      if (!source) throw notFound('No such source tag');
      const target = await loadTag(targetId);
      if (!target || target.deletedAt !== null) throw notFound('No such target tag');

      // Ćwiczenia z tombstonem też przepinamy: gdyby zostały przy tagu zdjętym,
      // ich przywrócenie odbiłoby się o „tag główny jest usunięty".
      const primaryHolders = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(eq(exercises.primaryTagId, id));
      const primaryIds = primaryHolders.map((row) => row.id);

      const report = await db.transaction(async (tx) => {
        const sourceLinks = await tx
          .select({ exerciseId: exerciseTags.exerciseId })
          .from(exerciseTags)
          .where(eq(exerciseTags.tagId, id));
        const targetLinks = await tx
          .select({ exerciseId: exerciseTags.exerciseId })
          .from(exerciseTags)
          .where(eq(exerciseTags.tagId, targetId));

        const hasTarget = new Set(targetLinks.map((row) => row.exerciseId));
        const targetPrimary = await tx
          .select({ id: exercises.id })
          .from(exercises)
          .where(eq(exercises.primaryTagId, targetId));
        const willHaveTargetAsPrimary = new Set([
          ...primaryIds,
          ...targetPrimary.map((row) => row.id),
        ]);

        // Wiersz, który po przepięciu powtarzałby tag już przypięty do tego
        // ćwiczenia — albo zderzyłby się z jego tagiem głównym — zostaje zdjęty.
        // Zestaw tagów ćwiczenia jest zbiorem: nic tu nie ginie.
        const redundant = sourceLinks.filter(
          (row) => hasTarget.has(row.exerciseId) || willHaveTargetAsPrimary.has(row.exerciseId),
        );
        const movable = sourceLinks.filter(
          (row) => !hasTarget.has(row.exerciseId) && !willHaveTargetAsPrimary.has(row.exerciseId),
        );

        if (redundant.length > 0) {
          await tx.delete(exerciseTags).where(
            and(
              eq(exerciseTags.tagId, id),
              inArray(
                exerciseTags.exerciseId,
                redundant.map((row) => row.exerciseId),
              ),
            ),
          );
        }
        if (movable.length > 0) {
          await tx
            .update(exerciseTags)
            .set({ tagId: targetId })
            .where(
              and(
                eq(exerciseTags.tagId, id),
                inArray(
                  exerciseTags.exerciseId,
                  movable.map((row) => row.exerciseId),
                ),
              ),
            );
        }

        if (primaryIds.length > 0) {
          await tx
            .update(exercises)
            .set({ primaryTagId: targetId, ...stampWrite() })
            .where(inArray(exercises.id, primaryIds));
        }
        // Ćwiczenia, którym zmienił się wyłącznie zestaw tagów dodatkowych, też
        // muszą pojechać na telefony — zestaw jedzie razem z wierszem ćwiczenia.
        const touchedByLinks = [...movable, ...redundant]
          .map((row) => row.exerciseId)
          .filter((exerciseId) => !primaryIds.includes(exerciseId));
        if (touchedByLinks.length > 0) {
          await tx
            .update(exercises)
            .set(stampWrite())
            .where(inArray(exercises.id, [...new Set(touchedByLinks)]));
        }

        const existingGoals = await tx
          .select({ cycleId: cycleGoals.cycleId, metric: cycleGoals.metric })
          .from(cycleGoals)
          .where(eq(cycleGoals.tagId, targetId));
        const taken = new Set(existingGoals.map((goal) => `${goal.cycleId}:${goal.metric}`));

        const sourceGoals = await tx
          .select({ id: cycleGoals.id, cycleId: cycleGoals.cycleId, metric: cycleGoals.metric })
          .from(cycleGoals)
          .where(eq(cycleGoals.tagId, id));
        const movableGoals = sourceGoals.filter(
          (goal) => !taken.has(`${goal.cycleId}:${goal.metric}`),
        );
        const duplicated = sourceGoals.filter((goal) =>
          taken.has(`${goal.cycleId}:${goal.metric}`),
        );

        if (movableGoals.length > 0) {
          await tx
            .update(cycleGoals)
            .set({ tagId: targetId })
            .where(
              inArray(
                cycleGoals.id,
                movableGoals.map((goal) => goal.id),
              ),
            );
        }
        if (duplicated.length > 0) {
          await tx.delete(cycleGoals).where(
            inArray(
              cycleGoals.id,
              duplicated.map((goal) => goal.id),
            ),
          );
        }

        if (source.deletedAt === null) {
          await tx.update(tags).set(stampDelete()).where(eq(tags.id, id));
        }

        return {
          sourceId: id,
          targetId,
          movedPrimary: primaryIds.length,
          movedAdditional: movable.length,
          mergedAdditional: redundant.length,
          movedGoals: movableGoals.length,
        };
      });

      // Wektor liczy się z nazwy ćwiczenia **i jego tagu głównego**, więc zmiana
      // tagu głównego czyni go nieaktualnym. Do kolejki, nie w miejscu: scalenie
      // tagu potrafi dotknąć całej biblioteki, a panel nie ma na co czekać.
      embeddings.enqueue(primaryIds);

      return context.json(report);
    },
  );

  router.post('/admin/library/tags/:id/restore', validateParam(idParamSchema), async (context) => {
    const { id } = context.req.valid('param');

    const existing = await loadTag(id);
    if (!existing) throw notFound('No such tag');
    if (existing.deletedAt === null) throw conflict('This tag is not deleted');

    // Identyfikator tagu wynika ze sluga, więc kolizja slugów pod innym id znaczy,
    // że ktoś zdążył utworzyć tag o tej nazwie po zmianie nazwy tego wiersza.
    const [collision] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.slug, existing.slug), isNull(tags.deletedAt), ne(tags.id, id)))
      .limit(1);
    if (collision) {
      throw conflict(
        'A tag with that name already exists under a different identifier — merge them instead',
      );
    }

    const [row] = await db
      .update(tags)
      .set({ deletedAt: null, ...stampWrite() })
      .where(eq(tags.id, id))
      .returning();

    return context.json(toTagDto(row!));
  });

  return router;
}
