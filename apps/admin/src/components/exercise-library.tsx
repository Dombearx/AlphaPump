/**
 * Ćwiczenia w panelu — przegląd, edycja, scalanie, usuwanie i przywracanie.
 *
 * Tabela pokazuje przy każdym wierszu **co na nim wisi**: serie, ile osób je
 * zapisało, cele cyklu i to, czy ćwiczenie ma policzony wektor. Te liczby nie są
 * ozdobą — to one decydują, czy przycisk „Usuń" w ogóle ma prawo zadziałać, więc
 * stoją obok niego, a nie na osobnym ekranie.
 *
 * Wiersz rozwija się w panel z **podobnymi ćwiczeniami**, liczonymi tym samym
 * wyszukiwaniem hybrydowym, które w aplikacji ostrzega przed duplikatem przy
 * tworzeniu ćwiczenia. Stamtąd idzie scalenie — jednym kliknięciem w kandydata
 * albo wyborem z listy, gdy wyszukiwanie nie trafiło.
 *
 * Kierunek scalania jest zawsze ten sam i jest wypisany wprost: **ten wiersz
 * znika, tamten zostaje**. Pomyłka w tę stronę jest jedyną, której nie da się
 * cofnąć jednym kliknięciem, więc nie ma tu miejsca na domysł.
 */

import type { DuplicateCandidate, LibraryExercise } from '@alphapump/core';
import { useQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { LOGGING_TYPE_LABELS } from './exercise-form';
import { Badge, Button, Cell, Empty, Loading, Row, Select, Table } from './ui';
import { listSimilarExercises } from '../lib/api';
import { exerciseDeletionProblem, exerciseMergeTargets, usageSummary } from '../lib/library-view';

export interface ExerciseLibraryProps {
  rows: readonly LibraryExercise[];
  /** Wszystkie ćwiczenia, także odfiltrowane — cel scalenia bywa poza filtrem. */
  all: readonly LibraryExercise[];
  tagNames: Map<string, string>;
  busy: boolean;
  onEdit: (entry: LibraryExercise) => void;
  onDelete: (entry: LibraryExercise) => void;
  onRestore: (entry: LibraryExercise) => void;
  onMerge: (source: LibraryExercise, targetId: string) => void;
}

export function ExerciseLibrary({
  rows,
  all,
  tagNames,
  busy,
  onEdit,
  onDelete,
  onRestore,
  onMerge,
}: ExerciseLibraryProps) {
  /** Identyfikator wiersza z rozwiniętym panelem duplikatów; `null` — żaden. */
  const [opened, setOpened] = useState<string | null>(null);

  if (rows.length === 0) return <Empty>Nic nie pasuje do filtrów.</Empty>;

  return (
    <Table head={['Nazwa', 'Autor', 'Typ logowania', 'Tagi', 'Użycie', '']}>
      {rows.map((entry) => {
        const { exercise } = entry;
        const deleted = exercise.deletedAt !== null;
        const problem = exerciseDeletionProblem(entry);
        const summary = usageSummary(entry.usage);

        return (
          <Fragment key={exercise.id}>
            <Row>
              <Cell>
                <span className={deleted ? 'font-medium text-muted line-through' : 'font-medium'}>
                  {exercise.name}
                </span>
                {exercise.gym !== null && (
                  <span className="block text-xs text-muted">{exercise.gym}</span>
                )}
                {deleted && (
                  <Badge tone="danger" className="mt-1">
                    usunięte
                  </Badge>
                )}
              </Cell>

              <Cell>
                <span className="text-xs text-muted">{entry.authorNickname}</span>
                {entry.builtIn && (
                  <Badge tone="accent" className="ml-2">
                    wbudowane
                  </Badge>
                )}
              </Cell>

              <Cell>
                <span className="text-xs text-muted">
                  {LOGGING_TYPE_LABELS[exercise.loggingType]}
                </span>
              </Cell>

              <Cell>
                <div className="flex flex-wrap gap-1">
                  <Badge tone="accent">{tagNames.get(exercise.primaryTagId) ?? '—'}</Badge>
                  {exercise.additionalTagIds.map((id) => (
                    <Badge key={id}>{tagNames.get(id) ?? '—'}</Badge>
                  ))}
                </div>
              </Cell>

              <Cell className="text-xs text-muted">
                {summary.length === 0 ? '—' : summary}
                {entry.usage.lastPerformedOn !== null && (
                  <span className="block">ostatnio {entry.usage.lastPerformedOn}</span>
                )}
                {!entry.hasEmbedding && <span className="block">bez wektora</span>}
              </Cell>

              <Cell>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setOpened(opened === exercise.id ? null : exercise.id);
                    }}
                  >
                    {opened === exercise.id ? 'Zwiń' : 'Podobne'}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onEdit(entry);
                    }}
                  >
                    Zmień
                  </Button>
                  {deleted ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => {
                        onRestore(entry);
                      }}
                    >
                      Przywróć
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      variant="danger"
                      // Serwer i tak odmówi — przycisk, który zawsze kończy się
                      // błędem, jest gorszy niż nieaktywny z wyjaśnieniem.
                      disabled={busy || problem !== null}
                      title={problem ?? ''}
                      onClick={() => {
                        onDelete(entry);
                      }}
                    >
                      Usuń
                    </Button>
                  )}
                </div>

                {problem !== null && !deleted && (
                  <p className="mt-1 text-right text-xs text-muted">{problem}</p>
                )}
              </Cell>
            </Row>

            {opened === exercise.id && (
              <MergePanel
                entry={entry}
                targets={exerciseMergeTargets(all, entry)}
                busy={busy}
                onMerge={onMerge}
              />
            )}
          </Fragment>
        );
      })}
    </Table>
  );
}

/**
 * Panel duplikatów jednego ćwiczenia.
 *
 * Zapytanie leci dopiero po rozwinięciu wiersza i nie ma powodu, żeby jechało
 * wcześniej: warstwa semantyczna woła dostawcę modeli, a biblioteka ma setki
 * wierszy — odpytanie ich wszystkich przy wejściu na ekran byłoby setkami
 * wywołań na dane, których nikt nie czyta.
 */
function MergePanel({
  entry,
  targets,
  busy,
  onMerge,
}: {
  entry: LibraryExercise;
  targets: readonly LibraryExercise[];
  busy: boolean;
  onMerge: (source: LibraryExercise, targetId: string) => void;
}) {
  const [manualTarget, setManualTarget] = useState('');
  const similar = useQuery({
    queryKey: ['similar', entry.exercise.id],
    queryFn: () => listSimilarExercises(entry.exercise.id),
  });

  // Kandydat o innym typie logowania jest pokazywany, ale bez przycisku:
  // dalej znaczy „to samo stoi w bazie drugi raz", a scalić się go nie da.
  const mergeable = new Set(targets.map((target) => target.exercise.id));
  const candidates = similar.data?.candidates ?? [];

  return (
    <tr className="bg-elevated">
      <td colSpan={6} className="px-3 py-3">
        <div className="flex flex-col gap-3">
          <p className="text-xs text-muted">
            Scalenie przenosi <strong>wszystkie</strong> serie i cele cyklu z „{entry.exercise.name}
            " na wybrane ćwiczenie, a to znika z biblioteki. Serie zostają przy swoich
            właścicielach.
          </p>

          {similar.isPending && <Loading label="Szukanie podobnych…" />}
          {similar.error !== null && (
            <p className="text-xs text-danger">Nie udało się policzyć podobnych ćwiczeń.</p>
          )}

          {similar.data !== undefined && (
            <>
              <p className="text-xs text-muted">
                Warstwa wyszukiwania: {LAYER_LABELS[similar.data.layer]}
                {similar.data.layer === 'lexical' &&
                  ' — warstwa semantyczna jest wyłączona albo ćwiczenia nie mają policzonych wektorów.'}
              </p>

              {candidates.length === 0 ? (
                <Empty>Nic podobnego w bibliotece.</Empty>
              ) : (
                <ul className="flex flex-col gap-2">
                  {candidates.map((candidate) => (
                    <Candidate
                      key={candidate.exerciseId}
                      candidate={candidate}
                      mergeable={mergeable.has(candidate.exerciseId)}
                      busy={busy}
                      onMerge={() => {
                        onMerge(entry, candidate.exerciseId);
                      }}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Select
              className="max-w-md"
              value={manualTarget}
              onChange={(event) => {
                setManualTarget(event.target.value);
              }}
            >
              <option value="">— wybierz ćwiczenie docelowe —</option>
              {targets.map((target) => (
                <option key={target.exercise.id} value={target.exercise.id}>
                  {target.exercise.name} ({target.authorNickname}, {target.usage.sets} serii)
                </option>
              ))}
            </Select>
            <Button
              size="sm"
              disabled={busy || manualTarget.length === 0}
              onClick={() => {
                onMerge(entry, manualTarget);
              }}
            >
              Scal i usuń „{entry.exercise.name}"
            </Button>
          </div>
          <p className="text-xs text-muted">
            Lista zawiera wyłącznie ćwiczenia o tym samym typie logowania — serie są walidowane
            względem typu ćwiczenia, więc przeniesione pod inny nie pasowałyby do niego.
          </p>
        </div>
      </td>
    </tr>
  );
}

const LAYER_LABELS: Record<string, string> = {
  lexical: 'leksykalna (pisownia)',
  hybrid: 'hybrydowa (pisownia + embeddingi)',
  llm: 'hybrydowa z oceną modelu',
};

function Candidate({
  candidate,
  mergeable,
  busy,
  onMerge,
}: {
  candidate: DuplicateCandidate;
  /** Ten sam typ logowania, więc scalenie ma sens; inaczej sam sygnał. */
  mergeable: boolean;
  busy: boolean;
  onMerge: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-surface p-2">
      <span className="font-medium text-text">{candidate.name}</span>
      <span className="text-xs text-muted">
        {candidate.authorNickname} · {candidate.primaryTagName}
      </span>
      {candidate.identical && <Badge tone="danger">identyczna nazwa</Badge>}
      {candidate.duplicate === true && <Badge tone="danger">model: to samo</Badge>}
      {candidate.duplicate === false && <Badge tone="success">model: co innego</Badge>}
      {candidate.reason !== null && (
        <span className="basis-full text-xs text-muted">{candidate.reason}</span>
      )}
      {mergeable ? (
        <Button size="sm" variant="secondary" className="ml-auto" disabled={busy} onClick={onMerge}>
          Scal w to
        </Button>
      ) : (
        <span className="ml-auto text-xs text-muted">inny typ logowania</span>
      )}
    </li>
  );
}
