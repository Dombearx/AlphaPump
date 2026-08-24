/**
 * Ręczny przegląd zgłoszeń zwrotnych.
 *
 * Usługa `services/triage` czyta zgłoszenia sama, w kilkanaście sekund po tym,
 * jak wpadną — ten ekran daje ten sam przebieg na żądanie: sprawdzenie nowych
 * zgłoszeń, klasyfikacja, założenie issue na GitHubie albo otwarcie dyskusji na
 * Discordzie. Odkąd przebieg chodzi sam tak często, przycisk służy głównie temu,
 * żeby zobaczyć liczby, i temu, żeby ruszyć zgłoszenie odłożone po nieudanych
 * podejściach, nie czekając na koniec karencji. Wynik jest podsumowaniem liczb,
 * nie listą zgłoszeń — treść i tak trafia na Discorda i do GitHuba, więc drugie
 * miejsce do jej czytania tylko by się rozjeżdżało.
 */

import { useMutation } from '@tanstack/react-query';
import { Badge, Button, Card, CardTitle, Problem, Stat } from '../components/ui';
import { runFeedbackTriage } from '../lib/api';

export function FeedbackPage() {
  const run = useMutation({ mutationFn: () => runFeedbackTriage() });
  const report = run.data;

  return (
    <div className="flex flex-col gap-6">
      <Card className="flex flex-col gap-3">
        <CardTitle>Feedback triage</CardTitle>
        <p className="text-sm text-muted">
          Reads new in-app feedback, classifies it, and either opens a GitHub issue (a bug) or
          starts a Discord thread (a change request). The same pass runs by itself within seconds of
          a report arriving — the button below starts it right now and shows the numbers.
        </p>
        <div>
          <Button disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Triage running…' : 'Run feedback triage'}
          </Button>
        </div>
        {run.error !== null && <Problem error={run.error} />}
      </Card>

      {report !== undefined && (
        <Card className="flex flex-col gap-3">
          <CardTitle>Result of the last pass</CardTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Reports read" value={report.scanned} />
            <Stat label="Bugs" value={report.bugs} hint="issues opened" />
            <Stat
              label="Change requests"
              value={report.changeRequests}
              hint="Discord threads opened"
            />
            <Stat label="Duplicates" value={report.duplicates} hint="appended to existing ones" />
          </div>

          {report.failures.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text">Unprocessed reports</span>
                <Badge tone="danger">{report.failures.length}</Badge>
              </div>
              <ul className="flex flex-col gap-1">
                {report.failures.map((failure) => (
                  <li
                    key={failure.file}
                    className="rounded-lg border border-border bg-elevated p-2 text-sm"
                  >
                    <div className="font-mono text-xs text-muted">{failure.file}</div>
                    <div className="text-text">{failure.error}</div>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
