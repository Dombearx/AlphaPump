/**
 * Podgląd hasła w panelu.
 *
 * Sprawdzamy trzy rzeczy, których nie widzi ani typecheck, ani test logiki:
 * że pole startuje zakryte, że odsłonięcie nie gubi tego, co już wpisano, i że
 * dwa pola na jednym ekranie (hasło + powtórzenie) mają osobne przełączniki.
 * Ostatnie jest tu dlatego, że wspólny stan wyglądałby na ekranie identycznie
 * aż do chwili, w której ktoś odsłania jedno pole i odkrywa drugie.
 */

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Field, PasswordInput } from '../../src/components/ui';

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;

describe('pole hasła z podglądem', () => {
  it('startuje zakryte', () => {
    render(
      <Field label="Password">
        <PasswordInput defaultValue="korekta" />
      </Field>,
    );

    expect(field('Password').type).toBe('password');
    expect(screen.getByRole('button', { name: 'Show password' })).toBeTruthy();
  });

  it('odsłania i zakrywa z powrotem, nie ruszając wpisanej wartości', async () => {
    render(
      <Field label="Password">
        <PasswordInput defaultValue="korekta" />
      </Field>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(field('Password').type).toBe('text');
    expect(field('Password').value).toBe('korekta');

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(field('Password').type).toBe('password');
    expect(field('Password').value).toBe('korekta');
  });

  it('trzyma odsłonięcie osobno dla każdego pola', async () => {
    render(
      <>
        <Field label="Nowe hasło">
          <PasswordInput />
        </Field>
        <Field label="Powtórz hasło">
          <PasswordInput />
        </Field>
      </>,
    );

    await userEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]!);

    expect(field('Nowe hasło').type).toBe('text');
    expect(field('Powtórz hasło').type).toBe('password');
  });
});
