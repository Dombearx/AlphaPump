/**
 * Ustawienie własnego hasła po resecie.
 *
 * Ekran pokazuje się zamiast całego panelu — nie obok niego i nie jako
 * przypomnienie do odłożenia. Konto, które tu trafia, loguje się hasłem
 * wpisanym mu przez kogoś innego; dopóki go nie zmieni, „zalogowany" znaczy
 * „zalogowany hasłem znanym administratorowi", a to jest stan przejściowy,
 * a nie sposób pracy.
 *
 * Starego hasła formularz nie wymaga, bo niczego by nie dowiodło: zna je ten,
 * kto je nadał. Dowodem tożsamości jest tu sesja, a pozwolenie na tę drogę —
 * flaga po stronie serwera, którą zdejmuje dopiero udana zmiana.
 */

import { useMutation } from '@tanstack/react-query';
import { MIN_PASSWORD_LENGTH } from '@alphapump/core';
import { useState } from 'react';
import { Button, Card, Field, Input, Problem } from '../components/ui';
import { setOwnPassword } from '../lib/api';
import { signOut } from '../lib/auth';

export function SetPasswordPage({ onDone }: { onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  const save = useMutation({
    mutationFn: () => setOwnPassword(password),
    onSuccess: onDone,
  });

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && repeat === password;

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="flex w-full max-w-sm flex-col gap-3">
        <div>
          <h1 className="text-lg font-semibold text-text">Ustaw własne hasło</h1>
          <p className="mt-1 text-sm text-muted">
            Twoje konto ma hasło tymczasowe nadane przez administratora. Wybierz własne, żeby
            przejść dalej.
          </p>
        </div>

        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Nowe hasło" hint={`Minimum ${String(MIN_PASSWORD_LENGTH)} znaków.`}>
            <Input
              type="password"
              autoComplete="new-password"
              autoFocus
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          <Field label="Powtórz hasło">
            <Input
              type="password"
              autoComplete="new-password"
              value={repeat}
              onChange={(event) => setRepeat(event.target.value)}
              required
            />
          </Field>

          {tooShort && (
            <p className="text-xs text-danger">
              Hasło jest za krótkie — potrzeba co najmniej {MIN_PASSWORD_LENGTH} znaków.
            </p>
          )}
          {mismatch && <p className="text-xs text-danger">Hasła nie są takie same.</p>}
          {save.error !== null && <Problem error={save.error} />}

          <Button type="submit" disabled={!ready || save.isPending}>
            {save.isPending ? 'Zapisywanie…' : 'Zapisz hasło'}
          </Button>
        </form>

        {/* Wyjście awaryjne: ktoś, kto trafił tu przez pomyłkę (cudza sesja
            w przeglądarce), ma jak wyjść bez zmieniania cudzego hasła. */}
        <Button variant="ghost" onClick={() => void signOut()}>
          Wyloguj się
        </Button>
      </Card>
    </main>
  );
}
