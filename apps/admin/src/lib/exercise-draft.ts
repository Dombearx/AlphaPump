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

import {
  LANGUAGES,
  sameTranslations,
  type CreateExerciseInput,
  type Exercise,
  type Language,
  type LoggingType,
  type Tag,
  type Translations,
  type UpdateExerciseInput,
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
  /**
   * Nazwy w pozostałych językach — napis na język, bo tym operuje `<input>`.
   * Puste pole znaczy „brak nazwy", a nie „pusta nazwa": brakujące uzupełnia
   * tłumaczenie automatyczne po stronie serwera i nie nadpisuje przy tym tego,
   * co administrator wpisał tutaj.
   */
  translations: TranslationDraft;
}

export type TranslationDraft = Record<Language, string>;

export const EMPTY_TRANSLATIONS: TranslationDraft = { en: '', pl: '' };

/** Zestaw z API do pól formularza; brak tłumaczenia to puste pole. */
export function translationDraft(translations: Translations | null): TranslationDraft {
  const draft = { ...EMPTY_TRANSLATIONS };
  for (const language of LANGUAGES) draft[language] = translations?.[language] ?? '';
  return draft;
}

/**
 * Pola formularza z powrotem do zestawu. `null`, gdy nie wpisano ani jednej
 * nazwy — kolumna trzyma wtedy `NULL`, żeby „nie ma tłumaczeń" wyglądało
 * w bazie zawsze tak samo.
 */
export function translationsOf(draft: TranslationDraft): Translations | null {
  const translations: Translations = {};
  for (const language of LANGUAGES) {
    const name = draft[language].trim();
    if (name.length > 0) translations[language] = name;
  }
  return Object.keys(translations).length > 0 ? translations : null;
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
  for (const language of LANGUAGES) {
    if (draft.translations[language].trim().length > NAME_MAX) {
      return `Each name can be at most ${NAME_MAX} characters.`;
    }
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
    translations: translationsOf(draft.translations),
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
  // Zestawy porównujemy funkcją z rdzenia, a nie po `JSON.stringify`: liczy się
  // nazwa po przycięciu, a nie kolejność kluczy w obiekcie. Bez tego samo
  // otwarcie i zamknięcie formularza wysyłałoby łatkę i podbijało `updatedAt`
  // na wszystkich urządzeniach.
  if (!sameTranslations(next.translations, current.translations)) {
    patch.translations = next.translations;
  }
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
