/**
 * Ręczny przegląd zgłoszeń zwrotnych.
 *
 * Usługa `services/triage` sama przegląda zgłoszenia raz na dobę — ten ekran
 * daje ten sam przebieg na żądanie: sprawdzenie nowych zgłoszeń, klasyfikacja,
 * założenie issue na GitHubie albo otwarcie dyskusji na Discordzie. Wynik jest
 * podsumowaniem liczb, nie listą zgłoszeń — treść i tak trafia na Discorda
 * i do GitHuba, więc drugie miejsce do jej czytania tylko by się rozjeżdżało.
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
        <CardTitle>Przegląd zgłoszeń</CardTitle>
        <p className="text-sm text-muted">
          Sprawdza nowe zgłoszenia zwrotne z aplikacji, klasyfikuje je i albo zakłada issue na
          GitHubie (błąd), albo otwiera dyskusję na Discordzie (prośba o zmianę). Ten sam przebieg
          dzieje się też codziennie o umówionej godzinie — przycisk niżej uruchamia go od razu.
        </p>
        <div>
          <Button disabled={run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? 'Przegląd w toku…' : 'Uruchom przegląd zgłoszeń'}
          </Button>
        </div>
        {run.error !== null && <Problem error={run.error} />}
      </Card>

      {report !== undefined && (
        <Card className="flex flex-col gap-3">
          <CardTitle>Wynik ostatniego przebiegu</CardTitle>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Sprawdzone zgłoszenia" value={report.scanned} />
            <Stat label="Błędy" value={report.bugs} hint="założone issue" />
            <Stat
              label="Prośby o zmianę"
              value={report.changeRequests}
              hint="otwarte wątki na Discordzie"
            />
            <Stat label="Duplikaty" value={report.duplicates} hint="dopisane do istniejących" />
          </div>

          {report.failures.length > 0 && (
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-text">Nieprzetworzone zgłoszenia</span>
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
