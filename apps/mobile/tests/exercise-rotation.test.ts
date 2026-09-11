/**
 * Podpowiadanie ćwiczeń na prawdziwej bazie.
 *
 * Sam algorytm ma swoje testy w rdzeniu (`packages/core/tests/rotation.test.ts`)
 * i to tam sprawdzana jest jego arytmetyka. Tutaj sprawdzane jest wyłącznie
 * tłumaczenie, którego test czystej funkcji nie widzi: że ćwiczenie
 * z dzisiejszych serii ma **te same** tagi, co to samo ćwiczenie na liście
 * biblioteki, że kolejność historii dnia idzie po czasie zapisu, a nie po
 * pozycji w obrębie ćwiczenia, i że tag cardio rozpoznaje się po slugu.
 */

import { tagId } from '@alphapump/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cycleNeeds, cycleSummaries, earliestRelevantDay, withGoals } from '../src/cycle-progress';
import { createCycle } from '../src/db/cycles';
import {
  allAdditionalTags,
  cycleGoalList,
  cycleList,
  daySets,
  exerciseLibrary,
  groupAdditionalTags,
  setsForCycles,
  tagLibrary,
} from '../src/db/queries';
import { createSet } from '../src/db/sets';
import { excludedTagIds, orderLibrary, performedToday } from '../src/exercise-rotation';
import {
  EXERCISES,
  TAGS,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';
const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a' };

describe('podpowiadanie ćwiczeń', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  /** Seria wskazanego ćwiczenia z podanym czasem zapisu. */
  const addSet = (exerciseId: string, at: string) =>
    createSet(
      local.db,
      {
        ...AUTHOR,
        exerciseId,
        performedOn: DAY,
        values: {
          weightG: 20_000,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
        },
      },
      new Date(at),
    );

  /** Cykl z dwunastoma seriami na biceps i dwunastoma na triceps. */
  const addCycle = () =>
    createCycle(local.db, {
      ...AUTHOR,
      name: 'Sierpień',
      startsOn: '2026-08-01',
      endsOn: null,
      goals: [
        { metric: 'sets', target: 12, exerciseId: null, tagId: TAGS.biceps },
        { metric: 'sets', target: 12, exerciseId: null, tagId: TAGS.triceps },
      ],
    });

  /** Biblioteka ułożona tak, jak zobaczy ją ekran wyboru ćwiczenia. */
  async function order(): Promise<string[]> {
    const cycles = withGoals(
      await cycleList(local.db, TEST_USER.id, false),
      await cycleGoalList(local.db, TEST_USER.id),
      DAY,
    );
    const from = earliestRelevantDay(cycles, DAY);
    const summaries = cycleSummaries(cycles, await setsForCycles(local.db, TEST_USER.id, from));

    const rows = await exerciseLibrary(local.db, TEST_USER.id);
    const ordered = orderLibrary(rows, {
      sets: await daySets(local.db, TEST_USER.id, DAY),
      additional: groupAdditionalTags(await allAdditionalTags(local.db)),
      needs: cycleNeeds(summaries, DAY),
      tags: await tagLibrary(local.db),
    });

    return ordered.map((row) => row.id);
  }

  it('bez cyklu i bez serii zostaje kolejność biblioteki', async () => {
    const rows = await exerciseLibrary(local.db, TEST_USER.id);

    expect(await order()).toEqual(rows.map((row) => row.id));
  });

  it('na górę wchodzi ćwiczenie z niedokończonej pozycji cyklu', async () => {
    await addCycle();

    expect([EXERCISES.curl!.id, EXERCISES.frenchPress!.id]).toContain((await order())[0]);
  });

  it('po serii na biceps podpowiada triceps, a po niej wraca biceps', async () => {
    await addCycle();

    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');
    expect((await order())[0]).toBe(EXERCISES.frenchPress!.id);

    await addSet(EXERCISES.frenchPress!.id, '2026-08-11T10:05:00Z');
    expect((await order())[0]).toBe(EXERCISES.curl!.id);

    await addSet(EXERCISES.curl!.id, '2026-08-11T10:10:00Z');
    expect((await order())[0]).toBe(EXERCISES.frenchPress!.id);
  });

  it('ćwiczenie właśnie wykonane spada pod ćwiczenia wypoczęte', async () => {
    await addCycle();
    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');

    const ordered = await order();
    expect(ordered.indexOf(EXERCISES.curl!.id)).toBeGreaterThan(
      ordered.indexOf(EXERCISES.frenchPress!.id),
    );
  });

  it('historia dnia idzie po czasie zapisu, a nie po pozycji w ćwiczeniu', async () => {
    // Pozycja liczy się w obrębie pary dzień + ćwiczenie, więc obie te serie
    // mają ją równą zeru — kolejność może wziąć się wyłącznie z czasu zapisu.
    await addSet(EXERCISES.frenchPress!.id, '2026-08-11T10:05:00Z');
    await addSet(EXERCISES.curl!.id, '2026-08-11T10:00:00Z');

    const performed = performedToday(
      await daySets(local.db, TEST_USER.id, DAY),
      groupAdditionalTags(await allAdditionalTags(local.db)),
    );

    expect(performed.map((exercise) => exercise.id)).toEqual([
      EXERCISES.curl!.id,
      EXERCISES.frenchPress!.id,
    ]);
  });

  it('ćwiczenie z historii dnia niesie swój tag główny i tagi dodatkowe', async () => {
    // Dipy: tag główny „chest", dodatkowe „triceps" i „shoulders". Bez tagów
    // dodatkowych nie dałoby się rozpoznać, że męczą triceps.
    await addSet(EXERCISES.dips!.id, '2026-08-11T10:00:00Z');

    const [performed] = performedToday(
      await daySets(local.db, TEST_USER.id, DAY),
      groupAdditionalTags(await allAdditionalTags(local.db)),
    );

    expect(performed?.primaryTagId).toBe(TAGS.chest);
    expect(performed?.additionalTagIds).toContain(TAGS.triceps);
  });

  it('seria angażująca triceps pomocniczo odsuwa ćwiczenie na triceps', async () => {
    await addCycle();
    await addSet(EXERCISES.dips!.id, '2026-08-11T10:00:00Z');

    const ordered = await order();
    expect(ordered.indexOf(EXERCISES.curl!.id)).toBeLessThan(
      ordered.indexOf(EXERCISES.frenchPress!.id),
    );
  });

  it('tag cardio rozpoznaje się po slugu, a nie po nazwie na ekranie', async () => {
    // Biblioteka wbudowana nie ma tagu cardio — bez niego nic się nie wyłącza.
    expect(excludedTagIds(await tagLibrary(local.db)).size).toBe(0);

    expect(
      excludedTagIds([
        { id: tagId('cardio'), name: 'Cardio', slug: 'cardio' },
        { id: TAGS.biceps, name: 'biceps', slug: 'biceps' },
      ] as Awaited<ReturnType<typeof tagLibrary>>),
    ).toEqual(new Set([tagId('cardio')]));
  });
});
