/**
 * Biblioteka: ćwiczenia i tagi.
 *
 * Panel korzysta tu z **tych samych** endpointów, co aplikacja — `PATCH` i
 * `DELETE /exercises/:id` oraz `/tags/:id`. Administrator ma na nich szersze
 * uprawnienia (może zmieniać cudze ćwiczenia), ale nie osobną ścieżkę zapisu.
 * Osobna oznaczałaby drugie miejsce, w którym trzeba pamiętać o tombstonie,
 * `server_seq` i o regule „tag używany przez ćwiczenia nie znika".
 *
 * Widoczne są tu dwie reguły domenowe, których panel nie obchodzi i nie próbuje:
 * usunięcie jest **miękkie** (serie nie tracą tego, na co wskazują), a typ
 * logowania jest nieedytowalny — kto chce inny, tworzy nowe ćwiczenie.
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Exercise, Tag } from '@alphapump/core';
import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardTitle,
  Cell,
  Empty,
  Input,
  Loading,
  Problem,
  Row,
  Table,
} from '../components/ui';
import {
  deleteExercise,
  deleteTag,
  listExercises,
  listTags,
  renameExercise,
  renameTag,
} from '../lib/api';

const LOGGING_TYPE_LABELS: Record<Exercise['loggingType'], string> = {
  weight_reps: 'ciężar + powtórzenia',
  weight_time: 'ciężar + czas',
  bodyweight_reps: 'masa ciała + powtórzenia',
  bodyweight_time: 'masa ciała + czas',
  distance_time: 'dystans + czas',
};

export function LibraryPage() {
  const queryClient = useQueryClient();
  const exercises = useQuery({ queryKey: ['exercises'], queryFn: () => listExercises() });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => listTags() });
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<{
    kind: 'exercise' | 'tag';
    id: string;
    name: string;
  } | null>(null);

  const refresh = () => {
    setEditing(null);
    void queryClient.invalidateQueries({ queryKey: ['exercises'] });
    void queryClient.invalidateQueries({ queryKey: ['tags'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const mutate = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: refresh,
  });

  const tagNames = useMemo(
    () => new Map((tags.data ?? []).map((tag) => [tag.id, tag.name])),
    [tags.data],
  );

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const rows = exercises.data ?? [];
    if (needle.length === 0) return rows;
    return rows.filter(
      (exercise) =>
        exercise.name.toLowerCase().includes(needle) ||
        (tagNames.get(exercise.primaryTagId) ?? '').toLowerCase().includes(needle),
    );
  }, [exercises.data, filter, tagNames]);

  if (exercises.isPending || tags.isPending) return <Loading label="Wczytywanie biblioteki…" />;
  if (exercises.error) return <Problem error={exercises.error} />;
  if (tags.error) return <Problem error={tags.error} />;

  const nameEditor = (kind: 'exercise' | 'tag', id: string, name: string, save: () => void) =>
    editing?.kind === kind && editing.id === id ? (
      <div className="flex items-center gap-2">
        <Input
          value={editing.name}
          autoFocus
          onChange={(event) => setEditing({ kind, id, name: event.target.value })}
        />
        <Button
          size="sm"
          disabled={mutate.isPending || editing.name.trim().length === 0}
          onClick={save}
        >
          Zapisz
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
          Anuluj
        </Button>
      </div>
    ) : (
      <span className="font-medium">{name}</span>
    );

  return (
    <div className="flex flex-col gap-6">
      {mutate.error !== null && <Problem error={mutate.error} />}

      <Card className="flex flex-col gap-3">
        <CardTitle>Ćwiczenia ({visible.length})</CardTitle>
        <Input
          placeholder="Filtruj po nazwie albo tagu głównym"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />

        {visible.length === 0 ? (
          <Empty>Nic nie pasuje do filtra.</Empty>
        ) : (
          <Table head={['Nazwa', 'Typ logowania', 'Tag główny', '']}>
            {visible.map((exercise: Exercise) => (
              <Row key={exercise.id}>
                <Cell>
                  {nameEditor('exercise', exercise.id, exercise.name, () =>
                    mutate.mutate(() => renameExercise(exercise.id, editing?.name.trim() ?? '')),
                  )}
                </Cell>
                <Cell>
                  <span className="text-xs text-muted">
                    {LOGGING_TYPE_LABELS[exercise.loggingType]}
                  </span>
                </Cell>
                <Cell>
                  <Badge>{tagNames.get(exercise.primaryTagId) ?? '—'}</Badge>
                </Cell>
                <Cell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        setEditing({ kind: 'exercise', id: exercise.id, name: exercise.name })
                      }
                    >
                      Zmień nazwę
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={mutate.isPending}
                      onClick={() => mutate.mutate(() => deleteExercise(exercise.id))}
                    >
                      Usuń
                    </Button>
                  </div>
                </Cell>
              </Row>
            ))}
          </Table>
        )}
        <p className="text-xs text-muted">
          Usunięcie jest miękkie: wiersz zostaje z tombstonem, więc zapisane serie nie tracą tego,
          na co wskazują. Typ logowania jest nieedytowalny — jego zmiana unieważniłaby historyczne
          serie.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Tagi ({tags.data.length})</CardTitle>
        <Table head={['Nazwa', 'Kolor', 'Ćwiczenia', '']}>
          {tags.data.map((tag: Tag) => {
            const usedBy = (exercises.data ?? []).filter(
              (exercise) =>
                exercise.primaryTagId === tag.id || exercise.additionalTagIds.includes(tag.id),
            ).length;

            return (
              <Row key={tag.id}>
                <Cell>
                  {nameEditor('tag', tag.id, tag.name, () =>
                    mutate.mutate(() => renameTag(tag.id, editing?.name.trim() ?? '')),
                  )}
                </Cell>
                <Cell>
                  <span className="flex items-center gap-2 text-xs text-muted">
                    <span
                      className="inline-block size-4 rounded-full border border-border"
                      style={{ backgroundColor: tag.color }}
                    />
                    {tag.color}
                  </span>
                </Cell>
                <Cell className="tabular-nums">{usedBy}</Cell>
                <Cell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setEditing({ kind: 'tag', id: tag.id, name: tag.name })}
                    >
                      Zmień nazwę
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      // Serwer i tak odmówi, ale przycisk, który zawsze kończy się
                      // błędem, jest gorszy niż nieaktywny.
                      disabled={mutate.isPending || usedBy > 0}
                      title={usedBy > 0 ? 'Tag jest używany przez ćwiczenia' : ''}
                      onClick={() => mutate.mutate(() => deleteTag(tag.id))}
                    >
                      Usuń
                    </Button>
                  </div>
                </Cell>
              </Row>
            );
          })}
        </Table>
        <p className="text-xs text-muted">
          Kolor wynika z nazwy i nie da się go ustawić ręcznie — dzięki temu tag utworzony offline
          ma od razu finalny kolor, identyczny na każdym urządzeniu. Zmiana nazwy przelicza kolor.
        </p>
      </Card>
    </div>
  );
}
