/**
 * Biblioteka: ćwiczenia i tagi.
 *
 * Panel korzysta tu z **tych samych** endpointów, co aplikacja — `POST`, `PATCH`
 * i `DELETE` na `/exercises` i `/tags`. Administrator ma na nich szersze
 * uprawnienia (może zmieniać cudze ćwiczenia), ale nie osobną ścieżkę zapisu.
 * Osobna oznaczałaby drugie miejsce, w którym trzeba pamiętać o tombstonie,
 * `server_seq` i o regule „tag używany przez ćwiczenia nie znika".
 *
 * Widoczne są tu dwie reguły domenowe, których panel nie obchodzi i nie próbuje:
 * usunięcie jest **miękkie** (serie nie tracą tego, na co wskazują), a typ
 * logowania jest nieedytowalny — kto chce inny, tworzy nowe ćwiczenie.
 *
 * Reguły samego formularza (co jest poprawne, co właściwie zmieniono) siedzą
 * w `lib/exercise-draft.ts` i są przetestowane bez renderowania.
 */

import type { Exercise, Tag } from '@alphapump/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ExerciseForm, LOGGING_TYPE_LABELS } from '../components/exercise-form';
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
  createExercise,
  createTag,
  deleteExercise,
  deleteTag,
  listExercises,
  listTags,
  renameTag,
  updateExercise,
} from '../lib/api';
import { exerciseInput, exercisePatch, type ExerciseDraft } from '../lib/exercise-draft';

/** Który formularz ćwiczenia jest otwarty; `null` — żaden. */
type ExerciseFormState = { mode: 'create' } | { mode: 'edit'; exercise: Exercise } | null;

export function LibraryPage() {
  const queryClient = useQueryClient();
  const exercises = useQuery({ queryKey: ['exercises'], queryFn: () => listExercises() });
  const tags = useQuery({ queryKey: ['tags'], queryFn: () => listTags() });

  const [filter, setFilter] = useState('');
  const [form, setForm] = useState<ExerciseFormState>(null);
  const [editingTag, setEditingTag] = useState<{ id: string; name: string } | null>(null);
  const [newTag, setNewTag] = useState('');

  const refresh = () => {
    setForm(null);
    setEditingTag(null);
    setNewTag('');
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

  const submitExercise = (draft: ExerciseDraft) => {
    if (form === null) return;
    if (form.mode === 'create') {
      mutate.mutate(() => createExercise(exerciseInput(draft)));
      return;
    }
    mutate.mutate(() => updateExercise(form.exercise.id, exercisePatch(draft, form.exercise)));
  };

  return (
    <div className="flex flex-col gap-6">
      {mutate.error !== null && <Problem error={mutate.error} />}

      <Card className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <CardTitle>Ćwiczenia ({visible.length})</CardTitle>
          <Button
            size="sm"
            variant={form?.mode === 'create' ? 'secondary' : 'primary'}
            // Bez tagów nie da się utworzyć ćwiczenia: tag główny jest wymagany.
            // Przycisk, który otwiera formularz nie do wysłania, jest gorszy
            // niż nieaktywny z wyjaśnieniem.
            disabled={tags.data.length === 0}
            title={tags.data.length === 0 ? 'Najpierw dodaj choć jeden tag' : ''}
            onClick={() => {
              setForm(form?.mode === 'create' ? null : { mode: 'create' });
            }}
          >
            Dodaj ćwiczenie
          </Button>
        </div>

        {form !== null && (
          <ExerciseForm
            // Przemontowanie przy zmianie celu: formularz trzyma stan pól
            // wewnątrz, więc bez tego edycja drugiego ćwiczenia pokazałaby
            // wartości pierwszego.
            key={form.mode === 'create' ? 'nowe' : form.exercise.id}
            tags={tags.data}
            editing={form.mode === 'edit' ? form.exercise : null}
            busy={mutate.isPending}
            onCancel={() => {
              setForm(null);
            }}
            onSubmit={submitExercise}
          />
        )}

        <Input
          placeholder="Filtruj po nazwie albo tagu głównym"
          value={filter}
          onChange={(event) => {
            setFilter(event.target.value);
          }}
        />

        {visible.length === 0 ? (
          <Empty>
            {(exercises.data ?? []).length === 0
              ? 'Biblioteka jest pusta.'
              : 'Nic nie pasuje do filtra.'}
          </Empty>
        ) : (
          <Table head={['Nazwa', 'Typ logowania', 'Tag główny', 'Tagi dodatkowe', '']}>
            {visible.map((exercise: Exercise) => (
              <Row key={exercise.id}>
                <Cell>
                  <span className="font-medium">{exercise.name}</span>
                  {exercise.gym !== null && (
                    <span className="block text-xs text-muted">{exercise.gym}</span>
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
                  <div className="flex flex-wrap gap-1">
                    {exercise.additionalTagIds.length === 0 ? (
                      <span className="text-xs text-muted">—</span>
                    ) : (
                      exercise.additionalTagIds.map((id) => (
                        <Badge key={id}>{tagNames.get(id) ?? '—'}</Badge>
                      ))
                    )}
                  </div>
                </Cell>
                <Cell>
                  <div className="flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setForm({ mode: 'edit', exercise });
                      }}
                    >
                      Zmień
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={mutate.isPending}
                      onClick={() => {
                        mutate.mutate(() => deleteExercise(exercise.id));
                      }}
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

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newTag.trim();
            if (name.length > 0) mutate.mutate(() => createTag(name));
          }}
        >
          <Input
            placeholder="Nazwa nowego tagu"
            value={newTag}
            maxLength={80}
            onChange={(event) => {
              setNewTag(event.target.value);
            }}
          />
          <Button type="submit" size="sm" disabled={mutate.isPending || newTag.trim().length === 0}>
            Dodaj tag
          </Button>
        </form>

        {tags.data.length === 0 ? (
          <Empty>Nie ma jeszcze żadnego tagu.</Empty>
        ) : (
          <Table head={['Nazwa', 'Kolor', 'Ćwiczenia', '']}>
            {tags.data.map((tag: Tag) => {
              const usedBy = (exercises.data ?? []).filter(
                (exercise) =>
                  exercise.primaryTagId === tag.id || exercise.additionalTagIds.includes(tag.id),
              ).length;

              return (
                <Row key={tag.id}>
                  <Cell>
                    {editingTag?.id === tag.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editingTag.name}
                          autoFocus
                          maxLength={80}
                          onChange={(event) => {
                            setEditingTag({ id: tag.id, name: event.target.value });
                          }}
                        />
                        <Button
                          size="sm"
                          disabled={mutate.isPending || editingTag.name.trim().length === 0}
                          onClick={() => {
                            mutate.mutate(() => renameTag(tag.id, editingTag.name.trim()));
                          }}
                        >
                          Zapisz
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setEditingTag(null);
                          }}
                        >
                          Anuluj
                        </Button>
                      </div>
                    ) : (
                      <span className="font-medium">{tag.name}</span>
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
                        onClick={() => {
                          setEditingTag({ id: tag.id, name: tag.name });
                        }}
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
                        onClick={() => {
                          mutate.mutate(() => deleteTag(tag.id));
                        }}
                      >
                        Usuń
                      </Button>
                    </div>
                  </Cell>
                </Row>
              );
            })}
          </Table>
        )}
        <p className="text-xs text-muted">
          Kolor wynika z nazwy i nie da się go ustawić ręcznie — dzięki temu tag utworzony offline
          ma od razu finalny kolor, identyczny na każdym urządzeniu. Zmiana nazwy przelicza kolor.
        </p>
      </Card>
    </div>
  );
}
