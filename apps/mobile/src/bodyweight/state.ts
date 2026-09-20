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
 * ## Dlaczego historia, a nie jedna liczba
 *
 * Bo masa ciała zmienia się i to właśnie ta zmiana jest informacją — „schudłem
 * cztery kilo od maja" jest zdaniem o treningu, a sama liczba „78" nie jest.
 * Rejestr trzyma więc **listę wpisów**, po jednym na dzień, a masą aktualną jest
 * ten najświeższy z nich (`currentBodyweight`). Formularz serii bierze wyłącznie
 * tę jedną liczbę i nie wie o historii nic więcej.
 *
 * Jeden dzień to jeden wpis: poprawka literówki wpisana minutę później zastępuje
 * to, co stało w rejestrze, zamiast kłaść się obok jako druga „zmiana". Ważenie
 * się dwa razy dziennie i tak nie mówi nic, czego nie mówi ostatni pomiar dnia.
 *
 * ## Dlaczego per urządzenie, a nie per konto
 *
 * Ten sam powód co przy języku (`language/state.ts`) i dyktowaniu
 * (`dictation/state.ts`): zapis per konto to kolumna w tabeli użytkowników, czyli
 * migracja w dwóch dialektach i pole w protokole synchronizacji — a masa ciała
 * nie bierze udziału ani w rekordach, ani w rankingach, więc na serwerze nie ma
 * dla niej roboty. Cena jest ta sama i akceptujemy ją świadomie: kto ma dwa
 * telefony, wpisuje masę na obu.
 *
 * Ten plik jest czysty — nie dotyka Expo ani dysku. Warstwa natywna siedzi
 * w `expo.ts`, a stan ekranu w `use-bodyweight.ts`.
 */

import { compareIsoDates, isIsoDate, kilogramsToGrams, type IsoDate } from '@alphapump/core';
import { parseWeight } from '../measurements';

/**
 * Górna granica sensownej masy ciała. Nie jest to walidacja dla samej walidacji:
 * bez niej literówka „800" zamiast „80" wchodziłaby do każdej kolejnej serii,
 * a zauważa się ją dopiero na wykresie tygodnie później.
 */
export const MAX_BODYWEIGHT_G = kilogramsToGrams(500);

/** Jeden pomiar masy ciała: dzień i liczba gramów. */
export interface BodyweightEntry {
  /** Dzień wpisania, w czasie lokalnym urządzenia — jak dzień treningowy. */
  on: IsoDate;
  bodyweightG: number;
}

export function isBodyweight(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= MAX_BODYWEIGHT_G
  );
}

function isBodyweightEntry(value: unknown): value is BodyweightEntry {
  const entry = value as { on?: unknown; bodyweightG?: unknown } | null;
  return isIsoDate(entry?.on) && isBodyweight(entry?.bodyweightG);
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

/** Historia najświeższym wpisem do przodu — tak jak pokazuje ją ekran konta. */
function newestFirst(history: readonly BodyweightEntry[]): BodyweightEntry[] {
  return [...history].sort((a, b) => compareIsoDates(b.on, a.on));
}

/**
 * Masa aktualna, czyli ta z najświeższego wpisu. `null` znaczy „nikt jeszcze
 * masy nie podał" — i wtedy formularz serii zachowuje się tak, jak zachowywał
 * się przed tym ustawieniem.
 */
export function currentBodyweight(history: readonly BodyweightEntry[]): number | null {
  return newestFirst(history)[0]?.bodyweightG ?? null;
}

/**
 * Historia po zapisaniu masy w danym dniu. Wpis z tego samego dnia zostaje
 * **zastąpiony**: patrz „jeden dzień to jeden wpis" na górze pliku.
 */
export function recordBodyweight(
  history: readonly BodyweightEntry[],
  bodyweightG: number,
  on: IsoDate,
): BodyweightEntry[] {
  return newestFirst([...history.filter((entry) => entry.on !== on), { on, bodyweightG }]);
}

/**
 * Rejestr nieczytelny znaczy **brak historii**, a nie błąd — tak samo jak przy
 * języku i dyktowaniu. Najgorsze, co się stanie, to że użytkownik wpisze masę
 * jeszcze raz; ekran z komunikatem o błędzie odczytu ustawień byłby gorszy od
 * jednego pola do wypełnienia.
 *
 * Wpisy pojedynczo niepoprawne (masa spoza zakresu, dzień, którego nie ma)
 * wypadają, a reszta zostaje: jeden uszkodzony wiersz nie ma prawa skasować
 * pomiarów z kilku miesięcy.
 */
export function parseBodyweightHistory(raw: string): BodyweightEntry[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  const entries = (parsed as { entries?: unknown } | null)?.entries;
  if (!Array.isArray(entries)) return [];

  return newestFirst(entries.filter(isBodyweightEntry));
}

export function serializeBodyweightHistory(history: readonly BodyweightEntry[]): string {
  return JSON.stringify({ entries: newestFirst(history) });
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs — jak `DictationStore`.
 * Ekran ustawień i formularz serii dostają implementację z zewnątrz, a testy
 * podstawiają atrapę.
 */
export interface BodyweightStore {
  /** Historia pomiarów albo pusta lista, gdy nikt jeszcze masy nie podał. */
  read: () => Promise<BodyweightEntry[]>;
  /** Pusta lista kasuje ustawienie — formularz wraca do zachowania sprzed niego. */
  write: (history: readonly BodyweightEntry[]) => Promise<void>;
}
