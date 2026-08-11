/**
 * Schematy żądań — nadbudowa nad schematami z `@alphapump/core`.
 *
 * Rdzeń opisuje encje i wejścia formularzy; API dokłada wyłącznie to, co
 * wynika z bycia serwerem: możliwość podania identyfikatora nadanego na
 * telefonie oraz parametry filtrowania list.
 *
 * Przyjmowanie `id` od klienta nie jest luką, tylko warunkiem pracy offline:
 * seria dostaje UUIDv7 w momencie zapisania na telefonie, bez sieci. Gdyby
 * identyfikator nadawał serwer, ta sama seria wysłana dwa razy po zerwanym
 * połączeniu utworzyłaby dwa wiersze.
 */

import {
  DUPLICATE_CANDIDATE_LIMIT,
  createCycleInputSchema,
  createSetInputSchema,
  createTagInputSchema,
  cycleGoalInputSchema,
  displayNameSchema,
  isoDateSchema,
  rankingMetricSchema,
  updateExerciseInputSchema,
  uuidSchema,
  createExerciseInputSchema,
} from '@alphapump/core';
import { z } from 'zod';

/* ----------------------------------------------------------------------- tag */

export const createTagBodySchema = createTagInputSchema;

export const updateTagBodySchema = createTagInputSchema;

/* ----------------------------------------------------------------- ćwiczenie */

export const createExerciseBodySchema = createExerciseInputSchema;

export const updateExerciseBodySchema = updateExerciseInputSchema;

export const listExercisesQuerySchema = z.object({
  /** Filtruje po tagu głównym **i** dodatkowych — biblioteka filtruje po tagach. */
  tagId: uuidSchema.optional(),
  authorId: uuidSchema.optional(),
  /** `true` — tylko ćwiczenia wbudowane, `false` — tylko dodane przez użytkowników. */
  builtIn: z.stringbool().optional(),
  search: z.string().trim().min(1).max(80).optional(),
});

export const similarExercisesQuerySchema = z.object({
  /**
   * Nazwa, o którą pytamy. Bez `displayNameSchema`, bo pytanie leci **w trakcie
   * pisania** — nazwa jeszcze niekompletna nie może dawać błędu walidacji, tylko
   * pustą listę kandydatów.
   */
  name: z.string().trim().min(1).max(80),
  /** Pomijane ćwiczenie — przy edycji jest nim edytowany wiersz. */
  excludeId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(DUPLICATE_CANDIDATE_LIMIT).optional(),
});

/* --------------------------------------------------------------------- seria */

export const createSetBodySchema = createSetInputSchema.extend({
  /** Nadany na telefonie; gdy go brak, serwer wygeneruje własny. */
  id: uuidSchema.optional(),
  /** Gdy go brak, seria ląduje na końcu listy tego dnia. */
  position: z.int().min(0).optional(),
});

export const updateSetBodySchema = createSetBodySchema.partial().omit({ id: true });

export const listSetsQuerySchema = z.object({
  from: isoDateSchema.optional(),
  to: isoDateSchema.optional(),
  exerciseId: uuidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(200),
  offset: z.coerce.number().int().min(0).default(0),
});

/* ------------------------------------------------------------------ ranking */

export const rankingQuerySchema = z.object({
  metric: rankingMetricSchema.default('volume'),
  /** Ranking jednej grupy znajomych jest krótki; limit chroni przed pomyłką. */
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

/* ---------------------------------------------------------------------- cykl */

export const createCycleBodySchema = createCycleInputSchema;

export const updateCycleBodySchema = z.object({
  name: displayNameSchema.optional(),
  startsOn: isoDateSchema.optional(),
  endsOn: isoDateSchema.nullable().optional(),
  /** Podmiana kompletu pozycji; pominięcie zostawia dotychczasowe. */
  goals: z.array(cycleGoalInputSchema).min(1).optional(),
  /** Archiwizacja i przywrócenie cyklu. */
  archived: z.boolean().optional(),
});

export const listCyclesQuerySchema = z.object({
  includeArchived: z.stringbool().default(false),
});

/* ------------------------------------------------------------------ wspólne */

export const idParamSchema = z.object({ id: uuidSchema });
