/**
 * Biblioteka: ćwiczenia i tagi — z porządkowaniem włącznie.
 *
 * Ekran ma dwie warstwy i obie są potrzebne z innego powodu.
 *
 * **Zwykły CRUD** idzie tymi samymi endpointami, co aplikacja: `POST`, `PATCH`
 * i `DELETE` na `/exercises` i `/tags`. Administrator ma na nich szersze
 * uprawnienia, ale nie osobną ścieżkę zapisu — osobna byłaby drugim miejscem,
 * w którym trzeba pamiętać o tombstonie i `server_seq`.
 *
 * **Porządkowanie** — widok użycia, scalanie, przywracanie i przeliczanie
 * wektorów — idzie przez `/admin/library/*`, bo to nie są operacje na jednym
 * wierszu i w CRUD-zie nie mają jak istnieć.
 *
 * Reguła, wokół której stoi cały ten ekran: **nic z zalogowanego nie ginie**.
 * Ćwiczenia z seriami i tagu, na którym coś wisi, nie da się usunąć — ani stąd,
 * ani z telefonu. Duplikat znika przez scalenie, czyli operację, która najpierw
 * przenosi, a dopiero potem kasuje. Dlatego przy każdym wierszu widać, co na nim
 * wisi, a przycisk „Usuń" jest wygaszony razem z powodem.
 */

import type { LibraryExercise } from '@alphapump/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { ExerciseForm } from '../components/exercise-form';
import { ExerciseLibrary } from '../components/exercise-library';
import { TagLibrary } from '../components/tag-library';
import { Button, Card, CardTitle, Empty, Input, Loading, Problem, Select } from '../components/ui';
import {
  createExercise,
  createTag,
  deleteExercise,
  deleteTag,
  listLibraryExercises,
  listLibraryTags,
  mergeExercises,
  mergeTags,
  refreshEmbeddings,
  renameTag,
  restoreExercise,
  restoreTag,
  updateExercise,
} from '../lib/api';
import { exerciseInput, exercisePatch, type ExerciseDraft } from '../lib/exercise-draft';
import {
  EMPTY_FILTER,
  filterExercises,
  type AuthorFilter,
  type StatusFilter,
} from '../lib/library-view';

/** Który formularz ćwiczenia jest otwarty; `null` — żaden. */
type ExerciseFormState = { mode: 'create' } | { mode: 'edit'; entry: LibraryExercise } | null;

export function LibraryPage() {
  const queryClient = useQueryClient();
  const exercises = useQuery({
    queryKey: ['library-exercises'],
    // Wiersze z tombstonem jadą zawsze — inaczej „Przywróć" nie miałoby czego
    // pokazać, a filtr stanu byłby wyborem między dwoma zapytaniami.
    queryFn: () => listLibraryExercises({ includeDeleted: true }),
  });
  const tags = useQuery({
    queryKey: ['library-tags'],
    queryFn: () => listLibraryTags({ includeDeleted: true }),
  });

  const [filter, setFilter] = useState(EMPTY_FILTER);
  const [form, setForm] = useState<ExerciseFormState>(null);
  const [newTag, setNewTag] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const refresh = () => {
    setForm(null);
    setNewTag('');
    void queryClient.invalidateQueries({ queryKey: ['library-exercises'] });
    void queryClient.invalidateQueries({ queryKey: ['library-tags'] });
    void queryClient.invalidateQueries({ queryKey: ['similar'] });
    void queryClient.invalidateQueries({ queryKey: ['stats'] });
  };

  const mutate = useMutation({
    mutationFn: (action: () => Promise<string | void>) => Promise.resolve(action()),
    onSuccess: (message) => {
      setNote(typeof message === 'string' ? message : null);
      refresh();
    },
    onError: () => {
      setNote(null);
    },
  });

  const liveTags = useMemo(
    () => (tags.data ?? []).filter((entry) => entry.tag.deletedAt === null).map((e) => e.tag),
    [tags.data],
  );
  const tagNames = useMemo(
    () => new Map((tags.data ?? []).map((entry) => [entry.tag.id, entry.tag.name])),
    [tags.data],
  );

  const visible = useMemo(
    () => filterExercises(exercises.data ?? [], filter),
    [exercises.data, filter],
  );

  if (exercises.isPending || tags.isPending) return <Loading label="Wczytywanie biblioteki…" />;
  if (exercises.error) return <Problem error={exercises.error} />;
  if (tags.error) return <Problem error={tags.error} />;

  const submitExercise = (draft: ExerciseDraft) => {
    if (form === null) return;
    if (form.mode === 'create') {
      mutate.mutate(async () => {
        await createExercise(exerciseInput(draft));
      });
      return;
    }
    const { exercise } = form.entry;
    mutate.mutate(async () => {
      await updateExercise(exercise.id, exercisePatch(draft, exercise));
    });
  };

  const deletedExercises = (exercises.data ?? []).filter(
    (entry) => entry.exercise.deletedAt !== null,
  ).length;

  return (
    <div className="flex flex-col gap-6">
      {mutate.error !== null && <Problem error={mutate.error} />}
      {note !== null && (
        <p className="rounded-lg border border-success/40 bg-success/10 p-3 text-sm text-success">
          {note}
        </p>
      )}

      <Card className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle>
            Ćwiczenia ({visible.length} z {(exercises.data ?? []).length}, w tym {deletedExercises}{' '}
            usuniętych)
          </CardTitle>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={mutate.isPending}
              title="Liczy brakujące wektory, żeby lista podobnych ćwiczeń widziała całą bibliotekę"
              onClick={() => {
                mutate.mutate(async () => {
                  const report = await refreshEmbeddings();
                  return report.enabled
                    ? `Wektory: ${String(report.written)} policzonych, ${String(report.unchanged)} bez zmian, ${String(report.failed)} nieudanych.`
                    : 'Warstwa semantyczna jest wyłączona — podobne ćwiczenia liczy sama pisownia.';
                });
              }}
            >
              Przelicz wektory
            </Button>
            <Button
              size="sm"
              variant={form?.mode === 'create' ? 'secondary' : 'primary'}
              // Bez tagów nie da się utworzyć ćwiczenia: tag główny jest wymagany.
              disabled={liveTags.length === 0}
              title={liveTags.length === 0 ? 'Najpierw dodaj choć jeden tag' : ''}
              onClick={() => {
                setForm(form?.mode === 'create' ? null : { mode: 'create' });
              }}
            >
              Dodaj ćwiczenie
            </Button>
          </div>
        </div>

        {form !== null && (
          <ExerciseForm
            // Przemontowanie przy zmianie celu: formularz trzyma stan pól
            // wewnątrz, więc bez tego edycja drugiego ćwiczenia pokazałaby
            // wartości pierwszego.
            key={form.mode === 'create' ? 'nowe' : form.entry.exercise.id}
            tags={liveTags}
            editing={form.mode === 'edit' ? form.entry.exercise : null}
            busy={mutate.isPending}
            onCancel={() => {
              setForm(null);
            }}
            onSubmit={submitExercise}
          />
        )}

        <div className="grid gap-2 md:grid-cols-4">
          <Input
            placeholder="Filtruj po nazwie, autorze albo siłowni"
            value={filter.query}
            onChange={(event) => {
              setFilter({ ...filter, query: event.target.value });
            }}
          />
          <Select
            value={filter.author}
            onChange={(event) => {
              setFilter({ ...filter, author: event.target.value as AuthorFilter });
            }}
          >
            <option value="all">Wszyscy autorzy</option>
            <option value="builtIn">Tylko wbudowane</option>
            <option value="user">Tylko dodane przez ludzi</option>
          </Select>
          <Select
            value={filter.status}
            onChange={(event) => {
              setFilter({ ...filter, status: event.target.value as StatusFilter });
            }}
          >
            <option value="live">Tylko żywe</option>
            <option value="deleted">Tylko usunięte</option>
            <option value="all">Żywe i usunięte</option>
          </Select>
          <Select
            value={filter.tagId ?? ''}
            onChange={(event) => {
              setFilter({
                ...filter,
                tagId: event.target.value === '' ? null : event.target.value,
              });
            }}
          >
            <option value="">Wszystkie tagi</option>
            {liveTags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        </div>

        <ExerciseLibrary
          rows={visible}
          all={exercises.data ?? []}
          tagNames={tagNames}
          busy={mutate.isPending}
          onEdit={(entry) => {
            setForm({ mode: 'edit', entry });
          }}
          onDelete={(entry) => {
            mutate.mutate(async () => {
              await deleteExercise(entry.exercise.id);
            });
          }}
          onRestore={(entry) => {
            mutate.mutate(async () => {
              await restoreExercise(entry.exercise.id);
              return `Przywrócono „${entry.exercise.name}".`;
            });
          }}
          onMerge={(source, targetId) => {
            mutate.mutate(async () => {
              const report = await mergeExercises(source.exercise.id, targetId);
              return (
                `Scalono „${source.exercise.name}": przeniesiono ${String(report.movedSets)} serii` +
                `${report.movedDeletedSets > 0 ? ` (i ${String(report.movedDeletedSets)} skasowanych)` : ''}` +
                `${report.movedGoals > 0 ? ` oraz ${String(report.movedGoals)} celów cyklu` : ''}.`
              );
            });
          }}
        />

        <p className="text-xs text-muted">
          Ćwiczenia z zapisanymi seriami nie da się usunąć — jego serie musiałyby zostać w dniach
          jako wpisy bez nazwy. Duplikat scala się z ćwiczeniem docelowym: serie i cele cyklu
          przechodzą razem z nim, a dopiero puste źródło znika. Typ logowania jest nieedytowalny, bo
          jego zmiana unieważniłaby zapisane serie.
        </p>
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Tagi ({(tags.data ?? []).length})</CardTitle>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = newTag.trim();
            if (name.length > 0) {
              mutate.mutate(async () => {
                await createTag(name);
              });
            }
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

        {(tags.data ?? []).length === 0 ? (
          <Empty>Nie ma jeszcze żadnego tagu.</Empty>
        ) : (
          <TagLibrary
            rows={tags.data ?? []}
            busy={mutate.isPending}
            onRename={(entry, name) => {
              mutate.mutate(async () => {
                await renameTag(entry.tag.id, name);
              });
            }}
            onDelete={(entry) => {
              mutate.mutate(async () => {
                await deleteTag(entry.tag.id);
              });
            }}
            onRestore={(entry) => {
              mutate.mutate(async () => {
                await restoreTag(entry.tag.id);
                return `Przywrócono tag „${entry.tag.name}".`;
              });
            }}
            onMerge={(source, targetId) => {
              mutate.mutate(async () => {
                const report = await mergeTags(source.tag.id, targetId);
                return (
                  `Scalono tag „${source.tag.name}": przepięto ${String(report.movedPrimary)} ćwiczeń ` +
                  `jako tag główny i ${String(report.movedAdditional)} jako dodatkowy` +
                  `${report.mergedAdditional > 0 ? `, ${String(report.mergedAdditional)} miało już oba` : ''}.`
                );
              });
            }}
          />
        )}

        <p className="text-xs text-muted">
          Kolor wynika z nazwy i nie da się go ustawić ręcznie — dzięki temu tag utworzony offline
          ma od razu finalny kolor, identyczny na każdym urządzeniu. Zmiana nazwy przelicza kolor.
          Tagu używanego przez ćwiczenia albo cele cyklu nie da się usunąć; scalenie przepina je na
          tag docelowy.
        </p>
      </Card>
    </div>
  );
}
