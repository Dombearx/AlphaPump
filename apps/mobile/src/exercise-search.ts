/**
 * Szukanie ćwiczenia w bibliotece.
 *
 * Dopasowanie idzie po slugu — tym samym, z którego liczony jest identyfikator
 * ćwiczenia. Dzięki temu „lawka" znajduje „Ławkę", a użytkownik nie musi trafiać
 * w ogonki, żeby zapisać serię.
 *
 * Funkcja jest tu, a nie w komponencie, żeby dało się ją przetestować bez
 * renderowania ekranu.
 */

import { slug } from '@alphapump/core';

export interface SearchableExercise {
  name: string;
  /** Tag główny — po nim też szukamy, bo „plecy" to naturalne zapytanie. */
  tagName: string;
}

export function filterExercises<T extends SearchableExercise>(
  exercises: readonly T[],
  query: string,
): T[] {
  const needle = slug(query);
  if (needle.length === 0) return [...exercises];

  return exercises.filter(
    (exercise) => slug(exercise.name).includes(needle) || slug(exercise.tagName).includes(needle),
  );
}
