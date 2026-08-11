/**
 * Rekordy globalne ćwiczeń — przeliczenie wpięte w listę z `sync/derived.ts`.
 *
 * To jest ten kawałek, który spłaca dług z etapu 4: zakres dotknięty pushem był
 * zbierany od tamtego etapu, ale lista przeliczeń stała pusta, bo jedyne dane
 * pochodne trzymane na serwerze — właśnie rekordy globalne — powstają dopiero
 * tutaj.
 *
 * ## Dlaczego przelicza się od zera, a nie korygująco
 *
 * Rekord jest funkcją **całego** zbioru serii ćwiczenia. Usunięcie serii może
 * wskrzesić rekord, który wcześniej został zdominowany, a edycja może zbić
 * kilka naraz — korekta musiałaby odtworzyć poprzedni stan frontu, czyli
 * policzyć go od nowa. Przeliczenie od zera dla dotkniętego ćwiczenia jest więc
 * i prostsze, i jedyne poprawne.
 *
 * ## Dlaczego front liczy `@alphapump/core`, a nie SQL
 *
 * Ten sam `computeRecords` liczy rekordy indywidualne na telefonie. Napisanie
 * dominacji Pareto drugi raz w SQL-u dałoby dwie implementacje tej samej reguły
 * — a ich rozjazd jest niewidoczny w kodzie i natychmiast widoczny dla
 * użytkownika: aplikacja pokazywałaby inny rekord niż ranking.
 *
 * ## Zakres
 *
 * Wejściem jest para (użytkownik, ćwiczenie), ale rekord globalny jest z definicji
 * ponad użytkownikami — liczy się go z sum wszystkich serii ćwiczenia. Z zakresu
 * bierzemy więc wyłącznie **zbiór ćwiczeń**; kto dotknął serii, nie ma znaczenia.
 */

import { compareSetsChronologically, computeRecords, type LoggingType } from '@alphapump/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exerciseRecords, exercises, workoutSets } from '../schema.js';
import type { AffectedScope, DerivedRecomputation } from '../sync/derived.js';

/** Ćwiczenia z zakresu, bez podziału na użytkowników. */
export function affectedExercises(scope: AffectedScope): string[] {
  const ids = new Set<string>();
  for (const exercisesOfUser of scope.exercisesByUser.values()) {
    for (const exerciseId of exercisesOfUser) ids.add(exerciseId);
  }
  return [...ids];
}

/**
 * Przelicza front Pareto jednego ćwiczenia i podmienia komplet jego wierszy
 * w `exercise_records`.
 *
 * Podmiana idzie w transakcji: między skasowaniem starego frontu a wstawieniem
 * nowego tabela byłaby niespójna, a rankingi czytają ją bez uzgadniania
 * z pushem.
 */
export async function recomputeGlobalRecordsFor(db: Database, exerciseId: string): Promise<void> {
  const [exercise] = await db
    .select({ loggingType: exercises.loggingType })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);

  // Ćwiczenie usunięte twardo (porządkowanie tombstone'ów) zabrało kaskadą swoje
  // rekordy — nie ma czego liczyć. Ćwiczenie usunięte miękko liczymy dalej:
  // serie zostały, więc rekord z nich dalej jest prawdziwy.
  if (!exercise) return;

  const loggingType: LoggingType = exercise.loggingType;

  const sets = await db
    .select({
      id: workoutSets.id,
      userId: workoutSets.userId,
      performedOn: workoutSets.performedOn,
      position: workoutSets.position,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      note: workoutSets.note,
    })
    .from(workoutSets)
    .where(and(eq(workoutSets.exerciseId, exerciseId), isNull(workoutSets.deletedAt)));

  // Porządek chronologiczny nie jest kosmetyką: przy dokładnym remisie rekord
  // przypada tej serii, która padła wcześniej. Bez ustalonego porządku dwa
  // przeliczenia tego samego zbioru mogłyby wskazać różnych zdobywców.
  const front = computeRecords(loggingType, [...sets].sort(compareSetsChronologically));

  await db.transaction(async (tx) => {
    await tx.delete(exerciseRecords).where(eq(exerciseRecords.exerciseId, exerciseId));
    if (front.length === 0) return;

    await tx.insert(exerciseRecords).values(
      front.map((set, position) => ({
        exerciseId,
        setId: set.id,
        userId: set.userId,
        performedOn: set.performedOn,
        position,
        weightG: set.weightG,
        reps: set.reps,
        durationS: set.durationS,
        distanceM: set.distanceM,
        note: set.note,
        computedAt: new Date(),
      })),
    );
  });
}

/** Przeliczenie do wpięcia w listę wołaną po pushu i po CRUD-zie serii. */
export const recomputeGlobalRecords: DerivedRecomputation = async (db, scope) => {
  for (const exerciseId of affectedExercises(scope)) {
    await recomputeGlobalRecordsFor(db, exerciseId);
  }
};
