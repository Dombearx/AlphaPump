/**
 * Rejestr eksportu do FitNotesa: co już poszło do pliku i czym zastąpić
 * kategorie, których w nim nie ma.
 *
 * Rejestr musi być po naszej stronie, bo plik docelowy nie jest w stanie
 * odpowiedzieć na pytanie „czy tę serię już dostałeś": `training_log` zna dzień,
 * ale nie zna godziny dodania wpisu, a dwie identyczne serie z jednego treningu
 * są w nim nie do odróżnienia od jednej wpisanej dwa razy.
 *
 * Ten plik jest czysty — I/O jest w `storage.ts`. Dzięki temu reguły odczytu
 * rejestru mają testy, a to one decydują o tym, czy powtórny eksport dopisze
 * użytkownikowi drugi komplet historii.
 *
 * ## Dlaczego uszkodzony rejestr jest błędem, a nie pustką
 *
 * Potraktowanie nieczytelnego pliku jako „nic jeszcze nie wyeksportowano"
 * byłoby najgorszą z możliwych reakcji: przy najbliższym eksporcie cały dziennik
 * wjechałby do kopii FitNotesa po raz drugi, a użytkownik zobaczyłby to dopiero
 * po przywróceniu backupu. Wolimy odmówić i powiedzieć wprost.
 */

import { z } from 'zod';

const stateSchema = z.object({
  /** Nazwa tagu głównego z AlphaPump → nazwa kategorii w pliku FitNotes. */
  categories: z.record(z.string(), z.string()),
  /** Klucze wpisów z `fitNotesExportKey`, które już są w pliku. */
  exported: z.array(z.string()),
});

export type FitNotesState = z.infer<typeof stateSchema>;

export const EMPTY_FITNOTES_STATE: FitNotesState = { categories: {}, exported: [] };

/** Rejestr jest, ale nie da się go odczytać — patrz nagłówek pliku. */
export class FitNotesStateError extends Error {
  constructor() {
    super(
      'The FitNotes export registry on this device is unreadable. ' +
        'Exporting now would duplicate your whole history in the backup file.',
    );
    this.name = 'FitNotesStateError';
  }
}

export function parseFitNotesState(raw: string): FitNotesState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new FitNotesStateError();
  }

  const result = stateSchema.safeParse(parsed);
  if (!result.success) throw new FitNotesStateError();
  return result.data;
}

export function serializeFitNotesState(state: FitNotesState): string {
  return JSON.stringify(state);
}

/** Zapamiętuje wybory kategorii — po to, żeby nie pytać o nie przy każdym eksporcie. */
export function withCategoryChoices(
  state: FitNotesState,
  choices: Readonly<Record<string, string>>,
): FitNotesState {
  return { ...state, categories: { ...state.categories, ...choices } };
}

/** Odhacza wpisy dopisane do pliku. Wołane **po** udanym zapisie, nigdy przed. */
export function withExportedKeys(state: FitNotesState, keys: readonly string[]): FitNotesState {
  return { ...state, exported: [...new Set([...state.exported, ...keys])] };
}
