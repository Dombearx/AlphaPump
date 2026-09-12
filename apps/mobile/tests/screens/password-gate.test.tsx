/**
 * Podgląd hasła na ekranie „ustaw własne hasło".
 *
 * Ekran prosi o hasło dwa razy z rzędu, na klawiaturze wielkości palca, a obie
 * odpowiedzi widać jako kropki — literówka wychodzi dopiero przy „hasła nie są
 * takie same" i nie mówi, w którym polu siedzi. Te testy pilnują tego, co
 * podgląd ma z tym zrobić: że startuje zakryty, że odsłania wpisaną wartość
 * i że każde z dwóch pól odsłania się osobno.
 *
 * Ekran jedzie prawdziwy, razem z regułą długości hasła z rdzenia — atrapą jest
 * wyłącznie samo ustawienie hasła, bo to jedyne wyjście do sieci.
 */

import { MIN_PASSWORD_LENGTH } from '@alphapump/core';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PasswordGate } from '../../src/ui/password-gate';

const PASSWORD = 'x'.repeat(MIN_PASSWORD_LENGTH);

function showGate() {
  render(
    <PasswordGate gate={{ state: 'required', setPassword: vi.fn(() => Promise.resolve()) }} />,
  );
  return {
    newPassword: () => screen.getByLabelText('New password') as HTMLInputElement,
    repeat: () => screen.getByLabelText('Repeat password') as HTMLInputElement,
  };
}

describe('podgląd hasła w bramce hasła', () => {
  it('oba pola startują zakryte', () => {
    const gate = showGate();

    expect(gate.newPassword().type).toBe('password');
    expect(gate.repeat().type).toBe('password');
    expect(screen.getAllByRole('button', { name: 'Show password' })).toHaveLength(2);
  });

  it('odsłania wpisane hasło i zakrywa je z powrotem', async () => {
    const gate = showGate();

    await userEvent.type(gate.newPassword(), PASSWORD);
    await userEvent.click(screen.getAllByRole('button', { name: 'Show password' })[0]!);

    expect(gate.newPassword().type).toBe('text');
    expect(gate.newPassword().value).toBe(PASSWORD);

    await userEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(gate.newPassword().type).toBe('password');
    expect(gate.newPassword().value).toBe(PASSWORD);
  });

  it('odsłonięcie jednego pola nie odsłania drugiego', async () => {
    // Wspólny stan wyglądałby identycznie aż do chwili, w której ktoś odsłania
    // hasło przy kimś i pokazuje mu przy okazji powtórzenie.
    const gate = showGate();

    await userEvent.click(screen.getAllByRole('button', { name: 'Show password' })[1]!);

    expect(gate.repeat().type).toBe('text');
    expect(gate.newPassword().type).toBe('password');
  });
});
