/**
 * Tabele używane przez API, zebrane w jeden obiekt.
 *
 * Wejście `@alphapump/db/pg` wystawia obok tabel także seed i typy pomocnicze;
 * Drizzle chce dostać sam schemat, więc lista jest tu wypisana wprost.
 */

export {
  accounts,
  apiKeys,
  cycleGoals,
  cycles,
  duplicateCheckCache,
  exerciseEmbeddings,
  exerciseRecords,
  exerciseTags,
  exercises,
  rateLimits,
  sessions,
  tags,
  users,
  verifications,
  workoutSets,
} from '@alphapump/db/pg';

import {
  accounts,
  apiKeys,
  cycleGoals,
  cycles,
  duplicateCheckCache,
  exerciseEmbeddings,
  exerciseRecords,
  exerciseTags,
  exercises,
  rateLimits,
  sessions,
  tags,
  users,
  verifications,
  workoutSets,
} from '@alphapump/db/pg';

export const schema = {
  users,
  sessions,
  accounts,
  verifications,
  apiKeys,
  rateLimits,
  tags,
  exercises,
  exerciseTags,
  workoutSets,
  cycles,
  cycleGoals,
  exerciseRecords,
  exerciseEmbeddings,
  duplicateCheckCache,
} as const;

export type Schema = typeof schema;
