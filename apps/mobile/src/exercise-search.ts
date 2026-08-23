/**
 * Szukanie ćwiczenia w bibliotece.
 *
 * Dopasowanie idzie po slugu — tym samym, z którego liczony jest identyfikator
 * ćwiczenia. Dzięki temu „lawka" znajduje „Ławkę", a użytkownik nie musi trafiać
 * w ogonki, żeby zapisać serię.
 *
 * Zapytanie jest dzielone na słowa i **każde** musi trafić: „sztanga lezac"
 * znajduje „Wyciskanie sztangi leżąc" niezależnie od kolejności, w jakiej padły.
 * To jest cała „pełnotekstowość" tej warstwy i celowo nie ma jej więcej —
 * przy bibliotece rzędu setek wpisów przejście po tablicy trwa ułamek
 * milisekundy, a indeks FTS trzeba by utrzymywać w zgodzie z każdym pullem,
 * czyli dołożyć wyzwalacze i drugą ścieżkę, w której dane mogą się rozjechać.
 *
 * Funkcje są tu, a nie w komponencie, żeby dało się je przetestować bez
 * renderowania ekranu.
 */

import { LANGUAGES, slug, type Translations } from '@alphapump/core';

export interface SearchableExercise {
  name: string;
  /** Tag główny — po nim też szukamy, bo „plecy" to naturalne zapytanie. */
  tagName: string;
  /** Nazwy w pozostałych językach; brak jest normalnym stanem. */
  translations?: Translations | null;
  tagTranslations?: Translations | null;
}

/**
 * Wszystkie nazwy encji naraz: kanoniczna i każde tłumaczenie.
 *
 * Szukamy po **wszystkich**, a nie po tej w wybranym języku, i to jest decyzja.
 * Kto przełączył aplikację na polski, dalej pamięta „deadlift" — a kto wpisze
 * „martwy ciąg" przy angielskim interfejsie, też ma prawo je znaleźć. Zapytanie
 * bez wyniku jest tu gorsze niż wynik z nazwą w innym języku, bo drugi
 * przypadek widać na ekranie od razu.
 */
function allNames(name: string, translations: Translations | null | undefined): string[] {
  return [name, ...LANGUAGES.map((language) => translations?.[language] ?? '')];
}

/** Słowa zapytania; pusta tablica znaczy „pokaż wszystko". */
function queryTokens(query: string): string[] {
  return slug(query).split('-').filter(Boolean);
}

export function filterExercises<T extends SearchableExercise>(
  exercises: readonly T[],
  query: string,
): T[] {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return [...exercises];

  return exercises.filter((exercise) => {
    const haystack = [
      ...allNames(exercise.name, exercise.translations),
      ...allNames(exercise.tagName, exercise.tagTranslations),
    ]
      .map((value) => slug(value))
      .filter(Boolean)
      .join('-');

    return tokens.every((token) => haystack.includes(token));
  });
}
