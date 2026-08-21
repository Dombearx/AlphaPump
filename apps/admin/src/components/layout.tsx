/**
 * Rama panelu: nawigacja i bramka dostępu.
 *
 * Bramka jest **dwustopniowa** i oba stopnie są potrzebne. Pierwszy to sesja: bez
 * niej pokazujemy logowanie. Drugi to rola, sprawdzana zapytaniem `GET /me`, a nie
 * odczytem z sesji — rola jest polem konta i może zostać odebrana w trakcie
 * trwania sesji. Panel bez tego sprawdzenia wyświetlałby administratorowi
 * pozbawionemu roli komplet ekranów, na których każde żądanie odbija się o 403.
 *
 * Sprawdzenie po stronie panelu **nie jest** zabezpieczeniem — uprawnień pilnuje
 * API przy każdym żądaniu. Jest komunikatem: „nie masz dostępu" zamiast pięciu
 * ekranów z błędami.
 */

import { useQuery } from '@tanstack/react-query';
import { Link, Outlet, useRouterState } from '@tanstack/react-router';
import { Button, Card, Loading, Problem } from './ui';
import { getMe } from '../lib/api';
import { signOut, useSession } from '../lib/auth';
import { SignInPage } from '../pages/sign-in';
import { cn } from '../lib/cn';

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/users', label: 'Accounts' },
  { to: '/library', label: 'Biblioteka' },
  { to: '/triage', label: 'Feedback' },
  { to: '/data', label: 'Dane' },
] as const;

export function Layout() {
  const { data: session, isPending } = useSession();
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => getMe(),
    enabled: Boolean(session),
    retry: false,
  });
  const path = useRouterState({ select: (state) => state.location.pathname });

  if (isPending) return <Loading label="Checking the session…" />;
  if (!session) return <SignInPage />;

  if (me.isPending) return <Loading label="Checking permissions…" />;
  if (me.error) {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <Card className="flex w-full max-w-md flex-col gap-3">
          <Problem error={me.error} />
          <p className="text-sm text-muted">
            If the API is out of reach, check the NetBird connection — the panel and the API are
            only reachable inside the VPN.
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </main>
    );
  }

  if (me.data.role !== 'admin') {
    return (
      <main className="flex min-h-full items-center justify-center p-6">
        <Card className="flex w-full max-w-md flex-col gap-3">
          <h1 className="text-lg font-semibold text-text">No permission</h1>
          <p className="text-sm text-muted">
            Account {me.data.email} does not have the administrator role. Another administrator can
            grant it from this panel.
          </p>
          <Button variant="secondary" onClick={() => void signOut()}>
            Sign out
          </Button>
        </Card>
      </main>
    );
  }

  return (
    <div className="min-h-full">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-semibold text-text">AlphaPump</span>

          <nav className="flex flex-1 flex-wrap gap-1">
            {NAV.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm transition-colors',
                  path === item.to ? 'bg-elevated text-text' : 'text-muted hover:text-text',
                )}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <span className="text-sm text-muted">{me.data.nickname}</span>
          <Button size="sm" variant="ghost" onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        <Outlet />
      </main>
    </div>
  );
}
