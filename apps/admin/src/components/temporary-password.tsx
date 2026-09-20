/**
 * Hasło tymczasowe — jedyny moment, w którym jest widoczne.
 *
 * Wartość przychodzi w odpowiedzi na reset i nigdzie nie jest zapisywana:
 * ani w pamięci podręcznej zapytań, ani w magazynie przeglądarki. Żyje w stanie
 * komponentu do chwili zamknięcia panelu i wtedy znika na dobre — odzyskanie jej
 * oznacza kolejny reset, o czym karta mówi wprost, zanim ktokolwiek kliknie
 * „Gotowe".
 *
 * Stąd też przycisk kopiowania zamiast samego tekstu do zaznaczenia: panel
 * chodzi po HTTP wewnątrz VPN, gdzie `navigator.clipboard` nie istnieje, więc
 * kopiowanie wymaga drogi awaryjnej (`lib/clipboard.ts`) — a wynik kopiowania
 * jest pokazywany, bo ciche niedokopiowanie kosztuje kolejny reset.
 */

import { useState } from 'react';
import type { PasswordResetResult } from '@alphapump/core';
import { Button, Card } from './ui';
import { copyToClipboard } from '../lib/clipboard';

export function TemporaryPassword({
  result,
  onDismiss,
}: {
  result: PasswordResetResult;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState<boolean | null>(null);

  return (
    <Card className="flex flex-col gap-3 border-accent/50 bg-accent/5">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          Temporary password
        </h2>
        <p className="mt-1 text-sm text-text">
          Konto <span className="font-medium">{result.email}</span> ma teraz to hasło. Przekaż je
          właścicielowi konta — przy najbliższym logowaniu ustawi sobie własne.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="rounded-lg border border-border bg-elevated px-3 py-2 font-mono text-base tracking-wider text-text select-all">
          {result.password}
        </code>
        <Button
          variant="secondary"
          onClick={() => {
            void copyToClipboard(result.password).then(setCopied);
          }}
        >
          Kopiuj
        </Button>
        {copied === true && <span className="text-xs text-success">Skopiowano do schowka.</span>}
        {copied === false && (
          <span className="text-xs text-danger">
            Nie udało się skopiować — zaznacz hasło i skopiuj ręcznie.
          </span>
        )}
      </div>

      <p className="text-xs text-muted">
        Hasła nie da się odczytać ponownie: serwer trzyma sam hash, a panel nigdzie go nie zapisuje.
        Zgubione znaczy „zresetuj jeszcze raz". Sesje tego konta zostały właśnie unieważnione, więc
        zalogowane urządzenia poproszą o nowe hasło.
      </p>

      <div>
        <Button onClick={onDismiss}>Gotowe — ukryj hasło</Button>
      </div>
    </Card>
  );
}
