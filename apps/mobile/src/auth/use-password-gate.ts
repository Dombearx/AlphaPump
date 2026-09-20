/**
 * Wymuszona zmiana hasła nadanego przez administratora.
 *
 * Poczty w stosie nie ma, więc odzyskanie dostępu do konta wygląda tak:
 * administrator nadaje hasło tymczasowe z panelu i przekazuje je osobiście,
 * a aplikacja przy najbliższym logowaniu każe ustawić własne. Ten hook jest
 * połową telefonową tego przepływu — drugą jest `ui/password-gate.tsx`, czyli
 * sam formularz.
 *
 * Trzy decyzje, które widać w kształcie stanu:
 *
 * - **Pytamy serwer, nie sesję.** Hasło tymczasowe nadaje ktoś inny, już po
 *   zalogowaniu; sesja nic o tym nie wie i wiedzieć nie może.
 * - **Brak sieci nie blokuje aplikacji.** Telefon poza VPN-em nie ma jak
 *   sprawdzić stanu hasła, a AlphaPump działa offline — zamiana „nie wiem"
 *   w „nie wejdziesz" odcięłaby zapisywanie serii na siłowni bez zasięgu.
 *   Sprawdzenie powtórzy się przy następnym uruchomieniu albo logowaniu.
 * - **Sprawdzamy raz na sesję.** Flaga zmienia się dwa razy w życiu konta,
 *   a nie co ekran; odpytywanie `GET /me` częściej byłoby ruchem bez treści.
 */

import { useCallback, useEffect, useState } from 'react';
import type { AccountClient } from '../remote/account';

/**
 * `unknown` — jeszcze nie wiemy (albo nie ma jak się dowiedzieć: offline);
 * `ok` — konto ma własne hasło; `required` — trzeba je ustawić, zanim cokolwiek.
 */
export type PasswordState = 'unknown' | 'ok' | 'required';

export interface PasswordGate {
  state: PasswordState;
  /** Ustawia hasło i zdejmuje blokadę; błąd wraca wyjątkiem do formularza. */
  setPassword: (newPassword: string) => Promise<void>;
}

export function usePasswordGate(client: AccountClient, userId: string | null): PasswordGate {
  const [state, setState] = useState<PasswordState>('unknown');

  useEffect(() => {
    if (userId === null) {
      setState('unknown');
      return;
    }

    let cancelled = false;
    void (async () => {
      try {
        const account = await client.me();
        if (!cancelled) setState(account.mustChangePassword ? 'required' : 'ok');
      } catch {
        // Każdy błąd znaczy tu to samo: nie wiemy. Brak sieci jest zwykłym
        // dniem aplikacji offline-first, a wygasłą sesją zajmuje się ścieżka
        // logowania — żadne z tych dwóch nie jest powodem, żeby zablokować
        // zapisywanie serii ekranem zmiany hasła.
        if (!cancelled) setState('unknown');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  const setPassword = useCallback(
    async (newPassword: string) => {
      await client.setPassword(newPassword);
      setState('ok');
    },
    [client],
  );

  return { state, setPassword };
}
