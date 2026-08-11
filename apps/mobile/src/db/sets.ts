/**
 * Zapisywanie serii — cała ścieżka mutacji najważniejszego ekranu produktu.
 *
 * Trzy rzeczy dzieją się tu razem i **muszą** dziać się razem:
 *
 * 1. zapis wiersza do bazy lokalnej — bo to ona jest źródłem prawdy dla ekranu,
 * 2. wpis do outboxu — bo zmiana ma kiedyś dojechać na serwer,
 * 3. ocena rekordu — bo informacja „to rekord" ma się pojawić natychmiast
 *    i **bez sieci**.
 *
 * Rozdzielenie ich znaczyłoby, że awaria między krokami zostawia serię, która
 * nigdy nie pojedzie, albo wpis w kolejce bez wiersza. Dlatego jedna transakcja.
 *
 * Rekordy liczy `@alphapump/core` — ten sam kod, który liczy rekordy globalne na
 * serwerze. Nie ma tu drugiej implementacji frontu Pareto i nie może być:
 * rozjazd między telefonem a serwerem byłby niewidoczny w kodzie i bardzo
 * widoczny dla użytkownika.
 */

import {
  evaluateRecord,
  nextPosition,
  setInputSchemaFor,
  type IsoDate,
  type LoggingType,
  type RecordEvaluation,
} from '@alphapump/core';
import { newSetId } from '@alphapump/core';
import {
  exercises,
  workoutSets,
  type SqliteDatabase,
  type WorkoutSetRow,
} from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { enqueue } from '../sync/outbox';
import { exerciseHistory } from './queries';
import { withTransaction } from './transaction';

/**
 * Pomiary i notatka — wszystko, co użytkownik wpisuje w formularzu serii.
 *
 * Pola są wypisane wprost, zamiast dziedziczyć po `SetMeasurements`: tamten typ
 * jest `Readonly`, bo opisuje dane wchodzące do liczenia rekordów, a formularz
 * swoje pola wypełnia po kolei. Kształt jest ten sam, więc `SetValues` wszędzie
 * przechodzi tam, gdzie oczekiwane są pomiary.
 */
export interface SetValues {
  weightG: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  bodyweightG: number | null;
  note: string | null;
}

export interface SetAuthor {
  userId: string;
  /** Urządzenie zapisu; rozstrzyga remisy `updatedAt` przy synchronizacji. */
  deviceId: string;
}

export interface CreateSetCommand extends SetAuthor {
  exerciseId: string;
  performedOn: IsoDate;
  values: SetValues;
}

export interface UpdateSetCommand extends SetAuthor {
  setId: string;
  values: SetValues;
}

export interface SavedSet {
  id: string;
  /** Werdykt rekordu policzony offline, na miejscu, dla zapisanego stanu. */
  record: RecordEvaluation<WorkoutSetRow>;
}

/** Seria zniknęła między otwarciem ekranu a zapisem — na przykład przez pull. */
export class SetNotFoundError extends Error {
  constructor(setId: string) {
    super(`Nie ma serii o identyfikatorze ${setId}`);
    this.name = 'SetNotFoundError';
  }
}

export class ExerciseNotFoundError extends Error {
  constructor(exerciseId: string) {
    super(`Nie ma ćwiczenia o identyfikatorze ${exerciseId}`);
    this.name = 'ExerciseNotFoundError';
  }
}

/* ------------------------------------------------------------------ odczyty */

async function loadLoggingType(db: SqliteDatabase, exerciseId: string): Promise<LoggingType> {
  const [exercise] = await db
    .select({ loggingType: exercises.loggingType })
    .from(exercises)
    .where(eq(exercises.id, exerciseId))
    .limit(1);

  if (!exercise) throw new ExerciseNotFoundError(exerciseId);
  return exercise.loggingType;
}

/**
 * Wszystkie żywe serie użytkownika dla jednego ćwiczenia.
 *
 * To samo zapytanie, którym karmi się ekran — rekord ma być liczony z tego, co
 * użytkownik widzi. Historia jest **cała**, a nie z bieżącego dnia: seria
 * dopisana wstecz bije rekord dokładnie tak samo jak dzisiejsza.
 */
async function loadExerciseHistory(
  db: SqliteDatabase,
  userId: string,
  exerciseId: string,
): Promise<WorkoutSetRow[]> {
  return exerciseHistory(db, userId, exerciseId);
}

/* ------------------------------------------------------------------ mutacje */

/**
 * Waliduje pomiary względem typu logowania ćwiczenia.
 *
 * Ten sam schemat, którym waliduje żądania serwer — dzięki temu seria odrzucona
 * przez API nie ma jak najpierw wylądować w bazie lokalnej i wrócić dopiero
 * przy synchronizacji, gdy użytkownik dawno o niej zapomniał.
 */
function validated(
  loggingType: LoggingType,
  command: {
    exerciseId: string;
    performedOn: IsoDate;
    values: SetValues;
  },
): SetValues {
  const parsed = setInputSchemaFor(loggingType).parse({
    exerciseId: command.exerciseId,
    performedOn: command.performedOn,
    ...command.values,
  });

  return {
    weightG: parsed.weightG,
    reps: parsed.reps,
    durationS: parsed.durationS,
    distanceM: parsed.distanceM,
    bodyweightG: parsed.bodyweightG,
    note: parsed.note === null || parsed.note.length === 0 ? null : parsed.note,
  };
}

export async function createSet(
  db: SqliteDatabase,
  command: CreateSetCommand,
  now: Date = new Date(),
): Promise<SavedSet> {
  const loggingType = await loadLoggingType(db, command.exerciseId);
  const values = validated(loggingType, command);

  return withTransaction(db, async () => {
    const history = await loadExerciseHistory(db, command.userId, command.exerciseId);
    const id = newSetId();

    await db.insert(workoutSets).values({
      id,
      userId: command.userId,
      exerciseId: command.exerciseId,
      performedOn: command.performedOn,
      position: nextPosition(history, command.performedOn),
      ...values,
      createdAt: now,
      updatedAt: now,
      deviceId: command.deviceId,
    });

    await enqueue(db, 'set', id, now);

    return { id, record: evaluateRecord(loggingType, history, values) };
  });
}

/**
 * Edycja serii. Rekord oceniany jest ponownie, bo zmiana wartości potrafi
 * dopiero uczynić serię rekordową — albo odebrać jej ten status.
 */
export async function updateSet(
  db: SqliteDatabase,
  command: UpdateSetCommand,
  now: Date = new Date(),
): Promise<SavedSet> {
  const existing = await loadSet(db, command.setId);
  const loggingType = await loadLoggingType(db, existing.exerciseId);
  const values = validated(loggingType, {
    exerciseId: existing.exerciseId,
    performedOn: existing.performedOn,
    values: command.values,
  });

  return withTransaction(db, async () => {
    const history = (await loadExerciseHistory(db, existing.userId, existing.exerciseId)).filter(
      (set) => set.id !== existing.id,
    );

    await db
      .update(workoutSets)
      .set({ ...values, updatedAt: now, deviceId: command.deviceId })
      .where(eq(workoutSets.id, existing.id));

    await enqueue(db, 'set', existing.id, now);

    return { id: existing.id, record: evaluateRecord(loggingType, history, values) };
  });
}

/**
 * Usunięcie jest miękkie — bez tombstone'a usunięcie wykonane offline nie
 * miałoby jak dojechać na drugie urządzenie.
 *
 * Pozycji pozostałych serii nie przenumerowujemy. Dziura w numeracji niczego nie
 * psuje (liczy się porządek, nie ciągłość), a przenumerowanie brudziłoby outbox
 * wierszami, których użytkownik nie ruszał.
 */
export async function deleteSet(
  db: SqliteDatabase,
  setId: string,
  author: SetAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadSet(db, setId);

  await withTransaction(db, async () => {
    await db
      .update(workoutSets)
      .set({ deletedAt: now, updatedAt: now, deviceId: author.deviceId })
      .where(eq(workoutSets.id, existing.id));

    await enqueue(db, 'set', existing.id, now);
  });
}

export type MoveDirection = 'up' | 'down';

/**
 * Zmiana kolejności serii w obrębie dnia i ćwiczenia.
 *
 * Pozycje po przestawieniu są nadawane od zera, według nowego porządku, ale
 * zapisujemy **tylko wiersze, których numer faktycznie się zmienił**. Przy
 * gęstej numeracji przestawienie sąsiadów dotyka więc dwóch wierszy i tyle też
 * trafia do outboxu.
 *
 * Zwykła zamiana numerów byłaby krótsza i zawodziłaby po cichu tam, gdzie dwie
 * serie mają ten sam numer — a mają, gdy przyjechały z dwóch urządzeń albo
 * z importu. Przenumerowanie takie przypadki po prostu prostuje.
 *
 * Zwraca `false`, gdy nie ma dokąd przesuwać — seria jest już na skraju listy.
 */
export async function moveSet(
  db: SqliteDatabase,
  setId: string,
  direction: MoveDirection,
  author: SetAuthor,
  now: Date = new Date(),
): Promise<boolean> {
  const existing = await loadSet(db, setId);

  return withTransaction(db, async () => {
    const ordered = (await loadExerciseHistory(db, existing.userId, existing.exerciseId)).filter(
      (set) => set.performedOn === existing.performedOn,
    );

    const index = ordered.findIndex((set) => set.id === existing.id);
    const target = direction === 'up' ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= ordered.length) return false;

    const moved = ordered[index] as WorkoutSetRow;
    ordered[index] = ordered[target] as WorkoutSetRow;
    ordered[target] = moved;

    for (const [position, set] of ordered.entries()) {
      if (set.position === position) continue;

      await db
        .update(workoutSets)
        .set({ position, updatedAt: now, deviceId: author.deviceId })
        .where(eq(workoutSets.id, set.id));
      await enqueue(db, 'set', set.id, now);
    }

    return true;
  });
}

async function loadSet(db: SqliteDatabase, setId: string): Promise<WorkoutSetRow> {
  const [row] = await db.select().from(workoutSets).where(eq(workoutSets.id, setId)).limit(1);
  if (!row || row.deletedAt !== null) throw new SetNotFoundError(setId);
  return row;
}
