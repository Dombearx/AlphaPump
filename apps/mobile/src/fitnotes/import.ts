/**
 * Zapis planu importu z FitNotesa do bazy lokalnej.
 *
 * Warstwa jest mechaniczna: co dopisać, a co jest duplikatem, rozstrzygnął już
 * `planFitNotesImport` z `@alphapump/core`. Tutaj zostaje wołanie tych samych
 * funkcji, którymi zapisuje ekran — `createTag`, `createExercise`, `createSet`.
 * Drugiej ścieżki zapisu nie ma i mieć nie może: to one pilnują walidacji
 * pomiarów, kolejności serii w dniu i wpisu do outboxu, bez którego zaimportowana
 * historia nigdy nie dojechałaby na serwer.
 *
 * ## Wiersz po wierszu, nie jedną transakcją
 *
 * Transakcje bazy lokalnej się nie zagnieżdżają, a każda z tych funkcji prowadzi
 * własną. Import przerwany w połowie zostawia więc to, co zdążyło wejść — i jest
 * to zachowanie bezpieczne, bo powtórzenie importu tego samego pliku rozpozna
 * zapisane serie jako duplikaty i dołoży wyłącznie resztę. Odwrotnie niż przy
 * eksporcie: tam plik jest cudzy i połowa zapisu byłaby gorsza niż nic.
 */

import { fitNotesNameKey, type FitNotesImportPlan } from '@alphapump/core';
import type { SqliteDatabase } from '@alphapump/db/sqlite';
import { createExercise, createTag, type LibraryAuthor } from '../db/library';
import { createSet } from '../db/sets';
import type { FitNotesLibraryExercise } from './source';

export interface FitNotesImportReport {
  /** Serie dopisane do dziennika. */
  sets: number;
  /** Ćwiczenia założone w bibliotece. */
  exercises: number;
  /** Wpisy pominięte, bo AlphaPump miał już taką serię. */
  duplicates: number;
  /** Wpisy, których nie dało się zapisać — patrz `planFitNotesImport`. */
  skipped: number;
}

export async function applyFitNotesImport(
  db: SqliteDatabase,
  plan: FitNotesImportPlan,
  library: readonly FitNotesLibraryExercise[],
  author: LibraryAuthor,
  now: Date = new Date(),
): Promise<FitNotesImportReport> {
  const idsByName = new Map(
    library.map((exercise) => [fitNotesNameKey(exercise.name), exercise.id]),
  );

  for (const exercise of plan.exercisesToCreate) {
    // Tag zakładamy sami — w przeciwną stronę nie możemy (darmowy FitNotes nie
    // pozwala tworzyć kategorii), ale u siebie nie ma powodu o to pytać.
    const tag = await createTag(db, { ...author, name: exercise.tagName }, now);
    const saved = await createExercise(
      db,
      {
        ...author,
        name: exercise.name,
        loggingType: exercise.loggingType,
        primaryTagId: tag.id,
        additionalTagIds: [],
        note: null,
        gym: null,
      },
      now,
    );
    idsByName.set(fitNotesNameKey(exercise.name), saved.id);
  }

  for (const set of plan.sets) {
    const exerciseId = idsByName.get(fitNotesNameKey(set.exerciseName));
    if (exerciseId === undefined) {
      // Plan i biblioteka rozjechałyby się tylko wtedy, gdyby powstały z różnych
      // odczytów. Wtedy lepiej przerwać niż zapisać serię „w powietrze".
      throw new Error(`No exercise in the library for "${set.exerciseName}"`);
    }

    await createSet(
      db,
      {
        ...author,
        exerciseId,
        performedOn: set.performedOn,
        values: {
          weightG: set.weightG,
          reps: set.reps,
          durationS: set.durationS,
          distanceM: set.distanceM,
          bodyweightG: null,
          note: null,
        },
      },
      now,
    );
  }

  return {
    sets: plan.sets.length,
    exercises: plan.exercisesToCreate.length,
    duplicates: plan.duplicates,
    skipped: plan.skipped,
  };
}
