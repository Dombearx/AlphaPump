/**
 * Formularz ćwiczenia — jeden na dodawanie i na zmianę.
 *
 * Dwa formularze byłyby dwoma miejscami, w których trzeba pamiętać o regułach
 * domeny: że tag główny jest dokładnie jeden, że nie może się powtórzyć wśród
 * dodatkowych i że typ logowania po utworzeniu jest już nieruchomy. Różnica
 * między trybami sprowadza się do dwóch rzeczy — czy typ logowania da się
 * wybrać i co wysyłamy — więc jest parametrem, a nie osobnym komponentem.
 *
 * Formularz nie zna sieci. Oddaje gotowe wejście w kształcie rdzenia
 * (`CreateExerciseInput` / `UpdateExerciseInput`), a wysyłką zajmuje się strona.
 * Dzięki temu reguła „co właściwie zmieniono" jest testowana bez renderowania.
 */

import { LOGGING_TYPES, type Exercise, type Tag } from '@alphapump/core';
import { useState } from 'react';
import { Button, Field, Input, Select, Textarea, ToggleChip } from './ui';
import { exercisePatch, exerciseProblem, type ExerciseDraft } from '../lib/exercise-draft';

export const LOGGING_TYPE_LABELS: Record<Exercise['loggingType'], string> = {
  weight_reps: 'weight + reps',
  weight_time: 'weight + time',
  bodyweight_reps: 'bodyweight + reps',
  bodyweight_time: 'bodyweight + time',
  distance_time: 'distance + time',
};

/** Pusty formularz. Tag główny celuje w pierwszy z listy — jakiś musi być wybrany. */
export function emptyDraft(tags: readonly Tag[]): ExerciseDraft {
  return {
    name: '',
    loggingType: 'weight_reps',
    primaryTagId: tags[0]?.id ?? '',
    additionalTagIds: [],
    note: '',
    gym: '',
  };
}

export function draftFrom(exercise: Exercise): ExerciseDraft {
  return {
    name: exercise.name,
    loggingType: exercise.loggingType,
    primaryTagId: exercise.primaryTagId,
    additionalTagIds: [...exercise.additionalTagIds],
    note: exercise.note ?? '',
    gym: exercise.gym ?? '',
  };
}

export interface ExerciseFormProps {
  tags: readonly Tag[];
  /** Ćwiczenie w edycji; `null` znaczy „nowe". */
  editing: Exercise | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (draft: ExerciseDraft) => void;
}

export function ExerciseForm({ tags, editing, busy, onCancel, onSubmit }: ExerciseFormProps) {
  const [draft, setDraft] = useState<ExerciseDraft>(() =>
    editing === null ? emptyDraft(tags) : draftFrom(editing),
  );

  const patch = (change: Partial<ExerciseDraft>) => {
    setDraft((current) => ({ ...current, ...change }));
  };

  const problem = exerciseProblem(draft, tags);
  // Przy edycji sprawdzamy dodatkowo, czy cokolwiek się zmieniło — żądanie
  // bez zmian dołożyłoby wpis do outboksu synchronizacji i podbiło `updatedAt`
  // na wszystkich urządzeniach, nie zmieniając niczego widocznego.
  const unchanged = editing !== null && Object.keys(exercisePatch(draft, editing)).length === 0;

  return (
    <form
      className="flex flex-col gap-4 rounded-xl border border-accent/40 bg-elevated p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (problem === null && !unchanged) onSubmit(draft);
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Name">
          <Input
            value={draft.name}
            autoFocus
            maxLength={80}
            placeholder="Barbell bench press"
            onChange={(event) => {
              patch({ name: event.target.value });
            }}
          />
        </Field>

        <Field
          label="Logging type"
          hint={
            editing === null
              ? 'Set once — it cannot be changed after the exercise exists.'
              : 'Not editable: changing it would invalidate the logged sets.'
          }
        >
          <Select
            value={draft.loggingType}
            disabled={editing !== null}
            onChange={(event) => {
              patch({ loggingType: event.target.value as Exercise['loggingType'] });
            }}
          >
            {LOGGING_TYPES.map((type) => (
              <option key={type} value={type}>
                {LOGGING_TYPE_LABELS[type]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Primary tag" hint="Decides which cycle goals a set counts towards.">
          <Select
            value={draft.primaryTagId}
            onChange={(event) => {
              const primaryTagId = event.target.value;
              // Tag główny nie może zostać jednocześnie dodatkowym — inaczej
              // to samo ćwiczenie liczyłoby się do celu dwa razy.
              patch({
                primaryTagId,
                additionalTagIds: draft.additionalTagIds.filter((id) => id !== primaryTagId),
              });
            }}
          >
            {tags.length === 0 && <option value="">— no tags —</option>}
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {tag.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Gym" hint="Empty means „anywhere”.">
          <Input
            value={draft.gym}
            maxLength={80}
            placeholder="e.g. Zdrofit Puławska"
            onChange={(event) => {
              patch({ gym: event.target.value });
            }}
          />
        </Field>
      </div>

      <Field label="Additional tags" hint="They widen filtering; cycle goals ignore them.">
        <div className="flex flex-wrap gap-2 pt-1">
          {tags
            .filter((tag) => tag.id !== draft.primaryTagId)
            .map((tag) => (
              <ToggleChip
                key={tag.id}
                label={tag.name}
                color={tag.color}
                selected={draft.additionalTagIds.includes(tag.id)}
                onToggle={() => {
                  patch({
                    additionalTagIds: draft.additionalTagIds.includes(tag.id)
                      ? draft.additionalTagIds.filter((id) => id !== tag.id)
                      : [...draft.additionalTagIds, tag.id],
                  });
                }}
              />
            ))}
        </div>
      </Field>

      <Field label="Note">
        <Textarea
          value={draft.note}
          rows={2}
          maxLength={500}
          placeholder="Bench setup, grip, anything worth remembering"
          onChange={(event) => {
            patch({ note: event.target.value });
          }}
        />
      </Field>

      {problem !== null && <p className="text-xs text-danger">{problem}</p>}

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || problem !== null || unchanged}>
          {editing === null ? 'Add exercise' : 'Save changes'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {unchanged && <span className="text-xs text-muted">Nothing changed.</span>}
      </div>
    </form>
  );
}
