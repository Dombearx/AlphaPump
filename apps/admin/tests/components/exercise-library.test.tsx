/**
 * Tabela biblioteki ćwiczeń w panelu.
 *
 * Jedno pytanie, na które ta tabela odpowiada, jest ważniejsze od reszty:
 * **czy ten wiersz da się usunąć**. Odpowiedź nie wynika z uprawnień, tylko
 * z tego, co na wierszu wisi — zapisane serie i cele cyklu — i musi być widoczna
 * *zanim* ktoś kliknie. Przycisk, który zawsze kończy się błędem `409`, jest
 * gorszy od nieaktywnego z wyjaśnieniem obok.
 */

import type { LibraryExercise } from '@alphapump/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseLibrary } from '../../src/components/exercise-library';

const CHEST = '33333333-3333-4333-8333-333333333333';

function entry(overrides: Partial<LibraryExercise['usage']> = {}): LibraryExercise {
  return {
    exercise: {
      id: '22222222-2222-4222-8222-222222222222',
      name: 'Barbell bench press',
      slug: 'barbell-bench-press',
      translations: null,
      authorId: '11111111-1111-4111-8111-111111111111',
      loggingType: 'weight_reps',
      primaryTagId: CHEST,
      additionalTagIds: [],
      note: null,
      gym: null,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      deletedAt: null,
    },
    authorNickname: 'Kuba',
    builtIn: false,
    hasEmbedding: true,
    usage: { sets: 0, deletedSets: 0, users: 0, lastPerformedOn: null, goals: 0, ...overrides },
  };
}

function renderLibrary(rows: readonly LibraryExercise[]) {
  const onDelete = vi.fn();
  render(
    <ExerciseLibrary
      rows={rows}
      all={rows}
      tagNames={new Map([[CHEST, 'Chest']])}
      busy={false}
      onEdit={vi.fn()}
      onDelete={onDelete}
      onRestore={vi.fn()}
      onMerge={vi.fn()}
    />,
  );
  return onDelete;
}

const deleteButton = () => screen.getByRole('button', { name: 'Delete' }) as HTMLButtonElement;

describe('biblioteka ćwiczeń w panelu', () => {
  it('pozwala usunąć ćwiczenie, na którym nic nie wisi', async () => {
    const onDelete = renderLibrary([entry()]);

    expect(deleteButton().disabled).toBe(false);
    await userEvent.click(deleteButton());
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('blokuje usunięcie ćwiczenia z zapisanymi seriami i pisze dlaczego', () => {
    renderLibrary([entry({ sets: 20, users: 2 })]);

    expect(deleteButton().disabled).toBe(true);
    // Powód stoi obok przycisku, a nie wyłącznie w atrybucie `title` — na
    // ekranie dotykowym nikt nie najedzie kursorem, żeby go zobaczyć.
    expect(document.body.textContent).toContain('20 logged sets');
    expect(document.body.textContent).toContain('Merge it into another exercise');
  });

  it('blokuje usunięcie ćwiczenia, na które wskazuje cel cyklu', () => {
    // Bez serii, więc pierwsza połowa reguły nie działa. Cel, którego ćwiczenie
    // zniknęło, nigdy nic nie naliczy i nie powie o tym ani słowa.
    renderLibrary([entry({ goals: 3 })]);

    expect(deleteButton().disabled).toBe(true);
    expect(document.body.textContent).toContain('cycle goals point at it');
  });

  it('tłumaczy pustą listę, zamiast pokazywać pustą tabelę', () => {
    renderLibrary([]);
    expect(document.body.textContent).toContain('Nothing matches the filters');
  });
});
