/**
 * Zapis do pliku kopii FitNotesa.
 *
 * Plik `.fitnotes` jest nieszyfrowaną bazą SQLite, więc otwieramy go wprost —
 * bez zmiany rozszerzenia i bez formatu pośredniego. Warstwa jest mechaniczna:
 * decyzje (co jest duplikatem, którą kategorię podstawić, które ćwiczenie
 * dopiero utworzyć) podjął już `planFitNotesExport` z `@alphapump/core`.
 *
 * Sterownik wchodzi tu **portem**, a nie importem `expo-sqlite`. Nie chodzi o
 * elegancję: to jedyny sposób, żeby testy przejechały prawdziwym SQL-em po
 * prawdziwym pliku (`better-sqlite3` w Node), zamiast sprawdzać atrapę. Warstwa
 * dotykająca Expo jest w `expo.ts` i nie zawiera decyzji.
 *
 * ## Wszystko albo nic
 *
 * Zapis idzie w jednej transakcji. Plik należy do użytkownika i wróci do
 * FitNotesa taki, jaki go zostawimy — połowa treningu dopisana po błędzie
 * w środku byłaby gorsza niż nic, bo rejestr po naszej stronie nie odhaczyłby
 * jej i przy kolejnym podejściu ta połowa wjechałaby drugi raz.
 */

import {
  fitNotesNameKey,
  type FitNotesExportPlan,
  type FitNotesLogEntry,
  type FitNotesTarget,
} from '@alphapump/core';

export type FitNotesValue = string | number;

/**
 * Tyle dostępu do pliku, ile eksport naprawdę potrzebuje. `run` oddaje
 * identyfikator wstawionego wiersza — bez niego nie da się przypiąć serii do
 * dopiero co utworzonego ćwiczenia.
 */
export interface FitNotesDatabase {
  all: <T>(sql: string, params?: readonly FitNotesValue[]) => Promise<T[]>;
  run: (sql: string, params?: readonly FitNotesValue[]) => Promise<number>;
}

/** Plik nie jest kopią FitNotesa albo jest z wersji, której nie znamy. */
export class NotAFitNotesBackupError extends Error {
  constructor() {
    super("This file isn't a FitNotes backup — no training log inside.");
    this.name = 'NotAFitNotesBackupError';
  }
}

export interface FitNotesWriteReport {
  /** Wiersze dopisane do `training_log`. */
  sets: number;
  /** Wiersze dopisane do `exercise`. */
  exercises: number;
}

const REQUIRED_TABLES = ['category', 'exercise', 'training_log'];

/**
 * Sprawdzenie tabel jest pierwsze przy każdym odczycie, bo bez niego użytkownik,
 * który wskazał zły plik, zobaczyłby komunikat sterownika o nieistniejącej
 * tabeli — a wskazanie złego pliku jest tu pomyłką najbardziej prawdopodobną.
 */
async function assertFitNotesBackup(file: FitNotesDatabase): Promise<void> {
  const tables = await file.all<{ name: string }>(
    "select name from sqlite_master where type = 'table'",
  );
  const present = new Set(tables.map((table) => table.name.toLowerCase()));
  if (!REQUIRED_TABLES.every((table) => present.has(table))) throw new NotAFitNotesBackupError();
}

/** Czyta z pliku to, od czego zależy plan eksportu: kategorie i ćwiczenia. */
export async function readFitNotesTarget(file: FitNotesDatabase): Promise<FitNotesTarget> {
  await assertFitNotesBackup(file);

  const categories = await file.all<{ id: number; name: string }>(
    'select _id as id, name from Category order by sort_order, name',
  );
  const exercises = await file.all<{ id: number; name: string; categoryId: number }>(
    'select _id as id, name, category_id as categoryId from exercise order by name',
  );

  return { categories, exercises };
}

const SELECT_LOG =
  'select e.name as exerciseName, c.name as categoryName, l.date as date, ' +
  'l.metric_weight as metricWeight, l.reps as reps, l.distance as distance, ' +
  'l.duration_seconds as durationSeconds ' +
  'from training_log l ' +
  'join exercise e on e._id = l.exercise_id ' +
  'join Category c on c._id = e.category_id ' +
  'order by l.date, l._id';

/**
 * Czyta cały dziennik z pliku — wpisy razem z nazwą ćwiczenia i jego kategorią.
 *
 * Złączenie jest wewnętrzne celowo: wpis wskazujący na nieistniejące ćwiczenie
 * nie ma nazwy, a więc i tak nie miałby jak trafić do biblioteki. Kolejność jest
 * chronologiczna, żeby serie z jednego dnia wylądowały w AlphaPump w tej samej
 * kolejności, w której są w pliku.
 */
export async function readFitNotesLog(file: FitNotesDatabase): Promise<FitNotesLogEntry[]> {
  await assertFitNotesBackup(file);
  return file.all<FitNotesLogEntry>(SELECT_LOG);
}

const INSERT_EXERCISE = 'insert into exercise (name, category_id) values (?, ?)';

const INSERT_LOG =
  'insert into training_log ' +
  '(exercise_id, date, metric_weight, reps, unit, distance, duration_seconds) ' +
  'values (?, ?, ?, ?, ?, ?, ?)';

/**
 * Dopisuje plan do pliku i oddaje to, co poszło.
 *
 * `target` jest tym samym stanem, na którym plan powstał — po numery ćwiczeń
 * nie schodzimy do pliku drugi raz, bo między odczytem a zapisem nic go nie
 * dotyka (to plik na dysku telefonu, nie żywa baza FitNotesa).
 */
export async function applyFitNotesPlan(
  file: FitNotesDatabase,
  target: FitNotesTarget,
  plan: FitNotesExportPlan,
): Promise<FitNotesWriteReport> {
  const idsByName = new Map(
    target.exercises.map((exercise) => [fitNotesNameKey(exercise.name), exercise.id]),
  );

  await file.run('begin immediate');
  try {
    for (const exercise of plan.exercisesToCreate) {
      const id = await file.run(INSERT_EXERCISE, [exercise.name, exercise.categoryId]);
      idsByName.set(fitNotesNameKey(exercise.name), id);
    }

    for (const row of plan.rows) {
      const exerciseId = idsByName.get(fitNotesNameKey(row.exerciseName));
      if (exerciseId === undefined) {
        // Plan i plik rozjechałyby się tylko wtedy, gdyby powstały z różnych
        // odczytów. Wtedy lepiej wycofać całość niż dopisać serię „w powietrze".
        throw new Error(`No exercise in the backup file for "${row.exerciseName}"`);
      }

      await file.run(INSERT_LOG, [
        exerciseId,
        row.date,
        row.metricWeight,
        row.reps,
        row.unit,
        row.distance,
        row.durationSeconds,
      ]);
    }

    await file.run('commit');
  } catch (error) {
    await file.run('rollback');
    throw error;
  }

  return { sets: plan.rows.length, exercises: plan.exercisesToCreate.length };
}
