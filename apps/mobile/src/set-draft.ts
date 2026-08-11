/**
 * Zawartość formularza serii.
 *
 * Formularz trzyma napisy, baza trzyma liczby całkowite — a między jednym
 * a drugim jest kilka reguł, których nie chcemy mieć w komponencie: które pola
 * w ogóle istnieją dla danego typu logowania, co podpowiedzieć jako wartość
 * startową i kiedy formularz da się zapisać.
 *
 * Wszystko tutaj jest czyste, więc te reguły da się przetestować bez
 * renderowania czegokolwiek — a to jest dokładnie ta część ekranu, w której
 * błąd jest kosztowny: zapisana seria z pustym polem albo z ciężarem wpisanym
 * w miejsce dystansu.
 */

import {
  suggestNextSet,
  type IsoDate,
  type LoggingType,
  type SuggestableSet,
  type SuggestionReason,
} from '@alphapump/core';
import type { SetValues } from './db/sets';
import { fieldsFor, formatValue, parseValue, type MeasurementField } from './measurements';

/** Napisy z pól formularza, po jednym na pole widoczne dla typu logowania. */
export type DraftValues = Partial<Record<MeasurementField['key'], string>>;

export interface SetDraft {
  values: DraftValues;
  note: string;
}

export const EMPTY_DRAFT: SetDraft = { values: {}, note: '' };

/** Formularz wypełniony wartościami istniejącej serii — punkt startowy edycji. */
export function draftOf(
  loggingType: LoggingType,
  source: {
    weightG: number | null;
    reps: number | null;
    durationS: number | null;
    distanceM: number | null;
    bodyweightG: number | null;
    note: string | null;
  },
): SetDraft {
  const values: DraftValues = {};

  for (const field of fieldsFor(loggingType)) {
    const value = source[field.key];
    if (value !== null) values[field.key] = formatValue(field.kind, value);
  }

  return { values, note: source.note ?? '' };
}

export interface SuggestedDraft extends SetDraft {
  /** Skąd wzięły się wartości — pokazujemy to pod formularzem. */
  reason: SuggestionReason | null;
}

/**
 * Podpowiedź dla kolejnej serii.
 *
 * Regułę („kolejna seria tego dnia bierze z poprzedniej, pierwsza — z pierwszej
 * serii ostatniego dnia z tym ćwiczeniem") liczy `@alphapump/core`. Tutaj
 * zostaje wyłącznie zamiana liczb na napisy. Notatki świadomie nie
 * podpowiadamy — dotyczy konkretnej serii, a nie zwyczaju.
 */
export function suggestedDraft<T extends SuggestableSet>(
  loggingType: LoggingType,
  history: readonly T[],
  day: IsoDate,
): SuggestedDraft {
  const suggestion = suggestNextSet(loggingType, history, day);
  if (suggestion === null) return { ...EMPTY_DRAFT, reason: null };

  const draft = draftOf(loggingType, {
    ...suggestion.measurements,
    bodyweightG: suggestion.bodyweightG,
    note: null,
  });

  return { ...draft, reason: suggestion.reason };
}

export type DraftReadResult =
  { ok: true; values: SetValues } | { ok: false; missing: MeasurementField[] };

/**
 * Czyta formularz.
 *
 * Pole spoza typu logowania zostaje `null` — nie „0", nie pusty napis. Dystans
 * zapisany przy wyciskaniu sztangi przeszedłby przez bazę i wyszedł dopiero przy
 * liczeniu rekordów, jako oś, której to ćwiczenie nie ma.
 *
 * Masa ciała jest jedynym polem opcjonalnym: zapisujemy ją, gdy użytkownik ją
 * poda, i nie blokujemy zapisu, gdy nie poda. Nie bierze udziału w rekordach,
 * więc jej brak niczego nie psuje.
 */
export function readDraft(loggingType: LoggingType, draft: SetDraft): DraftReadResult {
  const values: SetValues = {
    weightG: null,
    reps: null,
    durationS: null,
    distanceM: null,
    bodyweightG: null,
    note: draft.note.trim().length === 0 ? null : draft.note.trim(),
  };

  const missing: MeasurementField[] = [];

  for (const field of fieldsFor(loggingType)) {
    const parsed = parseValue(field.kind, draft.values[field.key] ?? '');
    const optional = field.key === 'bodyweightG';

    if (parsed === null) {
      if (!optional) missing.push(field);
      continue;
    }

    values[field.key] = parsed;
  }

  return missing.length === 0 ? { ok: true, values } : { ok: false, missing };
}
