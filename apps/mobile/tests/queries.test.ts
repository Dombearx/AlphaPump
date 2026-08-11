/**
 * Zapytania ekranów wykonane na prawdziwej bazie.
 *
 * Zapytanie zbudowane z fragmentów SQL przechodzi typowanie i wywraca się
 * dopiero przy wykonaniu — a na urządzeniu znaczy to biały ekran zamiast listy
 * ćwiczeń. Dlatego każde z nich jest tu raz uruchamiane.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../src/db/sets';
import { exerciseDetails, exerciseHistory, exerciseLibrary, localUser } from '../src/db/queries';
import { filterExercises } from '../src/exercise-search';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';
const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a' };

describe('zapytania ekranów', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const addBench = () =>
    createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: DAY,
      values: {
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  it('biblioteka zwraca ćwiczenia z tagiem głównym', async () => {
    const rows = await exerciseLibrary(local.db, TEST_USER.id);

    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]).toMatchObject({ tagName: expect.any(String), tagColor: expect.any(String) });
  });

  it('biblioteka stawia na górze ćwiczenia, które użytkownik faktycznie robi', async () => {
    await addBench();
    const rows = await exerciseLibrary(local.db, TEST_USER.id);

    expect(rows[0]?.id).toBe(EXERCISES.bench!.id);
    expect(rows[0]?.setCount).toBe(1);
    expect(rows[0]?.lastPerformedOn).toBe(DAY);
  });

  it('licznik serii jest liczony per użytkownik', async () => {
    await addBench();
    const rows = await exerciseLibrary(local.db, 'ktos-inny');

    expect(rows.find((row) => row.id === EXERCISES.bench!.id)?.setCount).toBe(0);
  });

  it('szczegóły ćwiczenia niosą tag i autora', async () => {
    const [details] = await exerciseDetails(local.db, EXERCISES.bench!.id);

    expect(details).toMatchObject({
      name: 'Wyciskanie sztangi leżąc',
      loggingType: 'weight_reps',
      authorNickname: 'AlphaPump',
    });
  });

  it('historia ćwiczenia pomija serie usunięte i cudze', async () => {
    await addBench();

    expect(await exerciseHistory(local.db, TEST_USER.id, EXERCISES.bench!.id)).toHaveLength(1);
    expect(await exerciseHistory(local.db, 'ktos-inny', EXERCISES.bench!.id)).toHaveLength(0);
  });

  it('konto właściciela urządzenia czyta się z bazy lokalnej', async () => {
    const [row] = await localUser(local.db, TEST_USER.id);
    expect(row?.nickname).toBe(TEST_USER.nickname);
  });
});

describe('szukanie ćwiczenia', () => {
  const library = [
    { name: 'Wyciskanie sztangi leżąc', tagName: 'Klatka piersiowa' },
    { name: 'Podciąganie nachwytem', tagName: 'Plecy' },
    { name: 'Martwy ciąg', tagName: 'Plecy' },
  ];

  it('pusta fraza pokazuje wszystko', () => {
    expect(filterExercises(library, '   ')).toHaveLength(3);
  });

  it('nie wymaga trafiania w ogonki', () => {
    // Slug jest ten sam, którym liczony jest identyfikator ćwiczenia.
    expect(filterExercises(library, 'lezac')).toHaveLength(1);
    expect(filterExercises(library, 'MARTWY')).toHaveLength(1);
  });

  it('szuka także po tagu', () => {
    expect(filterExercises(library, 'plecy')).toHaveLength(2);
  });

  it('brak dopasowania oddaje pustą listę', () => {
    expect(filterExercises(library, 'kajakarstwo')).toHaveLength(0);
  });
});
