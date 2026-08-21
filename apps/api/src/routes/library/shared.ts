/**
 * Liczby, na których stoi cały panel biblioteki.
 *
 * Trzy zapytania zbiorcze (serie, cele, tagi dodatkowe) i dwa zbiory stałych.
 * Mieszkają osobno od tras, bo używa ich każda z trzech — a każde z tych zapytań
 * czyta **całą** tabelę jednym strzałem zamiast wiersz po wierszu i to jest
 * jedyny powód, dla którego lista biblioteki mieści się w jednym żądaniu.
 */

import { SEED_TAGS } from '@alphapump/db';
import { mergeInputSchema, type IsoDate } from '@alphapump/core';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../../db.js';
import { cycleGoals, cycles, exerciseTags, workoutSets } from '../../schema.js';

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

/** Serie w rozbiciu na ćwiczenia — jedno zapytanie zamiast `N + 1`. */
export interface SetStats {
  sets: number;
  deletedSets: number;
  users: number;
  lastPerformedOn: IsoDate | null;
}

export async function setStatsByExercise(db: Database): Promise<Map<string, SetStats>> {
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
export async function goalCounts(db: Database): Promise<{
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
export async function additionalTagsByExercise(db: Database): Promise<Map<string, string[]>> {
  const rows = await db.select().from(exerciseTags).orderBy(asc(exerciseTags.position));

  const byExercise = new Map<string, string[]>();
  for (const row of rows) {
    const bucket = byExercise.get(row.exerciseId);
    if (bucket) bucket.push(row.tagId);
    else byExercise.set(row.exerciseId, [row.tagId]);
  }
  return byExercise;
}

export const EMPTY_STATS: SetStats = { sets: 0, deletedSets: 0, users: 0, lastPerformedOn: null };

/**
 * Identyfikatory tagów z seeda.
 *
 * Tag nie ma autora — jest bytem globalnym — więc „wbudowany" da się rozpoznać
 * wyłącznie po tym, że taki sam wiersz wstawia seed. Po identyfikatorze, a nie
 * po nazwie: id wylicza się z nazwy **przy tworzeniu** i zostaje przy jej
 * zmianie, więc przemianowany tag z seeda dalej jest rozpoznawany.
 */
export const SEED_TAG_IDS = new Set(SEED_TAGS.map((tag) => tag.id));
