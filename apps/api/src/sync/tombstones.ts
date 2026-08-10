/**
 * Porządkowanie tombstone'ów.
 *
 * Wiersz usunięty nie znika — zostaje z `deleted_at`, bo inaczej pull nie miałby
 * czym przywieźć informacji o usunięciu. Kiedyś jednak trzeba go zdjąć, żeby
 * baza nie rosła w nieskończoność o rzeczy, których nikt już nigdy nie zobaczy.
 *
 * ## Okno retencji nie jest parametrem kosmetycznym
 *
 * Urządzenie, które było offline dłużej niż okno retencji, **nigdy nie dowie
 * się o usunięciu** — tombstone zdążył zniknąć, zanim jego kursor po niego
 * sięgnął. Co gorsza, jego push wyglądałby wtedy jak dodanie wiersza, którego
 * serwer nie zna, więc usunięta seria wróciłaby do życia.
 *
 * Dlatego okno musi być dłuższe niż najdłuższa realna przerwa w synchronizacji.
 * Domyślne 90 dni jest z zapasem względem telefonu, który wraca do aplikacji
 * raz na kwartał.
 *
 * ## Dlaczego tylko wiersze, na które nic nie wskazuje
 *
 * Usunięcie miękkie zachowuje spójność: seria dalej wskazuje na swoje
 * ćwiczenie, nawet gdy ćwiczenie jest skasowane. Usunięcie twarde tę spójność
 * łamie, więc czyścimy wyłącznie wiersze bez odwołań — inaczej sprzątanie
 * kosztowałoby historię treningową.
 */

import { and, eq, exists, isNotNull, lt, not, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Database } from '../db.js';
import { cycleGoals, cycles, exerciseTags, exercises, tags, workoutSets } from '../schema.js';

/** Domyślne okno retencji tombstone'ów. */
export const DEFAULT_TOMBSTONE_RETENTION_DAYS = 90;

export interface PruneReport {
  sets: number;
  cycles: number;
  exercises: number;
  tags: number;
}

/**
 * Zdejmuje tombstone'y starsze niż `olderThan`, w kolejności od liści do
 * korzeni — inaczej ćwiczenie nigdy nie doczekałoby się usunięcia, bo do
 * ostatniej chwili wskazywałaby na nie skasowana seria.
 */
export async function pruneTombstones(db: Database, olderThan: Date): Promise<PruneReport> {
  const expired = (column: PgColumn) => and(isNotNull(column), lt(column, olderThan));

  /** `NOT EXISTS (SELECT 1 FROM <tabela> WHERE <klucz obcy> = <klucz główny>)`. */
  const unreferenced = (foreignKey: PgColumn, primaryKey: PgColumn) =>
    not(
      exists(
        db
          .select({ one: sql`1` })
          .from(foreignKey.table)
          .where(eq(foreignKey, primaryKey)),
      ),
    );

  const removedSets = await db
    .delete(workoutSets)
    .where(expired(workoutSets.deletedAt))
    .returning({ id: workoutSets.id });

  // Pozycje celu znikają kaskadą razem z cyklem.
  const removedCycles = await db
    .delete(cycles)
    .where(expired(cycles.deletedAt))
    .returning({ id: cycles.id });

  const removedExercises = await db
    .delete(exercises)
    .where(
      and(
        expired(exercises.deletedAt),
        unreferenced(workoutSets.exerciseId, exercises.id),
        unreferenced(cycleGoals.exerciseId, exercises.id),
      ),
    )
    .returning({ id: exercises.id });

  const removedTags = await db
    .delete(tags)
    .where(
      and(
        expired(tags.deletedAt),
        unreferenced(exercises.primaryTagId, tags.id),
        unreferenced(exerciseTags.tagId, tags.id),
        unreferenced(cycleGoals.tagId, tags.id),
      ),
    )
    .returning({ id: tags.id });

  return {
    sets: removedSets.length,
    cycles: removedCycles.length,
    exercises: removedExercises.length,
    tags: removedTags.length,
  };
}

/** Moment odcięcia dla podanej liczby dni wstecz. */
export function retentionCutoff(days: number, now: Date): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}
