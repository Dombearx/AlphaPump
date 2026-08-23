/**
 * Formularz ćwiczenia — reguły, bez interfejsu.
 *
 * Formularz jest jednym miejscem w panelu, w którym da się popełnić błąd
 * *domenowy*, a nie tylko literówkę: tag główny powtórzony wśród dodatkowych
 * liczyłby to samo ćwiczenie do celu cyklu dwa razy, a `PATCH` z kompletem pól
 * podbiłby `updatedAt` na wszystkich urządzeniach także wtedy, gdy nic się nie
 * zmieniło. Jedno i drugie jest tutaj, jako zwykłe funkcje — bo to je warto
 * przetestować, a nie renderowanie `<select>`.
 *
 * Kształty wejścia i wyjścia są rdzeniowe (`CreateExerciseInput`,
 * `UpdateExerciseInput`), więc pole dołożone w `packages/core` nie może się tu
 * po cichu zgubić.
 */

import type {
  CreateExerciseInput,
  Exercise,
  LoggingType,
  Tag,
  UpdateExerciseInput,
} from '@alphapump/core';

/**
 * Stan pól formularza. Napisy zamiast `null`, bo tym operuje `<input>` —
 * zamiana pustego napisu na `null` należy do granicy z API, nie do pola.
 */
export interface ExerciseDraft {
  name: string;
  loggingType: LoggingType;
  primaryTagId: string;
  additionalTagIds: string[];
  note: string;
  gym: string;
}

const NAME_MAX = 80;
const GYM_MAX = 80;
const NOTE_MAX = 1000;

/** `null` znaczy „można zapisać" — ten sam kształt co walidatory w aplikacji. */
export function exerciseProblem(draft: ExerciseDraft, tags: readonly Tag[]): string | null {
  if (draft.name.trim().length === 0) return 'Enter an exercise name.';
  if (draft.name.trim().length > NAME_MAX) return `The name can be at most ${NAME_MAX} characters.`;

  // Sprawdzamy istnienie tagu, a nie samą niepustość: lista tagów mogła się
  // zmienić w innej karcie, a wybór wskazywałby wtedy na tag, którego nie ma.
  if (!tags.some((tag) => tag.id === draft.primaryTagId)) {
    return tags.length === 0
      ? 'Add at least one tag first — an exercise needs a primary tag.'
      : 'Pick a primary tag.';
  }

  if (draft.additionalTagIds.includes(draft.primaryTagId)) {
    return 'The primary tag cannot also be an additional one.';
  }
  if (draft.gym.trim().length > GYM_MAX) return `The gym can be at most ${GYM_MAX} characters.`;
  if (draft.note.trim().length > NOTE_MAX) return `The note can be at most ${NOTE_MAX} characters.`;

  return null;
}

/** Puste pole tekstowe znaczy „brak wartości", a nie „pusty napis". */
function orNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

export function exerciseInput(draft: ExerciseDraft): CreateExerciseInput {
  return {
    name: draft.name.trim(),
    loggingType: draft.loggingType,
    primaryTagId: draft.primaryTagId,
    additionalTagIds: [...draft.additionalTagIds],
    note: orNull(draft.note),
    gym: orNull(draft.gym),
    // Panel nie ma jeszcze pól na nazwy w innych językach — uzupełnia je
    // tłumaczenie po stronie serwera.
    translations: null,
  };
}

/**
 * Łatka: **wyłącznie** pola, które naprawdę się zmieniły.
 *
 * Wysłanie kompletu byłoby prostsze i o tyle gorsze, że każdy zapis — także
 * otwarcie i zamknięcie formularza bez zmian — podbijałby `updatedAt`, wysyłał
 * wiersz do wszystkich urządzeń i mieszał w rozstrzyganiu remisów przy
 * synchronizacji. Pusty wynik znaczy „nie ma czego zapisywać".
 *
 * Typu logowania tu nie ma z zasady: `UpdateExerciseInput` go nie zna.
 */
export function exercisePatch(draft: ExerciseDraft, current: Exercise): UpdateExerciseInput {
  const next = exerciseInput(draft);
  const patch: UpdateExerciseInput = {};

  if (next.name !== current.name) patch.name = next.name;
  if (next.primaryTagId !== current.primaryTagId) patch.primaryTagId = next.primaryTagId;
  if (next.note !== current.note) patch.note = next.note;
  if (next.gym !== current.gym) patch.gym = next.gym;

  // Kolejność tagów dodatkowych jest znacząca — wchodzi do wiersza `position`
  // w `exercise_tags` — więc porównujemy listy, a nie zbiory.
  const same =
    next.additionalTagIds.length === current.additionalTagIds.length &&
    next.additionalTagIds.every((id, index) => id === current.additionalTagIds[index]);
  if (!same) patch.additionalTagIds = next.additionalTagIds;

  return patch;
}
