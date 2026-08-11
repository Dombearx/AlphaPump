import { describe, expect, it } from 'vitest';
import {
  computeCycleProgress,
  cycleLengthDays,
  findMatchingCycles,
  goalContribution,
  goalMatchesExercise,
  goalScope,
  isDayWithinCycle,
  previousCyclePeriod,
  remainingGoals,
  resetCycleRange,
  setMatchesGoal,
  type CycleMatchable,
  type CycleMatchableExercise,
  type CycleMatchableGoal,
} from '../src/cycles.js';
import { makeSet } from './helpers.js';

const BICEPS = 'tag-biceps';
const NOGI = 'tag-nogi';

const uginanie: CycleMatchableExercise = { id: 'uginanie', primaryTagId: BICEPS };
const mlotki: CycleMatchableExercise = { id: 'mlotki', primaryTagId: BICEPS };
const przysiad: CycleMatchableExercise = { id: 'przysiad', primaryTagId: NOGI };
/** Ćwiczenie z tagiem dodatkowym „biceps" — tagi dodatkowe nie zaliczają serii. */
const podciaganie: CycleMatchableExercise = { id: 'podciaganie', primaryTagId: 'tag-grzbiet' };
const bieg: CycleMatchableExercise = { id: 'bieg', primaryTagId: 'tag-cardio' };

const exercises = [uginanie, mlotki, przysiad, podciaganie, bieg];
const exerciseById = (id: string) => exercises.find((exercise) => exercise.id === id);

function goal(overrides: Partial<CycleMatchableGoal> = {}): CycleMatchableGoal {
  return {
    id: 'goal-1',
    metric: 'sets',
    target: 12,
    exerciseId: null,
    tagId: BICEPS,
    ...overrides,
  };
}

function cycle(overrides: Partial<CycleMatchable> = {}): CycleMatchable {
  return {
    id: 'cycle-1',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    goals: [goal()],
    ...overrides,
  };
}

describe('goalScope', () => {
  it('rozpoznaje zakres ćwiczenia i zakres tagu', () => {
    expect(goalScope(goal({ tagId: BICEPS }))).toEqual({ kind: 'tag', id: BICEPS });
    expect(goalScope(goal({ tagId: null, exerciseId: 'uginanie' }))).toEqual({
      kind: 'exercise',
      id: 'uginanie',
    });
  });

  it('odrzuca pozycję bez wskazanego zakresu', () => {
    expect(() => goalScope(goal({ tagId: null }))).toThrow(RangeError);
  });
});

describe('zakres dat cyklu', () => {
  it('jest domknięty obustronnie', () => {
    const c = cycle();
    expect(isDayWithinCycle(c, '2026-08-01')).toBe(true);
    expect(isDayWithinCycle(c, '2026-08-31')).toBe(true);
    expect(isDayWithinCycle(c, '2026-07-31')).toBe(false);
    expect(isDayWithinCycle(c, '2026-09-01')).toBe(false);
  });

  it('cykl bez daty końca trwa dalej', () => {
    expect(isDayWithinCycle(cycle({ endsOn: null }), '2030-01-01')).toBe(true);
  });
});

describe('dopasowanie pozycji celu do ćwiczenia', () => {
  it('cel tagowy patrzy wyłącznie na tag główny', () => {
    expect(goalMatchesExercise(goal({ tagId: BICEPS }), uginanie)).toBe(true);
    expect(goalMatchesExercise(goal({ tagId: BICEPS }), podciaganie)).toBe(false);
  });

  it('cel ćwiczeniowy patrzy na identyfikator ćwiczenia', () => {
    const g = goal({ tagId: null, exerciseId: 'uginanie' });
    expect(goalMatchesExercise(g, uginanie)).toBe(true);
    expect(goalMatchesExercise(g, mlotki)).toBe(false);
  });
});

describe('goalContribution', () => {
  it('cel na serie liczy każdą serię jako jedną', () => {
    expect(goalContribution(goal({ metric: 'sets' }), makeSet({ reps: 10 }))).toBe(1);
  });

  it('cel czasowy sumuje sekundy, dystansowy metry', () => {
    const set = makeSet({ durationS: 90, distanceM: 1500 });
    expect(goalContribution(goal({ metric: 'duration' }), set)).toBe(90);
    expect(goalContribution(goal({ metric: 'distance' }), set)).toBe(1500);
  });

  it('brak wartości metryki to zerowy wkład', () => {
    expect(goalContribution(goal({ metric: 'distance' }), makeSet({ reps: 10 }))).toBe(0);
  });
});

describe('setMatchesGoal', () => {
  it('zalicza serię ćwiczenia o pasującym tagu głównym w zakresie dat', () => {
    const set = makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-10', reps: 10 });
    expect(setMatchesGoal(cycle(), goal(), set, uginanie)).toBe(true);
  });

  it('nie zalicza serii spoza zakresu dat', () => {
    const set = makeSet({ exerciseId: 'uginanie', performedOn: '2026-07-20', reps: 10 });
    expect(setMatchesGoal(cycle(), goal(), set, uginanie)).toBe(false);
  });

  it('nie zalicza serii ćwiczenia, którego tag główny nie pasuje', () => {
    const set = makeSet({ exerciseId: 'przysiad', performedOn: '2026-08-10', reps: 10 });
    expect(setMatchesGoal(cycle(), goal(), set, przysiad)).toBe(false);
  });

  it('nie zalicza serii bez wartości wymaganej przez metrykę', () => {
    const set = makeSet({ exerciseId: 'bieg', performedOn: '2026-08-10', reps: 10 });
    const dystansowy = goal({
      metric: 'distance',
      tagId: null,
      exerciseId: 'bieg',
      target: 10_000,
    });
    expect(setMatchesGoal(cycle(), dystansowy, set, bieg)).toBe(false);
  });
});

describe('computeCycleProgress', () => {
  const dwanascieSeriiNaBiceps = cycle({
    goals: [goal({ id: 'g-biceps', metric: 'sets', target: 12, tagId: BICEPS })],
  });

  it('sumuje serie ze wszystkich ćwiczeń o pasującym tagu głównym', () => {
    const sets = [
      makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-02', reps: 10 }),
      makeSet({ exerciseId: 'mlotki', performedOn: '2026-08-03', reps: 10 }),
      makeSet({ exerciseId: 'przysiad', performedOn: '2026-08-03', reps: 10 }),
    ];

    const progress = computeCycleProgress(dwanascieSeriiNaBiceps, sets, exerciseById);
    expect(progress.goals[0]?.current).toBe(2);
    expect(progress.goals[0]?.remaining).toBe(10);
    expect(progress.completed).toBe(false);
  });

  it('nie liczy tagów dodatkowych', () => {
    const sets = [makeSet({ exerciseId: 'podciaganie', performedOn: '2026-08-02', reps: 10 })];
    const progress = computeCycleProgress(dwanascieSeriiNaBiceps, sets, exerciseById);
    expect(progress.goals[0]?.current).toBe(0);
  });

  it('usunięcie serii zmniejsza postęp, bo liczy od zera', () => {
    const pierwsza = makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-02', reps: 10 });
    const druga = makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-02', reps: 8 });

    const pelny = computeCycleProgress(dwanascieSeriiNaBiceps, [pierwsza, druga], exerciseById);
    const poUsunieciu = computeCycleProgress(dwanascieSeriiNaBiceps, [pierwsza], exerciseById);

    expect(pelny.goals[0]?.current).toBe(2);
    expect(poUsunieciu.goals[0]?.current).toBe(1);
  });

  it('sumuje dystans dla celu „10 km biegu"', () => {
    const dziesiecKilometrow = cycle({
      goals: [
        goal({ id: 'g-bieg', metric: 'distance', target: 10_000, tagId: null, exerciseId: 'bieg' }),
      ],
    });
    const sets = [
      makeSet({ exerciseId: 'bieg', performedOn: '2026-08-05', distanceM: 4000, durationS: 1200 }),
      makeSet({ exerciseId: 'bieg', performedOn: '2026-08-09', distanceM: 6000, durationS: 1900 }),
    ];

    const progress = computeCycleProgress(dziesiecKilometrow, sets, exerciseById);
    expect(progress.goals[0]?.current).toBe(10_000);
    expect(progress.goals[0]?.completed).toBe(true);
    expect(progress.completed).toBe(true);
  });

  it('sumuje czas dla celu czasowego', () => {
    const godzinaDeski = cycle({
      goals: [
        goal({ id: 'g-czas', metric: 'duration', target: 600, tagId: null, exerciseId: 'bieg' }),
      ],
    });
    const sets = [
      makeSet({ exerciseId: 'bieg', performedOn: '2026-08-05', durationS: 400 }),
      makeSet({ exerciseId: 'bieg', performedOn: '2026-08-06', durationS: 100 }),
    ];
    expect(computeCycleProgress(godzinaDeski, sets, exerciseById).goals[0]?.current).toBe(500);
  });

  it('przycina udział do stu procent, ale nie ucina zliczonej wartości', () => {
    const sets = Array.from({ length: 20 }, (_, index) =>
      makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-02', position: index, reps: 10 }),
    );
    const progress = computeCycleProgress(dwanascieSeriiNaBiceps, sets, exerciseById);
    expect(progress.goals[0]?.current).toBe(20);
    expect(progress.goals[0]?.ratio).toBe(1);
    expect(progress.goals[0]?.remaining).toBe(0);
  });

  it('udział całego cyklu to średnia z udziałów pozycji', () => {
    const dwiePozycje = cycle({
      goals: [
        goal({ id: 'g-1', metric: 'sets', target: 10, tagId: BICEPS }),
        goal({ id: 'g-2', metric: 'sets', target: 10, tagId: NOGI }),
      ],
    });
    const sets = Array.from({ length: 8 }, (_, index) =>
      makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-02', position: index, reps: 10 }),
    );

    const progress = computeCycleProgress(dwiePozycje, sets, exerciseById);
    expect(progress.ratio).toBeCloseTo(0.4);
    expect(remainingGoals(progress).map((g) => g.goalId)).toEqual(['g-1', 'g-2']);
  });

  it('pomija serie ćwiczeń, których nie da się rozwiązać', () => {
    const sets = [makeSet({ exerciseId: 'nieznane', performedOn: '2026-08-02', reps: 10 })];
    const progress = computeCycleProgress(dwanascieSeriiNaBiceps, sets, () => undefined);
    expect(progress.goals[0]?.current).toBe(0);
  });
});

describe('okresy cyklu', () => {
  const sierpien = { startsOn: '2026-08-01', endsOn: '2026-08-31' };

  it('długość zakresu jest liczona z oboma brzegami', () => {
    expect(cycleLengthDays(sierpien)).toBe(31);
    expect(cycleLengthDays({ startsOn: '2026-08-01', endsOn: '2026-08-01' })).toBe(1);
    expect(cycleLengthDays({ startsOn: '2026-08-01', endsOn: null })).toBeNull();
  });

  it('reset przesuwa koniec razem z początkiem', () => {
    expect(resetCycleRange(sierpien, '2026-09-01')).toEqual({
      startsOn: '2026-09-01',
      endsOn: '2026-10-01',
    });
  });

  it('reset cyklu bez końca zostawia go bez końca', () => {
    expect(resetCycleRange({ startsOn: '2026-08-01', endsOn: null }, '2026-09-01')).toEqual({
      startsOn: '2026-09-01',
      endsOn: null,
    });
  });

  it('poprzedni okres przykleja się do bieżącego od dołu', () => {
    expect(previousCyclePeriod(sierpien)).toEqual({
      startsOn: '2026-07-01',
      endsOn: '2026-07-31',
    });
    expect(previousCyclePeriod(sierpien, 2)).toEqual({
      startsOn: '2026-05-31',
      endsOn: '2026-06-30',
    });
  });

  it('cykl bez końca nie ma poprzedniego okresu', () => {
    expect(previousCyclePeriod({ startsOn: '2026-08-01', endsOn: null })).toBeNull();
  });

  it('postęp poprzedniego okresu liczy się tym samym kodem, na podmienionym zakresie', () => {
    const miesiac = cycle({ startsOn: '2026-08-01', endsOn: '2026-08-31' });
    const sets = [
      makeSet({ exerciseId: 'uginanie', performedOn: '2026-07-10', reps: 10 }),
      makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-10', reps: 10 }),
    ];

    const poprzedni = previousCyclePeriod(miesiac);
    const progress = computeCycleProgress({ ...miesiac, ...poprzedni! }, sets, exerciseById);

    // Historia zostaje w seriach, więc realizacja sprzed resetu jest dalej do policzenia.
    expect(progress.goals[0]?.current).toBe(1);
  });
});

describe('findMatchingCycles', () => {
  it('zalicza jedną serię do wszystkich pasujących cykli naraz', () => {
    const cykle = [
      cycle({ id: 'c-biceps', goals: [goal({ tagId: BICEPS })] }),
      cycle({
        id: 'c-uginanie',
        goals: [goal({ id: 'g-2', tagId: null, exerciseId: 'uginanie' })],
      }),
      cycle({ id: 'c-nogi', goals: [goal({ id: 'g-3', tagId: NOGI })] }),
    ];
    const set = makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-10', reps: 10 });

    expect(findMatchingCycles(cykle, set, uginanie).map((c) => c.id)).toEqual([
      'c-biceps',
      'c-uginanie',
    ]);
  });

  it('pomija cykl, którego zakres dat nie obejmuje dnia serii', () => {
    const cykle = [cycle({ id: 'c-1', startsOn: '2026-09-01', endsOn: '2026-09-30' })];
    const set = makeSet({ exerciseId: 'uginanie', performedOn: '2026-08-10', reps: 10 });
    expect(findMatchingCycles(cykle, set, uginanie)).toEqual([]);
  });
});
