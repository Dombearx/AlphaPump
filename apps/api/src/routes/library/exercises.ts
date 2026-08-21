/**
 * Ćwiczenia w panelu biblioteki: widok użycia, podobne, scalenie, przywrócenie.
 *
 * Scalenie jest tu operacją najcięższą i jedyną, która **przenosi cudze dane**:
 * serie wszystkich użytkowników przechodzą na ćwiczenie docelowe, a źródło
 * dopiero potem dostaje tombstone. Dlatego cała podmiana idzie jedną transakcją,
 * a rekordy globalne przeliczają się po obu stronach — front Pareto jest funkcją
 * całego zbioru serii ćwiczenia, więc rusza się i tam, skąd serie wyszły.
 */

import { SYSTEM_USER } from '@alphapump/db';
import { type LibraryExercise } from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../../context.js';
import { toExerciseDto } from '../../dto.js';
import {
  NO_LAYERS,
  dropEmbeddings,
  findDuplicates,
  refreshEmbedding,
} from '../../duplicates/index.js';
import { conflict, notFound } from '../../errors.js';
import { validateJson, validateParam, validateQuery } from '../../middleware/validate.js';
import {
  cycleGoals,
  exerciseEmbeddings,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../../schema.js';
import { idParamSchema } from '../../schemas.js';
import { emptyScope, noteAffectedSet, recomputeDerived } from '../../sync/derived.js';
import { stampDelete, stampWrite } from '../../sync-columns.js';
import {
  EMPTY_STATS,
  additionalTagsByExercise,
  goalCounts,
  libraryExercisesQuerySchema,
  mergeBodySchema,
  setStatsByExercise,
  similarQuerySchema,
} from './shared.js';

export function createLibraryExerciseRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const layers = dependencies.duplicates ?? NO_LAYERS;
  const recomputations = dependencies.derived ?? [];

  const loadExercise = async (id: string) => {
    const [row] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
    return row ?? null;
  };

  /** Przeliczenie rekordów globalnych po przeniesieniu serii między ćwiczeniami. */
  const recomputeFor = async (userIds: readonly string[], exerciseIds: readonly string[]) => {
    const scope = emptyScope();
    for (const userId of userIds) {
      for (const exerciseId of exerciseIds) noteAffectedSet(scope, userId, exerciseId);
    }
    await recomputeDerived(db, scope, recomputations);
  };

  router.get(
    '/admin/library/exercises',
    validateQuery(libraryExercisesQuerySchema),
    async (context) => {
      const query = context.req.valid('query');

      const rows = await db
        .select({ exercise: exercises, authorNickname: users.nickname })
        .from(exercises)
        .innerJoin(users, eq(users.id, exercises.authorId))
        .where(query.includeDeleted ? undefined : isNull(exercises.deletedAt))
        .orderBy(asc(exercises.name));

      const stats = await setStatsByExercise(db);
      const goals = await goalCounts(db);
      const additional = await additionalTagsByExercise(db);
      const embedded = new Set(
        (await db.select({ id: exerciseEmbeddings.exerciseId }).from(exerciseEmbeddings)).map(
          (row) => row.id,
        ),
      );

      const payload: LibraryExercise[] = rows.map((row) => {
        const usage = stats.get(row.exercise.id) ?? EMPTY_STATS;
        return {
          exercise: toExerciseDto(row.exercise, additional.get(row.exercise.id) ?? []),
          authorNickname: row.authorNickname,
          builtIn: row.exercise.authorId === SYSTEM_USER.id,
          hasEmbedding: embedded.has(row.exercise.id),
          usage: { ...usage, goals: goals.byExercise.get(row.exercise.id) ?? 0 },
        };
      });

      return context.json({ exercises: payload });
    },
  );

  router.get(
    '/admin/library/exercises/:id/similar',
    validateParam(idParamSchema),
    validateQuery(similarQuerySchema),
    async (context) => {
      const { id } = context.req.valid('param');
      const { limit } = context.req.valid('query');

      const exercise = await loadExercise(id);
      if (!exercise) throw notFound('No such exercise');

      return context.json(
        await findDuplicates(db, layers, { name: exercise.name, excludeId: id, limit }),
      );
    },
  );

  router.post(
    '/admin/library/exercises/:id/merge',
    validateParam(idParamSchema),
    validateJson(mergeBodySchema),
    async (context) => {
      const { id } = context.req.valid('param');
      const { targetId } = context.req.valid('json');

      if (id === targetId) throw conflict('Source and target are the same exercise');

      const source = await loadExercise(id);
      if (!source) throw notFound('No such source exercise');
      const target = await loadExercise(targetId);
      if (!target || target.deletedAt !== null) {
        throw notFound('No such target exercise');
      }

      // Serie są walidowane względem typu logowania **ćwiczenia**. Przeniesienie
      // ich pod ćwiczenie innego typu dałoby wiersze, których nie przyjąłby
      // żaden zapis — i których nie da się już poprawić edycją, bo typ logowania
      // jest nieedytowalny.
      if (source.loggingType !== target.loggingType) {
        throw conflict(
          `The exercises log different measurements (${source.loggingType} and ${target.loggingType}) — ` +
            'the moved sets would not match the target exercise',
        );
      }

      const owners = await db
        .selectDistinct({ userId: workoutSets.userId })
        .from(workoutSets)
        .where(eq(workoutSets.exerciseId, id));

      const report = await db.transaction(async (tx) => {
        // Serie usunięte jadą razem z żywymi: tombstone zostawiony przy zdjętym
        // ćwiczeniu wróciłby na telefon jako seria wskazująca w próżnię.
        const movedSets = await tx
          .update(workoutSets)
          .set({ exerciseId: targetId, ...stampWrite() })
          .where(eq(workoutSets.exerciseId, id))
          .returning({ id: workoutSets.id, deletedAt: workoutSets.deletedAt });

        // Cel, który po przepięciu powtarzałby cel już istniejący w tym samym
        // cyklu, zostaje zdjęty zamiast zdublowany — inaczej cykl liczyłby to
        // samo ćwiczenie dwa razy.
        const existingGoals = await tx
          .select({ cycleId: cycleGoals.cycleId, metric: cycleGoals.metric })
          .from(cycleGoals)
          .where(eq(cycleGoals.exerciseId, targetId));
        const taken = new Set(existingGoals.map((goal) => `${goal.cycleId}:${goal.metric}`));

        const sourceGoals = await tx
          .select({ id: cycleGoals.id, cycleId: cycleGoals.cycleId, metric: cycleGoals.metric })
          .from(cycleGoals)
          .where(eq(cycleGoals.exerciseId, id));

        const movable = sourceGoals.filter((goal) => !taken.has(`${goal.cycleId}:${goal.metric}`));
        const duplicated = sourceGoals.filter((goal) =>
          taken.has(`${goal.cycleId}:${goal.metric}`),
        );

        if (movable.length > 0) {
          await tx
            .update(cycleGoals)
            .set({ exerciseId: targetId })
            .where(
              inArray(
                cycleGoals.id,
                movable.map((goal) => goal.id),
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
          await tx.update(exercises).set(stampDelete()).where(eq(exercises.id, id));
        }

        return {
          sourceId: id,
          targetId,
          movedSets: movedSets.filter((row) => row.deletedAt === null).length,
          movedDeletedSets: movedSets.filter((row) => row.deletedAt !== null).length,
          movedGoals: movable.length,
        };
      });

      // Front Pareto jest funkcją całego zbioru serii ćwiczenia, więc rusza się
      // po obu stronach: źródło zostaje puste, a cel dostaje cudzy komplet.
      await recomputeFor(
        owners.map((row) => row.userId),
        [id, targetId],
      );
      // Ćwiczenie zdjęte nie potrzebuje wektora — wyszukiwanie i tak go pomija.
      await dropEmbeddings(db, [id]);

      return context.json(report);
    },
  );

  router.post(
    '/admin/library/exercises/:id/restore',
    validateParam(idParamSchema),
    async (context) => {
      const { id } = context.req.valid('param');

      const existing = await loadExercise(id);
      if (!existing) throw notFound('No such exercise');
      if (existing.deletedAt === null) throw conflict('This exercise is not deleted');

      // Unikalność „autor + nazwa + siłownia" obowiązuje wyłącznie wiersze żywe,
      // więc w czasie, gdy ten leżał z tombstonem, ktoś mógł utworzyć drugi
      // o tej samej nazwie. Przywrócenie na siłę dałoby bibliotekę z dwoma.
      const [collision] = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(
          and(
            eq(exercises.authorId, existing.authorId),
            eq(exercises.slug, existing.slug),
            existing.gym === null ? isNull(exercises.gym) : eq(exercises.gym, existing.gym),
            isNull(exercises.deletedAt),
            ne(exercises.id, id),
          ),
        )
        .limit(1);
      if (collision) {
        throw conflict(
          'This author already has a live exercise with that name — merge them instead of restoring a second one',
        );
      }

      // Tag główny mógł zostać usunięty, gdy jedyne ćwiczenie, które go trzymało,
      // leżało z tombstonem. Ćwiczenie bez żywego tagu głównego nie istnieje.
      const [primaryTag] = await db
        .select({ deletedAt: tags.deletedAt })
        .from(tags)
        .where(eq(tags.id, existing.primaryTagId))
        .limit(1);
      if (!primaryTag || primaryTag.deletedAt !== null) {
        throw conflict('The primary tag of this exercise is deleted — restore the tag first');
      }

      const [row] = await db
        .update(exercises)
        .set({ deletedAt: null, ...stampWrite() })
        .where(eq(exercises.id, id))
        .returning();

      const additional = await db
        .select({ tagId: exerciseTags.tagId })
        .from(exerciseTags)
        .where(eq(exerciseTags.exerciseId, id))
        .orderBy(asc(exerciseTags.position));

      await refreshEmbedding(db, layers.embedder, id);

      return context.json(
        toExerciseDto(
          row!,
          additional.map((tag) => tag.tagId),
        ),
      );
    },
  );

  return router;
}
