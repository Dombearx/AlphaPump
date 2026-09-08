/**
 * Masa ciała użytkownika — reguły i rejestr na dysku.
 *
 * Ćwiczenia oparte o masę ciała mają przy serii własne, opcjonalne pole na tę
 * masę (patrz `logging-type.ts` w rdzeniu). Dopóki wpisywało się je z palca przy
 * każdej serii, prawie nikt tego nie robił — a wartość jest przez miesiące ta
 * sama. Stąd jedno pole w ustawieniach: podana raz masa wchodzi do formularza
 * jako wartość startowa i zostaje edytowalna jak każde inne pole serii.
 *
 * Trzymamy **gramy**, tak jak baza i cała reszta pomiarów: kilogramy z klawiatury
 * zamieniają się na liczbę całkowitą już tutaj, żeby ustawienie i seria mówiły
 * o masie tą samą liczbą.
 *
 * ## Dlaczego per urządzenie, a nie per konto
 *
 * Ten sam powód co przy języku (`language/state.ts`) i dyktowaniu
 * (`dictation/state.ts`): zapis per konto to kolumna w tabeli użytkowników, czyli
 * migracja w dwóch dialektach i pole w protokole synchronizacji. Zgłoszenie mówi
 * o jednej, aktualnej wartości wpisywanej w ustawieniach, a nie o historii masy
 * ciała — i o niczym, co ma jechać na serwer. Cena jest ta sama i akceptujemy ją
 * świadomie: kto ma dwa telefony, wpisuje masę na obu.
 *
 * Ten plik jest czysty — nie dotyka Expo ani dysku. Warstwa natywna siedzi
 * w `expo.ts`, a stan ekranu w `use-bodyweight.ts`.
 */

import { kilogramsToGrams } from '@alphapump/core';
import { parseWeight } from '../measurements';

/**
 * Górna granica sensownej masy ciała. Nie jest to walidacja dla samej walidacji:
 * bez niej literówka „800" zamiast „80" wchodziłaby do każdej kolejnej serii,
 * a zauważa się ją dopiero na wykresie tygodnie później.
 */
export const MAX_BODYWEIGHT_G = kilogramsToGrams(500);

export function isBodyweight(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_BODYWEIGHT_G
  );
}

/**
 * Masa ciała wpisana w ustawieniach, w gramach.
 *
 * `null` znaczy „nie ma czego zapisać" i **nie jest** tym samym co odmowa: puste
 * pole to prośba o skasowanie ustawienia, a nie błąd. Rozróżnia je wywołujący,
 * bo tylko on wie, czy pole było puste.
 */
export function parseBodyweightInput(text: string): number | null {
  const grams = parseWeight(text);
  return isBodyweight(grams) ? grams : null;
}

/**
 * Rejestr nieczytelny albo z masą spoza zakresu znaczy **brak ustawienia**,
 * a nie błąd — tak samo jak przy języku i dyktowaniu. Najgorsze, co się stanie,
 * to że użytkownik wpisze masę jeszcze raz; ekran z komunikatem o błędzie
 * odczytu ustawień byłby gorszy od jednego pola do wypełnienia.
 */
export function parseBodyweight(raw: string): number | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  const value = (parsed as { bodyweightG?: unknown } | null)?.bodyweightG;
  return isBodyweight(value) ? value : null;
}

export function serializeBodyweight(bodyweightG: number | null): string {
  return JSON.stringify({ bodyweightG });
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs — jak `DictationStore`.
 * Ekran ustawień i formularz serii dostają implementację z zewnątrz, a testy
 * podstawiają atrapę.
 */
export interface BodyweightStore {
  /** Zapisana masa w gramach albo `null`, gdy nikt jeszcze jej nie podał. */
  read: () => Promise<number | null>;
  /** `null` kasuje ustawienie — formularz wraca wtedy do zachowania sprzed niego. */
  write: (bodyweightG: number | null) => Promise<void>;
}
