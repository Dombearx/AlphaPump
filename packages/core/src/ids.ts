/**
 * Identyfikatory.
 *
 * | Encja     | Identyfikator                                        |
 * | --------- | ---------------------------------------------------- |
 * | seria     | UUIDv7 nadawane na kliencie                          |
 * | cykl      | UUIDv7 nadawane na kliencie                          |
 * | ćwiczenie | `uuidv5(NS_EXERCISE, "${authorId}/${slug(nazwa)}")`   |
 * | tag       | `uuidv5(NS_TAG, slug(nazwa))`                        |
 *
 * Deterministyczne identyfikatory ćwiczeń i tagów rozwiązują problem duplikatów
 * tworzonych offline: ten sam użytkownik tworzący na dwóch urządzeniach bez
 * sieci ćwiczenie o tej samej nazwie wyliczy **to samo id**, więc na serwerze
 * oba wiersze zwyczajnie się zsumują — bez remapowania identyfikatorów i bez
 * przepinania serii. Dwóch różnych użytkowników dostanie różne id, bo
 * `authorId` wchodzi w klucz; tagi, jako byt globalny, deduplikują się same.
 *
 * > **KONTRAKT.** Wartości przestrzeni nazw są zapisane wprost, a nie liczone
 * > przy starcie, bo są częścią kontraktu danych. Test w `tests/ids.test.ts`
 * > pilnuje, że nadal odpowiadają swojemu wyprowadzeniu.
 */

import { v5 as uuidv5, v7 as uuidv7, validate as validateUuid } from 'uuid';
import { slug } from './slug.js';

/** `uuidv5('alphapump.app', uuidv5.DNS)` — korzeń wszystkich przestrzeni nazw. */
export const NS_ALPHAPUMP = 'f885e373-f6d3-5597-b235-000747dbfff8';

/** `uuidv5('exercise', NS_ALPHAPUMP)` */
export const NS_EXERCISE = 'ede0b886-0a38-5e97-9992-475f2fbabb87';

/** `uuidv5('tag', NS_ALPHAPUMP)` */
export const NS_TAG = '387d6d24-6bbc-5f2e-8dab-a25f96fb1d2d';

/**
 * `uuidv5('system-user', NS_ALPHAPUMP)` — konto systemowe, autor ćwiczeń
 * wbudowanych. Ćwiczenia wbudowane potrzebują autora, bo `authorId` wchodzi
 * w klucz identyfikatora; stałe konto sprawia, że ich id są takie same
 * w seedzie, w bazie i po odtworzeniu z kopii zapasowej.
 */
export const SYSTEM_USER_ID = '73d7cbab-d3b4-549a-8d8f-9de36dbaae82';

/**
 * Klucz, z którego wyliczane jest id ćwiczenia. Wydzielony, bo bywa logowany.
 *
 * Siłownia jest **opcjonalną** częścią klucza — niektóre maszyny są na tyle
 * specyficzne dla konkretnej siłowni (inny opór, inna kalibracja obciążenia),
 * że to samo ćwiczenie na dwóch siłowniach ma sens jako dwa osobne wiersze
 * z osobną historią i rekordami. Pusta/brakująca siłownia daje **dokładnie
 * ten sam klucz co przed wprowadzeniem tego pola** — istniejące ćwiczenia bez
 * podanej siłowni nie zmieniają id.
 */
export function exerciseIdKey(authorId: string, name: string, gym?: string | null): string {
  const gymSlug = gym !== undefined && gym !== null && gym.trim().length > 0 ? slug(gym) : null;
  const base = `${authorId}/${slug(name)}`;
  return gymSlug === null ? base : `${base}@${gymSlug}`;
}

export function exerciseId(authorId: string, name: string, gym?: string | null): string {
  return uuidv5(exerciseIdKey(authorId, name, gym), NS_EXERCISE);
}

/** Id ćwiczenia wbudowanego — autorem jest konto systemowe. */
export function builtInExerciseId(name: string, gym?: string | null): string {
  return exerciseId(SYSTEM_USER_ID, name, gym);
}

export function tagId(name: string): string {
  return uuidv5(slug(name), NS_TAG);
}

/**
 * Identyfikatory nadawane na kliencie. UUIDv7 zawiera znacznik czasu, więc
 * sortuje się chronologicznie — indeksy bazy nie fragmentują się tak jak przy
 * UUIDv4.
 */
export function newSetId(): string {
  return uuidv7();
}

export function newCycleId(): string {
  return uuidv7();
}

export function newCycleGoalId(): string {
  return uuidv7();
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && validateUuid(value);
}
