/**
 * Reguły formularza ćwiczenia.
 *
 * To jedyne miejsce w panelu, w którym da się popełnić błąd **domenowy**, a nie
 * literówkę — i jedyne, którego skutek widać dopiero na cudzym telefonie, po
 * synchronizacji. Stąd testy są tutaj, a nie na renderowaniu `<select>`.
 */

import type { Exercise, Tag } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import {
  exerciseInput,
  exercisePatch,
  exerciseProblem,
  type ExerciseDraft,
} from '../src/lib/exercise-draft';

const PLECY = '33333333-3333-4333-8333-333333333333';
const BICEPS = '44444444-4444-4444-8444-444444444444';
const NOGI = '55555555-5555-4555-8555-555555555555';

const TAGS: Tag[] = [PLECY, BICEPS, NOGI].map((id, index) => ({
  id,
  name: ['Plecy', 'Biceps', 'Nogi'][index] as string,
  slug: ['plecy', 'biceps', 'nogi'][index] as string,
  color: '#4ade80',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}));

const DRAFT: ExerciseDraft = {
  name: 'Podciąganie nachwytem',
  loggingType: 'bodyweight_reps',
  primaryTagId: PLECY,
  additionalTagIds: [BICEPS],
  note: '',
  gym: '',
};

const EXERCISE: Exercise = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Podciąganie nachwytem',
  slug: 'podciaganie-nachwytem',
  authorId: '11111111-1111-4111-8111-111111111111',
  loggingType: 'bodyweight_reps',
  primaryTagId: PLECY,
  additionalTagIds: [BICEPS],
  note: null,
  gym: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

describe('poprawność formularza', () => {
  it('przepuszcza komplet', () => {
    expect(exerciseProblem(DRAFT, TAGS)).toBeNull();
  });

  it('wymaga nazwy', () => {
    expect(exerciseProblem({ ...DRAFT, name: '   ' }, TAGS)).toMatch(/nazwę/);
  });

  it('nie pozwala, by tag główny był jednocześnie dodatkowym', () => {
    // Inaczej to samo ćwiczenie liczyłoby się do celu cyklu dwa razy.
    const problem = exerciseProblem({ ...DRAFT, additionalTagIds: [PLECY, BICEPS] }, TAGS);
    expect(problem).toMatch(/jednocześnie dodatkowym/);
  });

  it('odrzuca tag główny, którego nie ma na liście', () => {
    // Lista tagów mogła się zmienić w innej karcie — sam niepusty wybór nie
    // dowodzi, że tag nadal istnieje.
    expect(exerciseProblem({ ...DRAFT, primaryTagId: NOGI }, [])).toMatch(/tag/i);
  });

  it('tłumaczy pustą bibliotekę tagów osobno', () => {
    const problem = exerciseProblem({ ...DRAFT, primaryTagId: '' }, []);
    expect(problem).toMatch(/dodaj choć jeden tag/i);
  });

  it('pilnuje długości notatki i siłowni', () => {
    expect(exerciseProblem({ ...DRAFT, note: 'x'.repeat(1001) }, TAGS)).toMatch(/Notatka/);
    expect(exerciseProblem({ ...DRAFT, gym: 'x'.repeat(81) }, TAGS)).toMatch(/Siłownia/);
  });
});

describe('wejście do utworzenia', () => {
  it('przycina nazwę i zamienia puste pola na brak wartości', () => {
    const input = exerciseInput({ ...DRAFT, name: '  Martwy ciąg  ', note: '   ', gym: '' });

    expect(input.name).toBe('Martwy ciąg');
    // `null`, nie pusty napis: „bez notatki" to brak wartości, a nie wartość pusta.
    expect(input.note).toBeNull();
    expect(input.gym).toBeNull();
  });

  it('niesie typ logowania, tagi i notatkę', () => {
    const input = exerciseInput({ ...DRAFT, note: 'Chwyt szerszy', gym: 'Zdrofit' });

    expect(input).toEqual({
      name: 'Podciąganie nachwytem',
      loggingType: 'bodyweight_reps',
      primaryTagId: PLECY,
      additionalTagIds: [BICEPS],
      note: 'Chwyt szerszy',
      gym: 'Zdrofit',
    });
  });
});

describe('łatka przy zmianie', () => {
  it('jest pusta, gdy nic się nie zmieniło', () => {
    // Żądanie bez zmian podbiłoby `updatedAt` na wszystkich urządzeniach.
    expect(exercisePatch(DRAFT, EXERCISE)).toEqual({});
  });

  it('niesie wyłącznie zmienione pola', () => {
    expect(exercisePatch({ ...DRAFT, name: 'Podciąganie podchwytem' }, EXERCISE)).toEqual({
      name: 'Podciąganie podchwytem',
    });
  });

  it('nie zawiera typu logowania, nawet gdy różny', () => {
    // `UpdateExerciseInput` go nie zna — zmiana unieważniłaby zapisane serie.
    const patch = exercisePatch({ ...DRAFT, loggingType: 'weight_reps' }, EXERCISE);
    expect(patch).toEqual({});
    expect(patch).not.toHaveProperty('loggingType');
  });

  it('widzi zmianę kolejności tagów dodatkowych', () => {
    // Kolejność wchodzi do kolumny `position` w `exercise_tags`, więc porównanie
    // zbiorami przepuściłoby zmianę, której użytkownik dokonał świadomie.
    const patch = exercisePatch(
      { ...DRAFT, additionalTagIds: [BICEPS, NOGI] },
      { ...EXERCISE, additionalTagIds: [NOGI, BICEPS] },
    );
    expect(patch.additionalTagIds).toEqual([BICEPS, NOGI]);
  });

  it('rozpoznaje skasowanie notatki', () => {
    const patch = exercisePatch({ ...DRAFT, note: '' }, { ...EXERCISE, note: 'Stara notatka' });
    expect(patch).toEqual({ note: null });
  });

  it('zbiera kilka zmian naraz', () => {
    const patch = exercisePatch(
      { ...DRAFT, name: 'Nowa', primaryTagId: NOGI, additionalTagIds: [BICEPS], gym: 'Siłka' },
      EXERCISE,
    );
    expect(patch).toEqual({
      name: 'Nowa',
      primaryTagId: NOGI,
      gym: 'Siłka',
    });
  });
});
