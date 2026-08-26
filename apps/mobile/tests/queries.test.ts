/**
 * Zapytania ekranów wykonane na prawdziwej bazie.
 *
 * Zapytanie zbudowane z fragmentów SQL przechodzi typowanie i wywraca się
 * dopiero przy wykonaniu — a na urządzeniu znaczy to biały ekran zamiast listy
 * ćwiczeń. Dlatego każde z nich jest tu raz uruchamiane.
 */

import { tagId } from '@alphapump/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet } from '../src/db/sets';
import {
  additionalTagsOf,
  allAdditionalTags,
  daySetCounts,
  exerciseDetails,
  exerciseHistory,
  exerciseLibrary,
  exerciseTagList,
  groupAdditionalTags,
  groupHistoryByDay,
  localUser,
} from '../src/db/queries';
import { filterExercises } from '../src/exercise-search';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';
const EARLIER = '2026-08-09';
const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a' };

describe('zapytania ekranów', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const addBenchOn = (day: string) =>
    createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: day,
      values: {
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  const addBench = () => addBenchOn(DAY);

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
      name: 'Flat barbell bench press',
      loggingType: 'weight_reps',
      authorNickname: 'AlphaPump',
    });
  });

  it('historia ćwiczenia pomija serie usunięte i cudze', async () => {
    await addBench();

    expect(await exerciseHistory(local.db, TEST_USER.id, EXERCISES.bench!.id)).toHaveLength(1);
    expect(await exerciseHistory(local.db, 'ktos-inny', EXERCISES.bench!.id)).toHaveLength(0);
  });

  it('historia ćwiczenia grupuje się po dniach, od ostatniego treningu', async () => {
    // Zapytanie oddaje serie rosnąco, bo tak liczą się rekordy — ekran historii
    // czyta je odwrotnie, od tego, co było ostatnio.
    await addBench();
    await addBench();
    await addBenchOn(EARLIER);

    const days = groupHistoryByDay(
      await exerciseHistory(local.db, TEST_USER.id, EXERCISES.bench!.id),
    );

    expect(days.map((entry) => entry.day)).toEqual([DAY, EARLIER]);
    expect(days.map((entry) => entry.sets.length)).toEqual([2, 1]);
  });

  it('kalendarz dostaje liczbę serii dla dnia, w którym coś było', async () => {
    await addBench();
    await addBench();

    const rows = await daySetCounts(local.db, TEST_USER.id, '2026-08-01', '2026-08-31');

    expect(rows).toEqual([{ performedOn: DAY, sets: 2 }]);
  });

  it('licznik kalendarza nie wychodzi poza zakres ani poza konto', async () => {
    await addBench();

    expect(await daySetCounts(local.db, TEST_USER.id, '2026-09-01', '2026-09-30')).toEqual([]);
    expect(await daySetCounts(local.db, 'ktos-inny', '2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('konto właściciela urządzenia czyta się z bazy lokalnej', async () => {
    const [row] = await localUser(local.db, TEST_USER.id);
    expect(row?.nickname).toBe(TEST_USER.nickname);
  });

  it('biblioteka po tagu dodatkowym też znajduje ćwiczenie, ale z tagiem głównym w wierszu', async () => {
    // „Weighted dip" ma tag główny chest i dodatkowe triceps oraz shoulders —
    // filtr po triceps musi je znaleźć, ale wiersz i tak niesie chest, bo to
    // on liczy się do cyklu.
    const rows = await exerciseLibrary(local.db, TEST_USER.id, { tagId: tagId('triceps') });

    const dips = rows.find((row) => row.id === EXERCISES.dips!.id);
    expect(dips).toBeDefined();
    expect(dips?.tagName).toBe('chest');
  });

  it('biblioteka po tagu stawia ćwiczenia z tym tagiem jako główny przed tymi, gdzie jest dodatkowy', async () => {
    // „Lying triceps extension" i „Overhead cable triceps extension" mają
    // triceps jako tag główny, a alfabetycznie idą po ćwiczeniach z chestem
    // jako głównym i triceps jako dodatkowym (np. „Flat barbell bench press") —
    // bez priorytetu tagu głównego wynik by je pomieszał.
    const rows = await exerciseLibrary(local.db, TEST_USER.id, { tagId: tagId('triceps') });

    const isPrimaryMatch = rows.map((row) => row.tagName === 'triceps');
    const firstAdditionalIndex = isPrimaryMatch.indexOf(false);

    expect(firstAdditionalIndex).toBeGreaterThan(0);
    expect(isPrimaryMatch.slice(0, firstAdditionalIndex).every(Boolean)).toBe(true);
    expect(isPrimaryMatch.slice(firstAdditionalIndex).some(Boolean)).toBe(false);
  });

  it('grupuje tagi dodatkowe po ćwiczeniu, w kolejności zapisu', async () => {
    const rows = await allAdditionalTags(local.db);
    const grouped = groupAdditionalTags(rows);

    expect(grouped.get(EXERCISES.dips!.id)?.map((tag) => tag.name)).toEqual([
      'triceps',
      'shoulders',
    ]);
    // Ćwiczenie bez tagów dodatkowych po prostu nie ma wpisu w mapie.
    expect(grouped.get(EXERCISES.crunch!.id)).toBeUndefined();
  });

  it('ekran zapisu serii dostaje tag główny na przedzie, a dodatkowe w kolejności zapisu', async () => {
    const [details] = await exerciseDetails(local.db, EXERCISES.dips!.id);
    const extra = await additionalTagsOf(local.db, EXERCISES.dips!.id);

    const list = exerciseTagList(
      {
        id: details!.tagId,
        name: details!.tagName,
        translations: details!.tagTranslations,
        color: details!.tagColor,
      },
      extra,
    );

    expect(list.map((tag) => tag.name)).toEqual(['chest', 'triceps', 'shoulders']);
    expect(list.map((tag) => tag.primary)).toEqual([true, false, false]);
  });

  it('ćwiczenie bez tagów dodatkowych ma na liście sam tag główny', async () => {
    const [details] = await exerciseDetails(local.db, EXERCISES.crunch!.id);
    const extra = await additionalTagsOf(local.db, EXERCISES.crunch!.id);

    expect(
      exerciseTagList(
        {
          id: details!.tagId,
          name: details!.tagName,
          translations: details!.tagTranslations,
          color: details!.tagColor,
        },
        extra,
      ),
    ).toHaveLength(1);
  });

  it('tag główny powtórzony wśród dodatkowych nie pokazuje się dwa razy', () => {
    const chest = { id: tagId('chest'), name: 'chest', translations: null, color: '#ef4444' };

    expect(exerciseTagList(chest, [chest])).toEqual([{ ...chest, primary: true }]);
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
