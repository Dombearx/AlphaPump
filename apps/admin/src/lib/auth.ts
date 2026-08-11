/**
 * Sesja panelu — ten sam better-auth, którym loguje się aplikacja mobilna.
 *
 * Panel nie ma własnego mechanizmu logowania i mieć nie powinien: rola
 * administratora jest polem konta, a nie osobnym hasłem do narzędzia. Jedno
 * konto, jedna baza, jeden sposób odbierania dostępu.
 *
 * Logowanie przez Google jest tu świadomie pominięte. Wymaga adresu zwrotnego po
 * HTTPS, a panel działa po HTTP wewnątrz VPN — natywny przepływ, którym radzi
 * sobie telefon, nie ma w przeglądarce odpowiednika. Administrator loguje się
 * hasłem.
 */

import { createAuthClient } from 'better-auth/react';
import { authBase } from './config';

export const authClient = createAuthClient({
  baseURL: authBase,
  fetchOptions: { credentials: 'include' },
});

export const { signIn, signOut, useSession } = authClient;
