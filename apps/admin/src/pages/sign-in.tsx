/**
 * Logowanie do panelu.
 *
 * E-mail i hasło, bez Google — i to nie jest niedokończone. Logowanie Google
 * wymaga adresu zwrotnego po HTTPS, a panel działa po HTTP wewnątrz VPN; telefon
 * obchodzi to natywnym przepływem, którego przeglądarka nie ma. Administrator ma
 * zwykłe konto z hasłem.
 */

import { useState } from 'react';
import { Button, Card, Field, Input, Problem } from '../components/ui';
import { signIn } from '../lib/auth';

export function SignInPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setProblem(null);

    void (async () => {
      const result = await signIn.email({ email, password });
      // better-auth oddaje błąd w wyniku, a nie wyjątkiem — komunikat serwera
      // pokazujemy wprost, bo „nie udało się zalogować" nie mówi, czy problem
      // jest w haśle, czy w tym, że API jest poza zasięgiem VPN.
      if (result.error) setProblem(result.error.message ?? 'Nie udało się zalogować');
      setBusy(false);
    })();
  };

  return (
    <main className="flex min-h-full items-center justify-center p-6">
      <Card className="w-full max-w-sm">
        <h1 className="text-xl font-semibold text-text">AlphaPump</h1>
        <p className="mt-1 mb-4 text-sm text-muted">Panel administracyjny</p>

        <form className="flex flex-col gap-3" onSubmit={submit}>
          <Field label="E-mail">
            <Input
              type="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label="Hasło">
            <Input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>

          {problem !== null && <Problem error={new Error(problem)} />}

          <Button type="submit" disabled={busy}>
            {busy ? 'Logowanie…' : 'Zaloguj'}
          </Button>
        </form>
      </Card>
    </main>
  );
}
