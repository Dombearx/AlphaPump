/**
 * Odczyt biblioteki konta systemowego z żywej bazy.
 *
 * Wspólne dla dwóch konsumentów: CLI `regenerate-seed` (developer z dostępem
 * do bazy, piszący prosto na dysk) i endpointu panelu `GET /admin/seed/export`
 * (produkcja, gdzie repozytorium nie ma — patrz `deploy/Dockerfile.api`). Oba
 * mają dostać dokładnie te same dane; jedyna różnica jest w tym, co z nimi
 * zrobią (`writeFile` kontra odpowiedź JSON), więc odczyt i walidacja żyją
 * w jednym miejscu.
 */

import { builtInExerciseId, SYSTEM_USER_ID, tagId as tagIdOf } from '@alphapump/core';
import type { RenderSeedExercise } from '@alphapump/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exerciseTags, exercises, tags } from '../schema.js';

export interface SeedExport {
  tagNames: string[];
  exercises: RenderSeedExercise[];
  /**
   * Tagi/ćwiczenia, których nazwa zmieniła się po utworzeniu. Ich id w bazie
   * pochodzi ze *starej* nazwy, więc świeży seed wyliczony z aktualnej nazwy
   * nadałby im inne id niż to, które już krąży po syncu.
   */
  warnings: string[];
}

export async function loadSeedExport(db: Database): Promise<SeedExport> {
  const tagRows = await db
    .select()
    .from(tags)
    .where(isNull(tags.deletedAt))
    .orderBy(asc(tags.name));

  const exerciseRows = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.authorId, SYSTEM_USER_ID), isNull(exercises.deletedAt)))
    .orderBy(asc(exercises.name));

  const exerciseIds = exerciseRows.map((row) => row.id);
  const additionalTagRows =
    exerciseIds.length === 0
      ? []
      : await db
          .select()
          .from(exerciseTags)
          .where(inArray(exerciseTags.exerciseId, exerciseIds))
          .orderBy(asc(exerciseTags.position));

  const tagNameById = new Map(tagRows.map((tag) => [tag.id, tag.name]));
  const additionalByExercise = new Map<string, string[]>();
  for (const link of additionalTagRows) {
    const name = tagNameById.get(link.tagId);
    if (name === undefined) {
      throw new Error(
        `Ćwiczenie "${link.exerciseId}" ma tag dodatkowy "${link.tagId}", którego nie ma ` +
          'wśród aktywnych tagów (usunięty?) — popraw dane przed eksportem seeda.',
      );
    }
    const bucket = additionalByExercise.get(link.exerciseId);
    if (bucket) bucket.push(name);
    else additionalByExercise.set(link.exerciseId, [name]);
  }

  const warnings: string[] = [];
  for (const tag of tagRows) {
    if (tagIdOf(tag.name) !== tag.id) {
      warnings.push(
        `Tag "${tag.name}" (${tag.id}) ma inne id niż wyliczone z aktualnej nazwy — był ` +
          'zmieniony po utworzeniu. Świeży seed od zera nada mu NOWE id.',
      );
    }
  }

  const exerciseDefinitions: RenderSeedExercise[] = exerciseRows.map((exercise) => {
    if (builtInExerciseId(exercise.name) !== exercise.id) {
      warnings.push(
        `Ćwiczenie "${exercise.name}" (${exercise.id}) ma inne id niż wyliczone z aktualnej ` +
          'nazwy — było zmienione po utworzeniu. Świeży seed od zera nada mu NOWE id.',
      );
    }
    const primaryTag = tagNameById.get(exercise.primaryTagId);
    if (primaryTag === undefined) {
      throw new Error(
        `Ćwiczenie "${exercise.name}" wskazuje tag główny "${exercise.primaryTagId}", którego ` +
          'nie ma wśród aktywnych tagów (usunięty?) — popraw dane przed eksportem seeda.',
      );
    }
    return {
      name: exercise.name,
      loggingType: exercise.loggingType,
      primaryTag,
      additionalTags: additionalByExercise.get(exercise.id) ?? [],
    };
  });

  return { tagNames: tagRows.map((tag) => tag.name), exercises: exerciseDefinitions, warnings };
}
