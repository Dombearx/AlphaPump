/**
 * Cykl WHO — szablon i to, co z niego wynika przy liczeniu postępu.
 *
 * Testy są tu na jednym poziomie z regułą, o którą chodzi w zgłoszeniu: WHO
 * mówi „150 minut umiarkowanego **albo** 75 intensywnego", a nie „150 i 75".
 * Gdyby szablon rozpadł się na osobne cele per intensywność, ostatni test w tym
 * pliku pokazałby cykl zrobiony w połowie przy wytycznych spełnionych w całości.
 */

import { describe, expect, it } from 'vitest';
import {
  computeCycleProgress,
  type CycleMatchable,
  type CycleMatchableExercise,
} from '../src/cycles.js';
import type { IsoDate } from '../src/dates.js';
import { cycleGoalInputSchema } from '../src/schemas.js';
import { WHO_ADDITIONAL_S, WHO_CYCLE_DAYS, WHO_MINIMUM_S, whoCycleInput } from '../src/who.js';
import { makeSet } from './helpers.js';

const MONDAY = '2026-08-03' as IsoDate;

const marsz: CycleMatchableExercise = { id: 'marsz', primaryTagId: 'cardio', intensity: 'low' };
const bieg: CycleMatchableExercise = { id: 'bieg', primaryTagId: 'cardio', intensity: 'moderate' };
const interwaly: CycleMatchableExercise = {
  id: 'interwaly',
  primaryTagId: 'cardio',
  intensity: 'high',
};
const lawka: CycleMatchableExercise = { id: 'lawka', primaryTagId: 'klatka', intensity: null };

const exercises = [marsz, bieg, interwaly, lawka];
const exerciseById = (id: string) => exercises.find((exercise) => exercise.id === id);

/** Szablon jako cykl gotowy do policzenia — identyfikatory pozycji są tu udawane. */
function whoCycle(startsOn: IsoDate = MONDAY): CycleMatchable {
  const template = whoCycleInput(startsOn);
  return {
    id: 'cycle-who',
    startsOn: template.startsOn,
    endsOn: template.endsOn,
    goals: template.goals.map((goal, index) => ({ ...goal, id: `goal-${String(index)}` })),
  };
}

/** Seria o zadanej długości w minutach, wykonana w poniedziałek. */
const minutes = (exerciseId: string, count: number) =>
  makeSet({ exerciseId, performedOn: MONDAY, durationS: count * 60 });

describe('whoCycleInput', () => {
  it('daje cykl tygodniowy z dwoma poziomami jednej pozycji', () => {
    const template = whoCycleInput(MONDAY);

    expect(template.startsOn).toBe(MONDAY);
    expect(template.endsOn).toBe('2026-08-09');
    expect(WHO_CYCLE_DAYS).toBe(7);
    expect(template.goals).toHaveLength(1);
    expect(template.goals[0]).toMatchObject({
      metric: 'duration',
      target: WHO_MINIMUM_S,
      stretchTarget: WHO_ADDITIONAL_S,
      intensity: 'moderate',
      exerciseId: null,
      tagId: null,
    });
  });

  it('progi odpowiadają wytycznym: 150 i 300 minut tygodniowo', () => {
    expect(WHO_MINIMUM_S).toBe(150 * 60);
    expect(WHO_ADDITIONAL_S).toBe(300 * 60);
  });

  it('przechodzi walidację pozycji celu', () => {
    expect(() => cycleGoalInputSchema.parse(whoCycleInput(MONDAY).goals[0])).not.toThrow();
  });
});

describe('postęp cyklu WHO', () => {
  const progressOf = (sets: ReturnType<typeof minutes>[]) =>
    computeCycleProgress(whoCycle(), sets, exerciseById);

  it('150 minut wysiłku umiarkowanego domyka poziom minimalny', () => {
    const progress = progressOf([minutes('bieg', 150)]);

    expect(progress.completed).toBe(true);
    expect(progress.level).toBe('minimal');
    expect(progress.stretchCompleted).toBe(false);
  });

  it('300 minut domyka poziom wyższy — ten „dla dodatkowych korzyści"', () => {
    const progress = progressOf([minutes('bieg', 300)]);

    expect(progress.level).toBe('higher');
    expect(progress.stretchCompleted).toBe(true);
    expect(progress.stretchRatio).toBe(1);
  });

  it('75 minut wysiłku intensywnego znaczy dokładnie tyle samo, co 150 umiarkowanego', () => {
    const vigorous = progressOf([minutes('interwaly', 75)]);

    expect(vigorous.completed).toBe(true);
    expect(vigorous.goals[0]?.current).toBe(WHO_MINIMUM_S);
  });

  it('kombinacja obu sumuje się według tej samej równoważności', () => {
    // 90 minut umiarkowanego + 30 intensywnego = 90 + 60 = 150 minut.
    const progress = progressOf([minutes('bieg', 90), minutes('interwaly', 30)]);

    expect(progress.goals[0]?.current).toBe(WHO_MINIMUM_S);
    expect(progress.completed).toBe(true);
  });

  it('aktywność lekka i ćwiczenia bez intensywności nie zasilają celu', () => {
    const progress = progressOf([minutes('marsz', 300), minutes('lawka', 300)]);

    expect(progress.goals[0]?.current).toBe(0);
    expect(progress.completed).toBe(false);
  });

  it('seria spoza tygodnia cyklu się nie liczy', () => {
    const outside = makeSet({ exerciseId: 'bieg', performedOn: '2026-08-10', durationS: 150 * 60 });
    expect(computeCycleProgress(whoCycle(), [outside], exerciseById).goals[0]?.current).toBe(0);
  });
});
