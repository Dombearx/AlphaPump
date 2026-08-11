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

import { slug } from '@alphapump/core';

export interface SearchableExercise {
  name: string;
  /** Tag główny — po nim też szukamy, bo „plecy" to naturalne zapytanie. */
  tagName: string;
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
    const haystack = `${slug(exercise.name)}-${slug(exercise.tagName)}`;
    return tokens.every((token) => haystack.includes(token));
  });
}
