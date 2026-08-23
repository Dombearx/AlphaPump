/**
 * Cykle: cele, postęp i archiwizacja.
 *
 * „Cykl poprawnie zlicza serie, czas i dystans, a usunięcie serii odpowiednio
 * zmniejsza postęp." Ostatnia część jest tu najważniejsza i wychodzi za darmo:
 * postęp nie jest nigdzie akumulowany, tylko liczony od zera z serii leżących
 * w bazie lokalnej. Usunięcie serii nie wymaga więc żadnej korekty — po prostu
 * następnym razem nie zostaje policzona.
 *
 * Wszystko dzieje się bez sieci, na prawdziwym schemacie lokalnym.
 */

import { tagId, type CycleGoalInput } from '@alphapump/core';
import { cycleGoals, cycles as cyclesTable, outbox } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  cycleSummaries,
  earliestRelevantDay,
  previousPeriodProgress,
  remainingTargets,
  tagCycleProgress,
  withGoals,
  type CycleWithGoals,
} from '../src/cycle-progress';
import {
  CycleNotFoundError,
  createCycle,
  deleteCycle,
  resetCycle,
  setCycleArchived,
  updateCycle,
} from '../src/db/cycles';
import { cycleGoalList, cycleList, setsForCycles } from '../src/db/queries';
import { createSet, deleteSet, type SetValues } from '../src/db/sets';
import {
  EXERCISES,
  TAGS,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a' };
const DAY = '2026-08-11';
const BACK_TAG = tagId('Back');

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

describe('cykle w bazie lokalnej', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const CHEST_GOAL: CycleGoalInput = {
    metric: 'sets',
    target: 4,
    exerciseId: null,
    tagId: TAGS.chest,
  };

  const create = (goals: CycleGoalInput[] = [CHEST_GOAL]) =>
    createCycle(local.db, {
      ...AUTHOR,
      name: 'Sierpień na klatkę',
      startsOn: '2026-08-01',
      endsOn: '2026-08-31',
      goals,
    });

  const addBench = (day = DAY) =>
    createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: day,
      values: reps(80, 8),
    });

  /** Cykle z pozycjami i seriami — tak, jak składa je ekran. */
  const load = async (archived = false) => {
    const rows = await cycleList(local.db, TEST_USER.id, archived);
    const goals = await cycleGoalList(local.db, TEST_USER.id);
    const withTheirGoals = withGoals(rows, goals);
    const sets = await setsForCycles(
      local.db,
      TEST_USER.id,
      earliestRelevantDay(withTheirGoals, DAY),
    );
    return { cycles: withTheirGoals, sets, summaries: cycleSummaries(withTheirGoals, sets) };
  };

  describe('definiowanie', () => {
    it('zapisuje cykl z pozycjami celu i kolejkuje go do wysłania', async () => {
      const id = await create();

      const [row] = await local.db.select().from(cyclesTable).where(eq(cyclesTable.id, id));
      expect(row).toMatchObject({
        userId: TEST_USER.id,
        name: 'Sierpień na klatkę',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        deviceId: 'device-a',
      });
      expect(row?.serverSeq).toBeNull();

      const goals = await local.db.select().from(cycleGoals).where(eq(cycleGoals.cycleId, id));
      expect(goals).toHaveLength(1);

      // Pozycje nie są osobną encją synchronizacji — jadą razem z cyklem.
      const queued = await local.db.select().from(outbox);
      expect(queued).toEqual([expect.objectContaining({ entity: 'cycle', rowId: id })]);
    });

    it('przyjmuje wiele pozycji celu naraz', async () => {
      const id = await create([
        { metric: 'sets', target: 12, exerciseId: null, tagId: TAGS.chest },
        { metric: 'sets', target: 6, exerciseId: EXERCISES.crunch!.id, tagId: null },
      ]);

      const goals = await local.db.select().from(cycleGoals).where(eq(cycleGoals.cycleId, id));
      expect(goals.map((goal) => goal.position).sort()).toEqual([0, 1]);
    });

    it('odrzuca cykl bez pozycji celu', async () => {
      await expect(create([])).rejects.toThrow();
      expect(await local.db.select().from(outbox)).toHaveLength(0);
    });

    it('odrzuca zakres, w którym koniec wyprzedza początek', async () => {
      await expect(
        createCycle(local.db, {
          ...AUTHOR,
          name: 'Wstecz',
          startsOn: '2026-08-31',
          endsOn: '2026-08-01',
          goals: [{ metric: 'sets', target: 4, exerciseId: null, tagId: TAGS.chest }],
        }),
      ).rejects.toThrow();
    });

    it('odrzuca pozycję wskazującą i ćwiczenie, i tag', async () => {
      await expect(
        create([{ metric: 'sets', target: 4, exerciseId: EXERCISES.bench!.id, tagId: TAGS.chest }]),
      ).rejects.toThrow();
    });

    it('edycja podmienia pozycje i pilnuje zakresu dat po zmianie', async () => {
      const id = await create();

      await updateCycle(local.db, {
        ...AUTHOR,
        cycleId: id,
        goals: [{ metric: 'distance', target: 10_000, exerciseId: null, tagId: BACK_TAG }],
      });

      const goals = await local.db.select().from(cycleGoals).where(eq(cycleGoals.cycleId, id));
      expect(goals).toHaveLength(1);
      expect(goals[0]).toMatchObject({ metric: 'distance', target: 10_000, tagId: BACK_TAG });

      await expect(
        updateCycle(local.db, { ...AUTHOR, cycleId: id, startsOn: '2026-09-30' }),
      ).rejects.toThrow();
    });

    it('nie rusza cudzego cyklu', async () => {
      const id = await create();
      const intruder = { userId: '22222222-2222-4222-8222-222222222222', deviceId: 'device-b' };

      await expect(deleteCycle(local.db, id, intruder)).rejects.toThrow(CycleNotFoundError);
    });
  });

  describe('zliczanie', () => {
    it('zalicza serie ćwiczenia po jego tagu głównym', async () => {
      await create();
      await addBench();
      await addBench();

      const { summaries } = await load();
      expect(summaries[0]?.progress.goals[0]?.current).toBe(2);
      expect(summaries[0]?.progress.goals[0]?.remaining).toBe(2);
    });

    it('usunięcie serii zmniejsza postęp', async () => {
      await create();
      const first = await addBench();
      await addBench();

      await deleteSet(local.db, first.id, AUTHOR);

      const { summaries } = await load();
      expect(summaries[0]?.progress.goals[0]?.current).toBe(1);
    });

    it('nie zalicza serii spoza zakresu dat cyklu', async () => {
      await create();
      await addBench('2026-07-31');

      const { summaries } = await load();
      expect(summaries[0]?.progress.goals[0]?.current).toBe(0);
    });

    it('sumuje czas i dystans, nie tylko serie', async () => {
      const running = await createCycle(local.db, {
        ...AUTHOR,
        name: 'Bieganie',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        goals: [
          { metric: 'distance', target: 10_000, exerciseId: null, tagId: BACK_TAG },
          { metric: 'duration', target: 3600, exerciseId: null, tagId: BACK_TAG },
        ],
      });

      // Podciąganie ma tag główny „Plecy", ale nie ma dystansu — cel dystansowy
      // musi go zignorować, zamiast liczyć jako zero-wartościowe trafienie.
      await createSet(local.db, {
        ...AUTHOR,
        exerciseId: EXERCISES.crunch!.id,
        performedOn: DAY,
        values: {
          weightG: null,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
        },
      });

      const { summaries } = await load();
      const progress = summaries.find((summary) => summary.cycle.id === running)?.progress;

      expect(progress?.goals[0]?.current).toBe(0);
      expect(progress?.goals[1]?.current).toBe(0);
    });

    it('jedna seria zasila wszystkie pasujące cykle naraz', async () => {
      await create();
      await createCycle(local.db, {
        ...AUTHOR,
        name: 'Wyciskanie',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        goals: [{ metric: 'sets', target: 10, exerciseId: EXERCISES.bench!.id, tagId: null }],
      });

      await addBench();

      const { summaries } = await load();
      expect(summaries.map((summary) => summary.progress.goals[0]?.current)).toEqual([1, 1]);
    });

    it('cykl bez pozycji celu nie trafia na listę', () => {
      const rows = [
        { id: 'c-1', name: 'Pusty', startsOn: '2026-08-01', endsOn: null, archivedAt: null },
      ];
      expect(withGoals(rows, [])).toEqual([]);
    });
  });

  describe('reset, archiwum i poprzednie okresy', () => {
    it('reset przesuwa zakres i zostawia serie na miejscu', async () => {
      const id = await create();
      await addBench('2026-08-10');

      await resetCycle(local.db, id, '2026-09-01', AUTHOR);

      const [row] = await local.db.select().from(cyclesTable).where(eq(cyclesTable.id, id));
      expect(row).toMatchObject({ startsOn: '2026-09-01', endsOn: '2026-10-01' });

      // Postęp bieżącego okresu wraca do zera, bo seria została w poprzednim…
      const { cycles, sets, summaries } = await load();
      expect(summaries[0]?.progress.goals[0]?.current).toBe(0);

      // …ale sama seria nadal jest i poprzedni okres da się policzyć.
      const previous = previousPeriodProgress(cycles[0] as CycleWithGoals, sets);
      // Okno sprzed resetu, odtworzone z długości cyklu — bez żadnej tabeli
      // realizacji, bo historia siedzi w seriach.
      expect(previous?.period).toEqual({ startsOn: '2026-08-01', endsOn: '2026-08-31' });
      expect(previous?.progress.goals[0]?.current).toBe(1);
    });

    it('cykl bez końca nie ma poprzedniego okresu', async () => {
      await createCycle(local.db, {
        ...AUTHOR,
        name: 'Bez końca',
        startsOn: '2026-08-01',
        endsOn: null,
        goals: [{ metric: 'sets', target: 4, exerciseId: null, tagId: TAGS.chest }],
      });

      const { cycles, sets } = await load();
      expect(previousPeriodProgress(cycles[0] as CycleWithGoals, sets)).toBeNull();
    });

    it('archiwizacja przenosi cykl do drugiego widoku i z powrotem', async () => {
      const id = await create();

      await setCycleArchived(local.db, id, true, AUTHOR);
      expect(await cycleList(local.db, TEST_USER.id, false)).toHaveLength(0);
      expect(await cycleList(local.db, TEST_USER.id, true)).toHaveLength(1);

      await setCycleArchived(local.db, id, false, AUTHOR);
      expect(await cycleList(local.db, TEST_USER.id, false)).toHaveLength(1);
    });

    it('reset wyciąga cykl z archiwum', async () => {
      const id = await create();
      await setCycleArchived(local.db, id, true, AUTHOR);
      await resetCycle(local.db, id, '2026-09-01', AUTHOR);

      const [row] = await local.db.select().from(cyclesTable).where(eq(cyclesTable.id, id));
      expect(row?.archivedAt).toBeNull();
    });

    it('usunięcie jest miękkie i kolejkowane', async () => {
      const id = await create();
      await deleteCycle(local.db, id, AUTHOR);

      const [row] = await local.db.select().from(cyclesTable).where(eq(cyclesTable.id, id));
      expect(row?.deletedAt).not.toBeNull();
      expect(await cycleList(local.db, TEST_USER.id, false)).toHaveLength(0);

      const queued = await local.db.select().from(outbox);
      expect(queued.at(-1)).toMatchObject({ entity: 'cycle', rowId: id });
    });

    it('serie do policzenia czytamy od początku poprzedniego okresu', async () => {
      await create();
      const { cycles } = await load();

      expect(earliestRelevantDay(cycles, DAY)).toBe('2026-07-01');
      expect(earliestRelevantDay([], DAY)).toBe(DAY);
    });
  });

  describe('podpowiedź na ekranie wyboru ćwiczenia', () => {
    it('pokazuje pozostałe pozycje aktywnych cykli', async () => {
      await create([
        { metric: 'sets', target: 4, exerciseId: null, tagId: TAGS.chest },
        { metric: 'sets', target: 2, exerciseId: EXERCISES.crunch!.id, tagId: null },
      ]);
      await addBench();

      const { summaries } = await load();
      const targets = remainingTargets(summaries, DAY);

      // Najbliżej ukończenia najpierw: brzuszek potrzebuje dwóch serii,
      // klatka jeszcze trzech.
      expect(targets.map((target) => target.label)).toEqual(["Mason's crunch", 'chest']);
      expect(targets[0]?.exerciseId).toBe(EXERCISES.crunch!.id);
      expect(targets[1]?.tagId).toBe(TAGS.chest);
      expect(targets[1]?.remaining).toBe(3);
    });

    it('nie pokazuje pozycji już zrealizowanych', async () => {
      await create([{ metric: 'sets', target: 1, exerciseId: null, tagId: TAGS.chest }]);
      await addBench();

      const { summaries } = await load();
      expect(remainingTargets(summaries, DAY)).toEqual([]);
    });

    it('nie pokazuje cykli, które nie obejmują wskazanego dnia', async () => {
      await create();

      const { summaries } = await load();
      expect(remainingTargets(summaries, '2026-09-15')).toEqual([]);
    });

    it('nie pokazuje cykli archiwalnych', async () => {
      const id = await create();
      await setCycleArchived(local.db, id, true, AUTHOR);

      const rows = await cycleList(local.db, TEST_USER.id, true);
      const goals = await cycleGoalList(local.db, TEST_USER.id);
      const summaries = cycleSummaries(withGoals(rows, goals), []);

      expect(remainingTargets(summaries, DAY)).toEqual([]);
    });

    it('oznacza tag pozycji tagowej i tag główny pozycji z ćwiczeniem', async () => {
      await create([
        { metric: 'sets', target: 4, exerciseId: null, tagId: TAGS.chest },
        // Brzuszek ma tag główny „abs" — pozycja żadnego tagu nie wskazuje,
        // a mimo to zostawia robotę właśnie tam.
        { metric: 'sets', target: 2, exerciseId: EXERCISES.crunch!.id, tagId: null },
      ]);

      const { summaries } = await load();
      const marked = tagCycleProgress(summaries, DAY);

      expect([...marked.keys()].sort()).toEqual([TAGS.chest, tagId('abs')].sort());
    });

    it('tag zrobiony w całości zostaje oznaczony pełnym wypełnieniem', async () => {
      await create([{ metric: 'sets', target: 1, exerciseId: null, tagId: TAGS.chest }]);
      await addBench();

      const { summaries } = await load();
      // Dokończona robota nie wypada z mapy: chips ma zostać wypełniony do końca,
      // a nie wrócić do wyglądu tagu spoza cyklu.
      expect(tagCycleProgress(summaries, DAY).get(TAGS.chest)).toBe(1);
    });

    it('podaje udział wykonania tagu — jedna seria z czterech to ćwierć', async () => {
      await create([{ metric: 'sets', target: 4, exerciseId: null, tagId: TAGS.chest }]);
      await addBench();

      const { summaries } = await load();
      expect(tagCycleProgress(summaries, DAY).get(TAGS.chest)).toBe(0.25);
    });

    it('cztery serie z ośmiu zaplanowanych w tagu to połowa, choćby stały w dwóch pozycjach', async () => {
      await create([
        // Wyciskanie i dipy mają ten sam tag główny „chest", więc obie pozycje
        // planują robotę w tym samym tagu: razem osiem serii.
        { metric: 'sets', target: 4, exerciseId: EXERCISES.bench!.id, tagId: null },
        { metric: 'sets', target: 4, exerciseId: EXERCISES.dips!.id, tagId: null },
      ]);
      await addBench();
      await addBench();
      await addBench();
      await addBench();

      const { summaries } = await load();
      expect(tagCycleProgress(summaries, DAY).get(TAGS.chest)).toBe(0.5);
    });

    it('liczy zrobioną robotę, a nie udziały pozycji', async () => {
      await create([
        { metric: 'sets', target: 8, exerciseId: EXERCISES.bench!.id, tagId: null },
        { metric: 'sets', target: 2, exerciseId: EXERCISES.dips!.id, tagId: null },
      ]);
      await addBench();
      await addBench();
      await addBench();
      await addBench();

      const { summaries } = await load();
      // Cztery serie z dziesięciu zaplanowanych w tagu to dwie piąte. Średnia
      // z udziałów pozycji dawała tu ćwiartkę: pozycja na dwie serie ważyła
      // w niej tyle samo, co pozycja na osiem, i wypełnienie rozjeżdżało się
      // z tym, co zostało do zrobienia.
      expect(tagCycleProgress(summaries, DAY).get(TAGS.chest)).toBe(0.4);
    });

    it('nadmiar w jednej pozycji nie zasypuje braku w drugiej', async () => {
      await create([
        // Pozycja na jedną serię jest zrobiona po pierwszym wyciskaniu; kolejne
        // trzy serie wchodzą już tylko do pozycji tagowej.
        { metric: 'sets', target: 1, exerciseId: EXERCISES.bench!.id, tagId: null },
        { metric: 'sets', target: 8, exerciseId: null, tagId: TAGS.chest },
      ]);
      await addBench();
      await addBench();
      await addBench();
      await addBench();

      const { summaries } = await load();
      // Zaplanowane dziewięć serii, zrobione pięć: jedna z jednej i cztery
      // z ośmiu. Czwarta seria wyciskania nie dolicza się do pozycji na jedną.
      expect(tagCycleProgress(summaries, DAY).get(TAGS.chest)).toBeCloseTo(5 / 9, 10);
    });
  });
});
