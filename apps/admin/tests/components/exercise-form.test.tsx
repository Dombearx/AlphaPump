/**
 * Formularz ćwiczenia w panelu.
 *
 * Reguły domeny (co wolno, jaka łatka wychodzi ze zmiany) mają własne testy
 * w `tests/exercise-draft.test.ts` i nie ma sensu ich tu powtarzać. Tutaj jest
 * to, czego tamte testy z definicji nie widzą: czy formularz **naprawdę je
 * stosuje** — czy pole typu logowania jest zablokowane przy edycji, czy wybranie
 * tagu głównego zdejmuje go z dodatkowych i czy przycisk zapisu odmawia, gdy
 * reguła jest złamana.
 *
 * To jest dokładnie ta warstwa, w której błąd nie zapala się na typecheku ani na
 * teście logiki, a widać go dopiero po kliknięciu.
 */

import type { Exercise, Tag } from '@alphapump/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ExerciseForm } from '../../src/components/exercise-form';

const CHEST = '33333333-3333-4333-8333-333333333333';
const TRICEPS = '44444444-4444-4444-8444-444444444444';

const TAGS: readonly Tag[] = [
  { id: CHEST, name: 'Chest', slug: 'chest' },
  { id: TRICEPS, name: 'Triceps', slug: 'triceps' },
].map((tag) => ({
  ...tag,
  color: '#4ade80',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
}));

const EXERCISE: Exercise = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Barbell bench press',
  slug: 'barbell-bench-press',
  authorId: '11111111-1111-4111-8111-111111111111',
  loggingType: 'weight_reps',
  primaryTagId: CHEST,
  additionalTagIds: [TRICEPS],
  note: null,
  gym: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
};

function renderForm(editing: Exercise | null = null) {
  const onSubmit = vi.fn();
  render(
    <ExerciseForm
      tags={TAGS}
      editing={editing}
      busy={false}
      onCancel={vi.fn()}
      onSubmit={onSubmit}
    />,
  );
  return onSubmit;
}

/**
 * Podpowiedź pod polem siedzi **w środku** `<label>`, więc dostępną nazwą pola
 * jest „etykieta + podpowiedź". Stąd wzorzec od początku napisu, a nie dokładne
 * dopasowanie — i stąd te dwa pomocniki, żeby nie powtarzać go w każdym teście.
 */
const loggingTypeSelect = () => screen.getByLabelText(/^Logging type/) as HTMLSelectElement;
const primaryTagSelect = () => screen.getByLabelText(/^Primary tag/) as HTMLSelectElement;

describe('formularz ćwiczenia', () => {
  it('blokuje typ logowania przy edycji', () => {
    // Zmiana typu unieważniłaby zapisane serie, więc serwer i tak by ją odrzucił.
    // Pole, które da się zmienić, a zmiana nic nie robi, jest gorsze od pola
    // wyłączonego: wygląda, jakby zadziałało.
    renderForm(EXERCISE);
    expect(loggingTypeSelect().disabled).toBe(true);
  });

  it('przy dodawaniu typ logowania da się wybrać', () => {
    renderForm();
    expect(loggingTypeSelect().disabled).toBe(false);
  });

  it('zdejmuje tag z dodatkowych, gdy zostaje głównym', async () => {
    // Ten sam tag w obu rolach liczyłby ćwiczenie do celu cyklu dwa razy.
    // Serwer odrzuca to z `409`, ale reguła ma zadziałać zanim ktokolwiek kliknie.
    const onSubmit = renderForm(EXERCISE);

    await userEvent.selectOptions(primaryTagSelect(), TRICEPS);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const draft = onSubmit.mock.calls[0]?.[0] as {
      primaryTagId: string;
      additionalTagIds: string[];
    };
    expect(draft.primaryTagId).toBe(TRICEPS);
    expect(draft.additionalTagIds).not.toContain(TRICEPS);
  });

  it('nie wysyła formularza bez nazwy i mówi dlaczego', async () => {
    const onSubmit = renderForm();

    await userEvent.click(screen.getByRole('button', { name: 'Add exercise' }));

    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Enter an exercise name');
  });

  it('nie wysyła zmiany, w której nic się nie zmieniło', async () => {
    // Żądanie bez zmian podbiłoby `updated_at` i pojechałoby na wszystkie
    // telefony jako zmiana, której nie ma.
    const onSubmit = renderForm(EXERCISE);

    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
