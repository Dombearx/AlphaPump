/**
 * Konflikty w bazie — ekran do ręcznego rozstrzygania.
 *
 * ## Skąd się to wzięło
 *
 * Schematy z rdzenia opisują wiersz poprawny, a walidacja stoi przy zapisie —
 * ale baza pamięta więcej niż dzisiejsze reguły. Wiersz sprzed reguły, wiersz
 * poprawiony ręcznie w psql, wiersz zostawiony przez ścieżkę zapisu, której
 * błąd zobaczyliśmy dopiero z produkcji: każdy z nich ma prawo w tej bazie
 * leżeć. A ponieważ ćwiczenia i tagi są globalne, jeden taki wiersz nie psuł
 * jednego ekranu, tylko wywalał parsowanie **całej** odpowiedzi — panel
 * przestawał się otwierać, a telefony stawały na „Pull response has an unknown
 * shape". Naprawa przyczyny nie ruszała wierszy, które ta przyczyna zdążyła
 * zepsuć, więc błąd wracał po każdej poprawce.
 *
 * ## Co ten ekran robi inaczej
 *
 * Odczyt takie wiersze teraz obchodzi (patrz `toExerciseDto` w API), więc nic
 * nie stoi — i właśnie dlatego ten ekran musi istnieć. Zamaskowany konflikt bez
 * miejsca, w którym widać, że jest, to konflikt, o którym nikt się nie dowie aż
 * do następnej awarii. Tutaj jest wypisany wprost: który wiersz, co jest nie
 * tak i co dokładnie zrobi naprawa.
 *
 * ## Dlaczego naprawa jest kliknięciem, a nie automatem
 *
 * Część tych napraw **zdejmuje dane**: powtórzony tag dodatkowy, tłumaczenie
 * poza formatem. Automat robiłby to po cichu w czyjejś bibliotece i nikt nie
 * zobaczyłby ani co zniknęło, ani dlaczego. Dlatego przegląd sam z siebie
 * niczego nie zmienia, każda naprawa mówi wcześniej, co zrobi, a tam, gdzie
 * rozstrzygnięcia nie da się zgadnąć — przy nazwie, którą wpisał człowiek —
 * przycisku nie ma w ogóle i wiersz trzeba poprawić w bibliotece.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import type { IntegrityIssue } from '@alphapump/core';
import { Badge, Button, Card, CardTitle, Empty, Loading, Problem } from '../components/ui';
import { getIntegrityReport, repairIntegrityIssues } from '../lib/api';

/**
 * „Widać na ekranie" kontra „baza jest krzywa, ale odczyt to obchodzi".
 *
 * To jest jedyny podział, który zmienia kolejność działania administratora,
 * więc jest jedynym, który dostaje odznakę.
 */
function tone(issue: IntegrityIssue): { label: string; tone: 'danger' | 'neutral' } {
  return issue.maskedOnRead
    ? { label: 'w bazie', tone: 'neutral' }
    : { label: 'widoczne w aplikacji', tone: 'danger' };
}

const ENTITY_LABEL: Record<IntegrityIssue['entity'], string> = {
  exercise: 'Ćwiczenie',
  tag: 'Tag',
};

export function IntegrityPage() {
  const queryClient = useQueryClient();
  const report = useQuery({ queryKey: ['integrity'], queryFn: () => getIntegrityReport() });
  const [note, setNote] = useState<string | null>(null);

  const repair = useMutation({
    mutationFn: (ids: readonly string[]) => repairIntegrityIssues(ids),
    onSuccess: (result) => {
      // Odpowiedź niesie stan **po** naprawie, więc lista odświeża się z niej,
      // a nie kolejnym żądaniem — inaczej ekran przez moment pokazywałby
      // zgłoszenia, których już nie ma.
      queryClient.setQueryData(['integrity'], {
        checkedAt: result.checkedAt,
        issues: result.issues,
      });
      // Naprawa rusza ćwiczenia i tagi, więc biblioteka i liczby systemowe
      // przestały być aktualne.
      void queryClient.invalidateQueries({ queryKey: ['library-exercises'] });
      void queryClient.invalidateQueries({ queryKey: ['library-tags'] });
      void queryClient.invalidateQueries({ queryKey: ['stats'] });

      const skipped =
        result.skipped.length > 0
          ? ` ${String(result.skipped.length)} pominięto — tych konfliktów już nie było.`
          : '';
      setNote(`Naprawiono: ${String(result.repaired.length)}.${skipped}`);
    },
    onError: () => {
      setNote(null);
    },
  });

  if (report.isPending) return <Loading label="Przeglądam bazę…" />;
  if (report.error) return <Problem error={report.error} />;

  const issues = report.data.issues;
  const repairable = issues.filter((issue) => issue.repair !== null);
  const visible = issues.filter((issue) => !issue.maskedOnRead).length;

  return (
    <div className="flex flex-col gap-6">
      {repair.error !== null && <Problem error={repair.error} />}
      {note !== null && (
        <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
          {note}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Konflikty w danych ({issues.length}, w tym {visible} widocznych w aplikacji)
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={report.isFetching}
              onClick={() => void report.refetch()}
            >
              Przejrzyj ponownie
            </Button>
            <Button
              size="sm"
              disabled={repairable.length === 0 || repair.isPending}
              title="Wykonuje wszystkie naprawy opisane niżej — po jednej na zgłoszenie"
              onClick={() => {
                repair.mutate(repairable.map((issue) => issue.id));
              }}
            >
              Napraw wszystkie ({repairable.length})
            </Button>
          </div>
        </div>

        <p className="text-sm text-muted">
          Wiersze, których nie przyjmuje schemat aplikacji albo które wskazują na coś, czego już nie
          ma. Odczyt większość z nich obchodzi — dlatego aplikacja działa — ale w bazie zostają i
          wracają przy kolejnym zapisie tego wiersza. Naprawa jest tu ręczna z rozmysłem: część z
          nich zdejmuje dane, więc decyzja należy do człowieka.
        </p>

        {issues.length === 0 ? (
          <Empty>
            Nic do rozstrzygnięcia — przegląd o{' '}
            {new Date(report.data.checkedAt).toLocaleTimeString()} nie znalazł żadnego konfliktu.
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {issues.map((issue) => {
              const badge = tone(issue);
              return (
                <li
                  key={issue.id}
                  className="flex flex-col gap-2 rounded-lg border border-border bg-elevated p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-text">
                      {ENTITY_LABEL[issue.entity]}: {issue.entityName}
                    </span>
                    <Badge tone={badge.tone}>{badge.label}</Badge>
                    {issue.entityDeleted && <Badge>usunięte</Badge>}
                    <code className="text-xs text-muted">{issue.kind}</code>
                  </div>

                  <p className="text-sm text-muted">{issue.detail}</p>

                  <div className="flex flex-wrap items-center gap-3">
                    {issue.repair === null ? (
                      <p className="text-sm text-muted">
                        Automatu tu nie ma — poprawa idzie z ekranu{' '}
                        <Link to="/library" className="text-text underline">
                          Biblioteka
                        </Link>
                        , bo tylko człowiek wie, co ten wiersz miał znaczyć.
                      </p>
                    ) : (
                      <>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={repair.isPending}
                          onClick={() => {
                            repair.mutate([issue.id]);
                          }}
                        >
                          Napraw
                        </Button>
                        <span className="text-sm text-muted">{issue.repair}</span>
                      </>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}
