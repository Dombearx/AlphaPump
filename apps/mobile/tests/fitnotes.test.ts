/**
 * Eksport dziennika do pliku kopii FitNotesa — od strony telefonu.
 *
 * Testy jadą po **prawdziwych** plikach SQLite z obu stron: baza lokalna
 * powstaje z bundle'a migracji aplikacji, a plik docelowy ze schematu FitNotesa
 * odczytanego z realnego backupu. Atrapa którejkolwiek ze stron sprawdzałaby
 * atrapę, a różnice wyszłyby dopiero w pliku, który użytkownik przywrócił sobie
 * w FitNotesie — czyli w miejscu, w którym już nic nie poprawimy.
 *
 * Sprawdzane są cztery rzeczy, z których każda odpowiada realnej awarii:
 *
 * 1. **Serie lądują w `training_log` z właściwym ćwiczeniem i wartościami.**
 * 2. **Drugi eksport nie dubluje niczego.** To jest cel funkcji: synchronizacja,
 *    a nie jednorazowe zrzucenie danych.
 * 3. **Kategorie nigdy nie powstają.** Darmowy FitNotes ich nie utworzy, więc
 *    dopisanie wiersza do `Category` dałoby plik, którego nie da się przywrócić.
 * 4. **Błąd w środku nie zostawia połowy treningu.** Rejestr odhacza wpisy po
 *    zapisie, więc połowa dopisana i nieodhaczona wjechałaby potem drugi raz.
 */

import { fitNotesExportKey, planFitNotesExport, tagId } from '@alphapump/core';
import BetterSqlite3 from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExercise } from '../src/db/library';
import { createSet, type SetValues } from '../src/db/sets';
import {
  applyFitNotesPlan,
  readFitNotesTarget,
  NotAFitNotesBackupError,
  type FitNotesDatabase,
} from '../src/fitnotes/file';
import { fitNotesSourceSets } from '../src/fitnotes/source';
import {
  EMPTY_FITNOTES_STATE,
  FitNotesStateError,
  parseFitNotesState,
  serializeFitNotesState,
  withCategoryChoices,
  withExportedKeys,
} from '../src/fitnotes/state';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a', role: 'user' } as const;

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

/**
 * Schemat pliku `.fitnotes` — przepisany z realnego backupu. Zawężony do tabel,
 * których dotyka eksport: pomiary ciała i szablony treningów są poza zakresem.
 */
const FITNOTES_SCHEMA = `
CREATE TABLE Category(
  _id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  colour INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE exercise(
  _id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category_id INTEGER NOT NULL,
  exercise_type_id INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  weight_increment INTEGER,
  default_graph_id INTEGER,
  default_rest_time INTEGER,
  weight_unit_id INTEGER NOT NULL DEFAULT 0,
  is_favourite INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE training_log (
  _id INTEGER PRIMARY KEY AUTOINCREMENT,
  exercise_id INTEGER NOT NULL,
  date DATE NOT NULL,
  metric_weight INTEGER NOT NULL,
  reps INTEGER NOT NULL,
  unit INTEGER NOT NULL DEFAULT 0,
  routine_section_exercise_set_id INTEGER NOT NULL DEFAULT 0,
  timer_auto_start INTEGER NOT NULL DEFAULT 0,
  is_personal_record INTEGER NOT NULL DEFAULT 0,
  is_personal_record_first INTEGER NOT NULL DEFAULT 0,
  is_complete INTEGER NOT NULL DEFAULT 0,
  is_pending_update INTEGER NOT NULL DEFAULT 0,
  distance INTEGER NOT NULL DEFAULT 0,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);
`;

interface Backup {
  client: BetterSqlite3.Database;
  file: FitNotesDatabase;
}

/** Plik kopii z kategoriami i jednym ćwiczeniem, jak po instalacji FitNotesa. */
function createBackup(schema = FITNOTES_SCHEMA): Backup {
  const client = new BetterSqlite3(':memory:');
  client.exec(schema);

  if (schema === FITNOTES_SCHEMA) {
    for (const [index, name] of ['Chest', 'Back', 'Legs'].entries()) {
      client.prepare('insert into Category (name, sort_order) values (?, ?)').run(name, index);
    }
    client
      .prepare('insert into exercise (name, category_id) values (?, ?)')
      .run('Flat Barbell Bench Press', 1);
  }

  return {
    client,
    file: {
      all: <T>(sql: string, params: readonly (string | number)[] = []) =>
        Promise.resolve(client.prepare(sql).all(...params) as T[]),
      run: (sql: string, params: readonly (string | number)[] = []) =>
        Promise.resolve(Number(client.prepare(sql).run(...params).lastInsertRowid)),
    },
  };
}

const logRows = (backup: Backup) =>
  backup.client
    .prepare(
      'select e.name as exercise, l.date, l.metric_weight as weight, l.reps, l.unit, ' +
        'l.distance, l.duration_seconds as duration ' +
        'from training_log l join exercise e on e._id = l.exercise_id order by l._id',
    )
    .all() as Record<string, unknown>[];

describe('eksport do pliku FitNotes', () => {
  let local: LocalDatabase;
  let backup: Backup;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
    backup = createBackup();
  });

  afterEach(() => {
    local.close();
    backup.client.close();
  });

  /** Dwie serie: jedna na ćwiczeniu, które w pliku jest, druga na własnym. */
  async function seedSets(): Promise<void> {
    await createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: '2026-08-10',
      values: reps(82.5, 5),
    });

    const own = await createExercise(local.db, {
      ...AUTHOR,
      name: 'Zwis na jednej ręce',
      loggingType: 'weight_reps',
      primaryTagId: tagId('back'),
      additionalTagIds: [],
      note: null,
      gym: null,
    });
    await createSet(local.db, {
      ...AUTHOR,
      exerciseId: own.id,
      performedOn: '2026-08-11',
      values: reps(20, 8),
    });
  }

  it('dopisuje serie i zakłada brakujące ćwiczenie w kategorii tagu głównego', async () => {
    await seedSets();

    const target = await readFitNotesTarget(backup.file);
    const plan = planFitNotesExport({
      sets: await fitNotesSourceSets(local.db, TEST_USER.id),
      target,
    });
    const report = await applyFitNotesPlan(backup.file, target, plan);

    expect(report).toEqual({ sets: 2, exercises: 1 });
    expect(logRows(backup)).toEqual([
      {
        exercise: 'Flat Barbell Bench Press',
        date: '2026-08-10',
        weight: 82.5,
        reps: 5,
        unit: 0,
        distance: 0,
        duration: 0,
      },
      {
        exercise: 'Zwis na jednej ręce',
        date: '2026-08-11',
        weight: 20,
        reps: 8,
        unit: 0,
        distance: 0,
        duration: 0,
      },
    ]);

    const created = backup.client
      .prepare('select category_id as categoryId from exercise where name = ?')
      .get('Zwis na jednej ręce') as { categoryId: number };
    expect(created.categoryId).toBe(2); // „Back" — tag główny ćwiczenia
  });

  it('drugi eksport nie dopisuje niczego, gdy nic nowego nie doszło', async () => {
    await seedSets();

    const sets = await fitNotesSourceSets(local.db, TEST_USER.id);
    const target = await readFitNotesTarget(backup.file);
    const first = planFitNotesExport({ sets, target });
    await applyFitNotesPlan(backup.file, target, first);

    const registry = withExportedKeys(EMPTY_FITNOTES_STATE, first.keys);
    const second = planFitNotesExport({
      sets: await fitNotesSourceSets(local.db, TEST_USER.id),
      target: await readFitNotesTarget(backup.file),
      exportedKeys: registry.exported,
    });
    await applyFitNotesPlan(backup.file, await readFitNotesTarget(backup.file), second);

    expect(second.rows).toEqual([]);
    expect(second.alreadyExported).toBe(2);
    expect(logRows(backup)).toHaveLength(2);
    expect(backup.client.prepare('select count(*) as n from exercise').get()).toEqual({ n: 2 });
  });

  it('dopisuje wyłącznie serie z ostatniego treningu', async () => {
    await seedSets();

    const target = await readFitNotesTarget(backup.file);
    const first = planFitNotesExport({
      sets: await fitNotesSourceSets(local.db, TEST_USER.id),
      target,
    });
    await applyFitNotesPlan(backup.file, target, first);

    await createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: '2026-08-12',
      values: reps(85, 3),
    });

    const later = await readFitNotesTarget(backup.file);
    const second = planFitNotesExport({
      sets: await fitNotesSourceSets(local.db, TEST_USER.id),
      target: later,
      exportedKeys: first.keys,
    });
    await applyFitNotesPlan(backup.file, later, second);

    expect(second.rows).toHaveLength(1);
    expect(logRows(backup)).toHaveLength(3);
    expect(logRows(backup)[2]).toMatchObject({ date: '2026-08-12', weight: 85, reps: 3 });
  });

  it('nie tworzy kategorii — czeka na wskazanie zastępczej', async () => {
    // Tag „abs" nie ma odpowiednika wśród kategorii pliku (Chest, Back, Legs).
    await createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.crunch!.id,
      performedOn: '2026-08-10',
      values: {
        weightG: null,
        reps: 15,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

    const sets = await fitNotesSourceSets(local.db, TEST_USER.id);
    const target = await readFitNotesTarget(backup.file);

    const blocked = planFitNotesExport({ sets, target });
    expect(blocked.missingCategories).toEqual(['abs']);
    await applyFitNotesPlan(backup.file, target, blocked);
    expect(backup.client.prepare('select count(*) as n from Category').get()).toEqual({ n: 3 });
    expect(logRows(backup)).toEqual([]);

    const chosen = withCategoryChoices(EMPTY_FITNOTES_STATE, { abs: 'Legs' });
    const allowed = planFitNotesExport({ sets, target, categoryMapping: chosen.categories });
    await applyFitNotesPlan(backup.file, target, allowed);

    expect(backup.client.prepare('select count(*) as n from Category').get()).toEqual({ n: 3 });
    expect(logRows(backup)[0]).toMatchObject({ exercise: "Mason's crunch", reps: 15, weight: 0 });
    expect(
      backup.client
        .prepare('select category_id as id from exercise where name = ?')
        .get("Mason's crunch"),
    ).toEqual({ id: 3 });
  });

  it('błąd w środku wycofuje cały zapis', async () => {
    await seedSets();

    const target = await readFitNotesTarget(backup.file);
    const plan = planFitNotesExport({
      sets: await fitNotesSourceSets(local.db, TEST_USER.id),
      target,
    });
    // Wiersz bez pokrycia w pliku: plan i plik z dwóch różnych odczytów.
    plan.rows.push({ ...plan.rows[0]!, exerciseName: 'Nie ma takiego ćwiczenia' });

    await expect(applyFitNotesPlan(backup.file, target, plan)).rejects.toThrow();
    expect(logRows(backup)).toEqual([]);
    expect(backup.client.prepare('select count(*) as n from exercise').get()).toEqual({ n: 1 });
  });

  it('odmawia pliku, który nie jest kopią FitNotesa', async () => {
    const other = createBackup('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    await expect(readFitNotesTarget(other.file)).rejects.toThrow(NotAFitNotesBackupError);
    other.client.close();
  });
});

describe('rejestr eksportu', () => {
  it('zapamiętuje klucze i wybory kategorii bez powtórzeń', () => {
    const state = withExportedKeys(
      withCategoryChoices(EMPTY_FITNOTES_STATE, { forearms: 'Back' }),
      ['a', 'b'],
    );

    expect(parseFitNotesState(serializeFitNotesState(withExportedKeys(state, ['b', 'c'])))).toEqual(
      {
        categories: { forearms: 'Back' },
        exported: ['a', 'b', 'c'],
      },
    );
  });

  it('odmawia zamiast udać, że nic jeszcze nie wyeksportowano', () => {
    // Pusty rejestr znaczy „dopisz wszystko" — po uszkodzeniu pliku byłby to
    // drugi komplet historii w cudzej kopii, widoczny dopiero po przywróceniu.
    expect(() => parseFitNotesState('{ nie json')).toThrow(FitNotesStateError);
    expect(() => parseFitNotesState('{"exported":"a"}')).toThrow(FitNotesStateError);
  });

  it('klucz duplikatu przeżywa zmianę pisowni nazwy ćwiczenia', () => {
    const set = {
      exerciseName: 'Flat barbell bench press',
      categoryName: 'chest',
      performedOn: '2026-08-10',
      weightG: 82500,
      reps: 5,
      durationS: null,
      distanceM: null,
      createdAt: '2026-08-10T17:04:11.000Z',
    };

    expect(fitNotesExportKey({ ...set, exerciseName: 'FLAT BARBELL BENCH PRESS' })).toBe(
      fitNotesExportKey(set),
    );
  });
});
