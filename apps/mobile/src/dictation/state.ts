/**
 * Co ma się stać z rozpoznaną serią — reguły i rejestr na dysku.
 *
 * Dyktowanie kończy się w jednym z dwóch miejsc i to użytkownik rozstrzyga,
 * w którym:
 *
 * | Tryb   | Co się dzieje                                  | Dla kogo |
 * | ------ | ---------------------------------------------- | -------- |
 * | `form` | wartości wchodzą do formularza, zapisuje ręka   | ostrożny, uczy się funkcji |
 * | `save` | seria ląduje w bazie od razu, ekran mówi co zapisał | ufa modelowi, dyktuje serię za serią |
 *
 * Wartością domyślną jest `form` i nie jest to ostrożność bez powodu: seria
 * zapisana na podstawie źle usłyszanej liczby psuje rekord i wykres, a widać to
 * tygodnie później. Kto sprawdzi, że model trafia, przestawi przełącznik raz
 * i tego nie odkręci — ale ta decyzja ma należeć do niego, a nie do wartości
 * domyślnej, którą dostał bez pytania.
 *
 * Tryb `save` **nie omija kompletności**: serii bez wszystkich pól wymaganych
 * przez typ logowania nie da się zapisać, więc taka trafia do formularza
 * niezależnie od ustawienia. To nie jest wyjątek od reguły, tylko ta sama
 * reguła co przy zapisie z palca.
 *
 * ## Dlaczego per urządzenie, a nie per konto
 *
 * Ten sam powód co przy języku (`language/state.ts`): zapis per konto to kolumna
 * w tabeli użytkowników, czyli migracja w dwóch dialektach i pole w protokole
 * synchronizacji — dla ustawienia, które dotyczy jednego ekranu na jednym
 * telefonie. Kto ma dwa urządzenia, przestawia je na obu.
 *
 * Ten plik jest czysty — nie dotyka Expo ani dysku. Warstwa natywna siedzi
 * w `expo.ts`, a stan ekranu w `use-dictation.ts`.
 */

/** Co robimy z rozpoznaną serią. */
export const DICTATION_MODES = ['form', 'save'] as const;

export type DictationMode = (typeof DICTATION_MODES)[number];

export const DEFAULT_DICTATION_MODE: DictationMode = 'form';

export function isDictationMode(value: unknown): value is DictationMode {
  return typeof value === 'string' && (DICTATION_MODES as readonly string[]).includes(value);
}

/**
 * Rejestr nieczytelny albo z trybem, którego nie znamy, znaczy **tryb
 * domyślny**, a nie błąd — tak samo jak przy języku. Cofnięcie się do
 * ostrożniejszego z dwóch zachowań jest tu dodatkowo bezpieczne samo w sobie:
 * uszkodzony plik nie ma jak włączyć zapisywania bez pytania.
 */
export function parseDictationMode(raw: string): DictationMode {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_DICTATION_MODE;
  }

  const value = (parsed as { mode?: unknown } | null)?.mode;
  return isDictationMode(value) ? value : DEFAULT_DICTATION_MODE;
}

export function serializeDictationMode(mode: DictationMode): string {
  return JSON.stringify({ mode });
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs — jak `LanguageStore`.
 * Ekran ustawień i ekran dyktowania dostają implementację z zewnątrz, a testy
 * podstawiają atrapę.
 */
export interface DictationStore {
  read: () => Promise<DictationMode>;
  write: (mode: DictationMode) => Promise<void>;
}
