/**
 * Reguły porządkowania biblioteki.
 *
 * Trzy rzeczy, których pomyłka jest kosztowna, a renderowanie tabeli nie ma
 * z nimi nic wspólnego: **czy wiersz da się usunąć** (przycisk, który zawsze
 * odbija się o 409, jest gorszy niż nieaktywny), **co wolno wybrać jako cel
 * scalenia** (ćwiczenie innego typu logowania przyjęłoby serie, których potem
 * nie da się poprawić) i **które wiersze widać** przy filtrach, po których
 * odróżnia się bibliotekę wbudowaną od tego, co doszło później.
 */

import type { Exercise, LibraryExercise, LibraryTag } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import {
  EMPTY_FILTER,
  exerciseDeletionProblem,
  exerciseMergeTargets,
  filterExercises,
  tagDeletionProblem,
  tagMergeTargets,
  usageSummary,
} from '../src/lib/library-view';

const STAMPS = {
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

const BICEPS = '44444444-4444-4444-8444-444444444444';
const PLECY = '33333333-3333-4333-8333-333333333333';

type ExerciseOverrides = Omit<Partial<LibraryExercise>, 'exercise'> & {
  name?: string;
  exercise?: Partial<Exercise>;
};

function exercise(id: string, overrides: ExerciseOverrides = {}): LibraryExercise {
  const { name = `Ćwiczenie ${id}`, exercise: fields, ...rest } = overrides;

  return {
    exercise: {
      id,
      name,
      slug: name.toLowerCase(),
      authorId: 'autor',
      loggingType: 'weight_reps',
      primaryTagId: BICEPS,
      additionalTagIds: [],
      note: null,
      gym: null,
      ...STAMPS,
      ...fields,
    },
    authorNickname: 'Kuba',
    builtIn: false,
    hasEmbedding: true,
    usage: { sets: 0, deletedSets: 0, users: 0, goals: 0, lastPerformedOn: null },
    ...rest,
  };
}

function tag(id: string, overrides: Partial<LibraryTag> = {}): LibraryTag {
  return {
    tag: { id, name: `Tag ${id}`, slug: `tag-${id}`, color: '#4ade80', ...STAMPS },
    builtIn: false,
    usage: { primaryExercises: 0, additionalExercises: 0, exercises: 0, sets: 0, goals: 0 },
    ...overrides,
  };
}

describe('blokada usunięcia', () => {
  it('puszcza ćwiczenie, na którym nic nie wisi', () => {
    expect(exerciseDeletionProblem(exercise('a'))).toBeNull();
  });

  it('mówi, ile serii i czyich broni ćwiczenia', () => {
    const problem = exerciseDeletionProblem(
      exercise('a', {
        usage: { sets: 20, deletedSets: 0, users: 2, goals: 0, lastPerformedOn: '2026-04-01' },
      }),
    );
    expect(problem).toContain('20 logged sets');
    expect(problem).toContain('2 people');
    // Sam zakaz nie wystarczy — powód musi wskazać wyjście, bo inaczej wygląda
    // jak ściana.
    expect(problem).toContain('Merge');
  });

  it('broni ćwiczenia wskazanego przez cel cyklu, choć nie ma serii', () => {
    const problem = exerciseDeletionProblem(
      exercise('a', {
        usage: { sets: 0, deletedSets: 3, users: 0, goals: 1, lastPerformedOn: null },
      }),
    );
    expect(problem).toContain('cycle goals');
  });

  it('rozbija użycie tagu na główne i dodatkowe, bo to różny nakład pracy', () => {
    const problem = tagDeletionProblem(
      tag('t', {
        usage: { primaryExercises: 3, additionalExercises: 2, exercises: 4, sets: 12, goals: 0 },
      }),
    );
    expect(problem).toContain('4 exercises');
    expect(problem).toContain('3 of them as the primary tag');
    expect(problem).toContain('12 logged sets');
  });

  it('puszcza tag, którego nikt nie używa', () => {
    expect(tagDeletionProblem(tag('t'))).toBeNull();
  });
});

describe('cele scalenia', () => {
  const source = exercise('a');
  const rows = [
    source,
    exercise('b'),
    exercise('c', { exercise: { loggingType: 'bodyweight_time' } }),
    exercise('d', { exercise: { deletedAt: '2026-02-01T00:00:00.000Z' } }),
  ];

  it('pomija samo źródło, inny typ logowania i wiersze z tombstonem', () => {
    expect(exerciseMergeTargets(rows, source).map((entry) => entry.exercise.id)).toEqual(['b']);
  });

  it('pomija sam tag źródłowy i tagi usunięte', () => {
    const sourceTag = tag('a');
    const tags = [
      sourceTag,
      tag('b'),
      tag('c', { tag: { ...tag('c').tag, deletedAt: '2026-02-01T00:00:00.000Z' } }),
    ];
    expect(tagMergeTargets(tags, sourceTag).map((entry) => entry.tag.id)).toEqual(['b']);
  });
});

describe('filtrowanie', () => {
  const rows = [
    exercise('a', { name: 'Wyciskanie sztangi', builtIn: true, authorNickname: 'AlphaPump' }),
    exercise('b', { name: 'Uginanie', authorNickname: 'Domin' }),
    exercise('c', {
      name: 'Stary wpis',
      exercise: { deletedAt: '2026-02-01T00:00:00.000Z' },
    }),
    exercise('d', { name: 'Z tagiem', exercise: { additionalTagIds: [PLECY] } }),
  ];

  it('domyślnie pokazuje wyłącznie wiersze żywe', () => {
    expect(filterExercises(rows, EMPTY_FILTER).map((entry) => entry.exercise.id)).toEqual([
      'a',
      'b',
      'd',
    ]);
  });

  it('oddziela bibliotekę wbudowaną od tego, co doszło później', () => {
    const builtIn = filterExercises(rows, { ...EMPTY_FILTER, author: 'builtIn' });
    expect(builtIn.map((entry) => entry.exercise.id)).toEqual(['a']);

    const added = filterExercises(rows, { ...EMPTY_FILTER, author: 'user' });
    expect(added.map((entry) => entry.exercise.id)).toEqual(['b', 'd']);
  });

  it('szuka też po autorze — po tym poznaje się wiersze, których nikt nie planował', () => {
    const mine = filterExercises(rows, { ...EMPTY_FILTER, query: 'domin' });
    expect(mine.map((entry) => entry.exercise.id)).toEqual(['b']);
  });

  it('pokazuje wiersze z tombstonem dopiero na żądanie', () => {
    const deleted = filterExercises(rows, { ...EMPTY_FILTER, status: 'deleted' });
    expect(deleted.map((entry) => entry.exercise.id)).toEqual(['c']);

    const both = filterExercises(rows, { ...EMPTY_FILTER, status: 'all' });
    expect(both).toHaveLength(4);
  });

  it('filtruje po tagu głównym i dodatkowym', () => {
    const byExtra = filterExercises(rows, { ...EMPTY_FILTER, tagId: PLECY });
    expect(byExtra.map((entry) => entry.exercise.id)).toEqual(['d']);

    const byPrimary = filterExercises(rows, { ...EMPTY_FILTER, tagId: BICEPS });
    expect(byPrimary.map((entry) => entry.exercise.id)).toEqual(['a', 'b', 'd']);
  });
});

describe('podsumowanie użycia', () => {
  it('milczy, gdy nic nie wisi', () => {
    expect(
      usageSummary({ sets: 0, deletedSets: 0, users: 0, goals: 0, lastPerformedOn: null }),
    ).toBe('');
  });

  it('wymienia liczbę osób dopiero wtedy, gdy jest ich więcej niż jedna', () => {
    const solo = usageSummary({
      sets: 4,
      deletedSets: 0,
      users: 1,
      goals: 0,
      lastPerformedOn: null,
    });
    expect(solo).toBe('4 sets');

    const shared = usageSummary({
      sets: 4,
      deletedSets: 1,
      users: 3,
      goals: 2,
      lastPerformedOn: null,
    });
    expect(shared).toBe('4 sets · 3 people · 2 goals · 1 deleted sets');
  });
});
