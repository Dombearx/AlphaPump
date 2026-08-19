/**
 * Porządkowanie biblioteki z panelu administracyjnego.
 *
 * ## Dlaczego to jednak są osobne endpointy
 *
 * Do tej pory panel zarządzał biblioteką **istniejącym** CRUD-em i to się nie
 * zmienia: dodawanie, edycja i usuwanie dalej idą przez `/exercises` i `/tags`,
 * bo osobna ścieżka zapisu byłaby drugim miejscem, w którym trzeba pamiętać
 * o tombstonie i `server_seq`. Tutaj jest wyłącznie to, czego w CRUD-zie nie ma
 * i być nie może, bo nie jest operacją na **jednym** wierszu:
 *
 * - **widok użycia** — „czy da się to usunąć" jest pytaniem o zapisane serie
 *   wszystkich użytkowników, a nie o uprawnienia pytającego,
 * - **scalenie** — przeniesienie serii z jednego ćwiczenia na drugie i dopiero
 *   potem zdjęcie źródła; usunięcie samo w sobie zabrałoby komuś historię,
 * - **przywrócenie** — zdjęcie tombstone'a, którego zwykły CRUD nie zna,
 * - **przeliczenie wektorów** całej biblioteki, żeby lista podobnych ćwiczeń
 *   działała także dla wierszy starszych niż warstwa semantyczna.
 *
 * ## Reguła, wokół której to wszystko stoi
 *
 * Nic z zalogowanego nie ginie. Ćwiczenie z seriami i tag, na którym coś wisi,
 * nie dają się usunąć w ogóle (patrz `exercise-usage.ts` i `tag-usage.ts`) —
 * jedyną drogą do pozbycia się duplikatu jest scalenie, czyli operacja, która
 * najpierw przenosi, a dopiero potem kasuje. Dlatego scalenie **nie** jest tu
 * wygodą, tylko jedynym wyjściem z sytuacji „to samo ćwiczenie stoi w bazie dwa
 * razy, a serie mam w obu".
 *
 * ## Co się dzieje z telefonami
 *
 * Scalenie i przywrócenie są zwykłymi zapisami z nowym `updated_at`
 * i `server_seq`, więc jadą na urządzenia normalnym pullem i wygrywają LWW
 * z wersją, którą telefon ma u siebie. Nie ma tu żadnego kanału obok
 * synchronizacji i nie ma go być — inaczej urządzenie offline zostałoby
 * z seriami wskazującymi na ćwiczenie, którego już nie ma.
 */

import { SEED_TAGS, SYSTEM_USER } from '@alphapump/db';
import {
  duplicateCheckResponseSchema,
  embeddingRefreshReportSchema,
  exerciseMergeReportSchema,
  exerciseSchema,
  libraryExerciseListSchema,
  libraryTagListSchema,
  mergeInputSchema,
  tagMergeReportSchema,
  tagSchema,
  type EmbeddingRefreshReport,
  type IsoDate,
  type LibraryExercise,
  type LibraryTag,
} from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import type { Database } from '../db.js';
import { toExerciseDto, toTagDto } from '../dto.js';
import {
  NO_LAYERS,
  dropEmbeddings,
  findDuplicates,
  refreshEmbedding,
  refreshEmbeddings,
} from '../duplicates/index.js';
import { conflict, notFound } from '../errors.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { validateJson, validateParam, validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import {
  cycleGoals,
  cycles,
  exerciseEmbeddings,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../schema.js';
import { idParamSchema } from '../schemas.js';
import { emptyScope, noteAffectedSet, recomputeDerived } from '../sync/derived.js';
import { stampDelete, stampWrite } from '../sync-columns.js';

/* ------------------------------------------------------------------ schematy */

/**
 * Jedyny parametr listy to tombstone'y.
 *
 * Filtrowania po nazwie, autorze i tagu tu nie ma **celowo**: panel i tak
 * potrzebuje kompletu wierszy, bo z niego bierze listę celów scalenia, a te
 * bywają poza filtrem, który akurat ustawiono. Powtórzenie filtrów `GET
 * /exercises` po stronie serwera byłoby drugą implementacją tych samych reguł,
 * używaną przez nikogo.
 */
export const libraryExercisesQuerySchema = z.object({
  /** Wiersze z tombstonem — bez nich nie da się niczego przywrócić. */
  includeDeleted: z.stringbool().default(false),
});

export const libraryTagsQuerySchema = z.object({
  includeDeleted: z.stringbool().default(false),
});

export const similarQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(10).optional(),
});

export const mergeBodySchema = mergeInputSchema;

/* -------------------------------------------------------------------- trasy */

export const adminLibraryRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/admin/library/exercises',
    summary: 'Ćwiczenia z widokiem użycia',
    description:
      'Biblioteka razem z tym, co na niej wisi: serie, użytkownicy, cele cykli i wektor. ' +
      'To te liczby, a nie uprawnienia, decydują o tym, czy wiersz da się usunąć. ' +
      'Zawsze komplet wierszy — filtrowanie należy do panelu, bo cel scalenia bywa poza filtrem.',
    tag: 'administracja',
    security: 'admin',
    query: libraryExercisesQuerySchema,
    responses: [{ status: 200, description: 'Ćwiczenia', schema: libraryExerciseListSchema }],
  },
  {
    method: 'get',
    path: '/admin/library/tags',
    summary: 'Tagi z widokiem użycia',
    description:
      'Tagi razem z liczbą ćwiczeń (osobno głównych i dodatkowych), serii zapisanych ' +
      'na tych ćwiczeniach oraz celów cyklu.',
    tag: 'administracja',
    security: 'admin',
    query: libraryTagsQuerySchema,
    responses: [{ status: 200, description: 'Tagi', schema: libraryTagListSchema }],
  },
  {
    method: 'get',
    path: '/admin/library/exercises/:id/similar',
    summary: 'Podobne ćwiczenia',
    description:
      'To samo wyszukiwanie hybrydowe, które ostrzega przed duplikatem przy tworzeniu ' +
      'ćwiczenia w aplikacji — tylko pytaniem jest nazwa istniejącego wiersza. ' +
      'Pole `layer` mówi, które warstwy się wykonały.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    query: similarQuerySchema,
    responses: [
      { status: 200, description: 'Kandydaci na duplikat', schema: duplicateCheckResponseSchema },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/exercises/:id/merge',
    summary: 'Scalenie ćwiczeń',
    description:
      'Przenosi serie i cele cyklu ze wskazanego ćwiczenia na docelowe, przelicza rekordy ' +
      'globalne po obu stronach i dopiero puste źródło oznacza jako usunięte. Typ logowania ' +
      'musi być ten sam — inaczej przeniesione serie nie pasowałyby do ćwiczenia docelowego.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    body: mergeBodySchema,
    responses: [
      { status: 200, description: 'Raport scalenia', schema: exerciseMergeReportSchema },
      { status: 404, description: 'Ćwiczenie źródłowe albo docelowe nie istnieje' },
      { status: 409, description: 'To samo ćwiczenie albo niezgodny typ logowania' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/exercises/:id/restore',
    summary: 'Przywrócenie ćwiczenia',
    description: 'Zdejmuje tombstone. Odmawia, gdy nazwa jest już zajęta u tego autora.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Ćwiczenie przywrócone', schema: exerciseSchema },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
      { status: 409, description: 'Ćwiczenie nie było usunięte, kolizja nazwy albo martwy tag' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/tags/:id/merge',
    summary: 'Scalenie tagów',
    description:
      'Przepina ćwiczenia (jako tag główny i jako dodatkowy) oraz cele cyklu na tag docelowy, ' +
      'a źródłowy oznacza jako usunięty. Ćwiczeniu, które miało oba tagi, zostaje jeden — ' +
      'zestaw tagów jest zbiorem, a nie listą.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    body: mergeBodySchema,
    responses: [
      { status: 200, description: 'Raport scalenia', schema: tagMergeReportSchema },
      { status: 404, description: 'Tag źródłowy albo docelowy nie istnieje' },
      { status: 409, description: 'To sam tag' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/tags/:id/restore',
    summary: 'Przywrócenie tagu',
    description: 'Zdejmuje tombstone. Odmawia, gdy tag o tej nazwie zdążył wrócić pod innym id.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Tag przywrócony', schema: tagSchema },
      { status: 404, description: 'Tag nie istnieje' },
      { status: 409, description: 'Tag nie był usunięty albo nazwa jest zajęta' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/embeddings/refresh',
    summary: 'Przeliczenie wektorów biblioteki',
    description:
      'Liczy brakujące i nieaktualne wektory wszystkich żywych ćwiczeń. Bez tego lista ' +
      'podobnych ćwiczeń widzi wyłącznie wiersze zapisane po włączeniu warstwy semantycznej. ' +
      '`enabled: false` znaczy, że warstwa jest wyłączona — i nie jest to błąd.',
    tag: 'administracja',
    security: 'admin',
    responses: [
      { status: 200, description: 'Raport przeliczenia', schema: embeddingRefreshReportSchema },
    ],
  },
];

/* ---------------------------------------------------------------- pomocnicze */

/** Serie w rozbiciu na ćwiczenia — jedno zapytanie zamiast `N + 1`. */
interface SetStats {
  sets: number;
  deletedSets: number;
  users: number;
  lastPerformedOn: IsoDate | null;
}

async function setStatsByExercise(db: Database): Promise<Map<string, SetStats>> {
  const live = sql`${workoutSets.deletedAt} is null`;
  const rows = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      sets: sql<number>`count(*) filter (where ${live})::int`,
      deletedSets: sql<number>`count(*) filter (where not (${live}))::int`,
      users: sql<number>`count(distinct ${workoutSets.userId}) filter (where ${live})::int`,
      lastPerformedOn: sql<IsoDate | null>`max(${workoutSets.performedOn}) filter (where ${live})`,
    })
    .from(workoutSets)
    .groupBy(workoutSets.exerciseId);

  return new Map(rows.map((row) => [row.exerciseId, row]));
}

/** Cele **żywych** cykli w rozbiciu na ćwiczenia i na tagi. */
async function goalCounts(db: Database): Promise<{
  byExercise: Map<string, number>;
  byTag: Map<string, number>;
}> {
  const rows = await db
    .select({ exerciseId: cycleGoals.exerciseId, tagId: cycleGoals.tagId })
    .from(cycleGoals)
    .innerJoin(cycles, and(eq(cycles.id, cycleGoals.cycleId), isNull(cycles.deletedAt)));

  const byExercise = new Map<string, number>();
  const byTag = new Map<string, number>();
  for (const row of rows) {
    if (row.exerciseId !== null) {
      byExercise.set(row.exerciseId, (byExercise.get(row.exerciseId) ?? 0) + 1);
    }
    if (row.tagId !== null) byTag.set(row.tagId, (byTag.get(row.tagId) ?? 0) + 1);
  }
  return { byExercise, byTag };
}

/** Tagi dodatkowe wszystkich ćwiczeń, w kolejności zapisanej w `position`. */
async function additionalTagsByExercise(db: Database): Promise<Map<string, string[]>> {
  const rows = await db.select().from(exerciseTags).orderBy(asc(exerciseTags.position));

  const byExercise = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byExercise.get(row.exerciseId);
    if (bucket) bucket.push(row.tagId);
    else byExercise.set(row.exerciseId, [row.tagId]);
  }
  return byExercise;
}

const EMPTY_STATS: SetStats = { sets: 0, deletedSets: 0, users: 0, lastPerformedOn: null };

/**
 * Identyfikatory tagów z seeda.
 *
 * Tag nie ma autora — jest bytem globalnym — więc „wbudowany" da się rozpoznać
 * wyłącznie po tym, że taki sam wiersz wstawia seed. Po identyfikatorze, a nie
 * po nazwie: id wylicza się z nazwy **przy tworzeniu** i zostaje przy jej
 * zmianie, więc przemianowany tag z seeda dalej jest rozpoznawany.
 */
const SEED_TAG_IDS = new Set(SEED_TAGS.map((tag) => tag.id));

/* ------------------------------------------------------------------- router */

export function createAdminLibraryRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const layers = dependencies.duplicates ?? NO_LAYERS;
  const recomputations = dependencies.derived ?? [];

  router.use('/admin/library/*', requireAdmin);

  const loadExercise = async (id: string) => {
    const [row] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
    return row ?? null;
  };

  const loadTag = async (id: string) => {
    const [row] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
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

  /* ------------------------------------------------------------- ćwiczenia */

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
      if (!exercise) throw notFound('Ćwiczenie nie istnieje');

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

      if (id === targetId) throw conflict('Ćwiczenia źródłowe i docelowe są tym samym wierszem');

      const source = await loadExercise(id);
      if (!source) throw notFound('Ćwiczenie źródłowe nie istnieje');
      const target = await loadExercise(targetId);
      if (!target || target.deletedAt !== null) {
        throw notFound('Ćwiczenie docelowe nie istnieje');
      }

      // Serie są walidowane względem typu logowania **ćwiczenia**. Przeniesienie
      // ich pod ćwiczenie innego typu dałoby wiersze, których nie przyjąłby
      // żaden zapis — i których nie da się już poprawić edycją, bo typ logowania
      // jest nieedytowalny.
      if (source.loggingType !== target.loggingType) {
        throw conflict(
          `Ćwiczenia mają różne typy logowania (${source.loggingType} i ${target.loggingType}) — ` +
            'przeniesione serie nie pasowałyby do ćwiczenia docelowego',
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
      if (!existing) throw notFound('Ćwiczenie nie istnieje');
      if (existing.deletedAt === null) throw conflict('Ćwiczenie nie jest usunięte');

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
          'Autor ma już żywe ćwiczenie o tej nazwie — scal je zamiast przywracać drugie',
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
        throw conflict('Tag główny tego ćwiczenia jest usunięty — przywróć najpierw tag');
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

  /* ------------------------------------------------------------------ tagi */

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

      if (id === targetId) throw conflict('Tagi źródłowy i docelowy są tym samym wierszem');

      const source = await loadTag(id);
      if (!source) throw notFound('Tag źródłowy nie istnieje');
      const target = await loadTag(targetId);
      if (!target || target.deletedAt !== null) throw notFound('Tag docelowy nie istnieje');

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
      // tagu głównego czyni go nieaktualnym.
      await refreshEmbeddings(db, layers, primaryIds);

      return context.json(report);
    },
  );

  router.post('/admin/library/tags/:id/restore', validateParam(idParamSchema), async (context) => {
    const { id } = context.req.valid('param');

    const existing = await loadTag(id);
    if (!existing) throw notFound('Tag nie istnieje');
    if (existing.deletedAt === null) throw conflict('Tag nie jest usunięty');

    // Identyfikator tagu wynika ze sluga, więc kolizja slugów pod innym id znaczy,
    // że ktoś zdążył utworzyć tag o tej nazwie po zmianie nazwy tego wiersza.
    const [collision] = await db
      .select({ id: tags.id })
      .from(tags)
      .where(and(eq(tags.slug, existing.slug), isNull(tags.deletedAt), ne(tags.id, id)))
      .limit(1);
    if (collision) {
      throw conflict(
        'Tag o tej nazwie już istnieje pod innym identyfikatorem — scal je zamiast tego',
      );
    }

    const [row] = await db
      .update(tags)
      .set({ deletedAt: null, ...stampWrite() })
      .where(eq(tags.id, id))
      .returning();

    return context.json(toTagDto(row!));
  });

  /* ------------------------------------------------------------ embeddingi */

  router.post('/admin/library/embeddings/refresh', async (context) => {
    const embedder = layers.embedder;
    if (embedder === null) {
      const empty: EmbeddingRefreshReport = {
        enabled: false,
        written: 0,
        unchanged: 0,
        failed: 0,
      };
      return context.json(empty);
    }

    const rows = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(isNull(exercises.deletedAt))
      .orderBy(asc(exercises.name));

    const report: EmbeddingRefreshReport = {
      enabled: true,
      written: 0,
      unchanged: 0,
      failed: 0,
    };

    // Sekwencyjnie, nie równolegle: równoległe wywołania u dostawcy modeli to
    // najkrótsza droga do limitu żądań, a to zadanie i tak jest ręczne.
    for (const row of rows) {
      const outcome = await refreshEmbedding(db, embedder, row.id);
      if (outcome === 'written') report.written += 1;
      else if (outcome === 'unchanged') report.unchanged += 1;
      else if (outcome === 'failed') report.failed += 1;
    }

    return context.json(report);
  });

  return router;
}
