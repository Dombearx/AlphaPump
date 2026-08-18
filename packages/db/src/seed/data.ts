/**
 * Dane startowe — konto systemowe, tagi i ćwiczenia wbudowane.
 *
 * Zestaw jest **dialekt-agnostyczny**: to zwykłe obiekty, które seed
 * PostgreSQL i seed SQLite wstawiają jednym i tym samym wsadem. Identyfikatory
 * i kolory nie są tu wpisane ręcznie, tylko liczone funkcjami z `@alphapump/core`
 * — czyli dokładnie tak, jak policzy je telefon, tworząc tag offline.
 *
 * To jest sedno kryterium ukończenia etapu 2: seed po obu stronach daje
 * **identyczne identyfikatory** ćwiczeń wbudowanych, bo obie strony liczą je
 * z tej samej nazwy tym samym kodem.
 *
 * Ćwiczenia wbudowane potrzebują autora, bo `authorId` wchodzi w klucz
 * identyfikatora. Stałe konto systemowe sprawia, że ich id są takie same
 * w seedzie, w bazie i po odtworzeniu z kopii zapasowej.
 */

import {
  SYSTEM_USER_ID,
  builtInExerciseId,
  slug,
  tagColor,
  tagId,
  type LoggingType,
} from '@alphapump/core';

/**
 * Znacznik czasu wierszy z seeda. Stały, a nie „teraz", z dwóch powodów: seed
 * uruchomiony dwa razy daje ten sam wynik, a wiersz wbudowany nigdy nie wygra
 * LWW z edycją użytkownika, bo jego `updated_at` leży w przeszłości.
 */
export const SEED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');

/** Konto systemowe — autor wszystkich ćwiczeń wbudowanych. Nikt się na nie nie loguje. */
export const SYSTEM_USER = {
  id: SYSTEM_USER_ID,
  name: 'AlphaPump',
  nickname: 'AlphaPump',
  email: 'system@alphapump.local',
  role: 'admin',
} as const;

/** Ile wierszy słownikowych zawiera seed — do potwierdzenia w logu wdrożenia. */
export interface SeedSummary {
  tags: number;
  exercises: number;
}

export interface SeedTag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

export interface SeedExercise {
  id: string;
  name: string;
  slug: string;
  authorId: string;
  loggingType: LoggingType;
  primaryTagId: string;
  additionalTagIds: string[];
}

/**
 * Tagi startowe. Lista jest krótka celowo — tagi tworzą użytkownicy, a te
 * poniżej mają tylko sprawić, że pierwsze ćwiczenie da się dodać bez zakładania
 * słownika od zera.
 */
const TAG_NAMES = [
  'abs',
  'back',
  'biceps',
  'calves',
  'chest',
  'glutes',
  'hamstrings',
  'quads',
  'shoulders',
  'triceps',
] as const;

export type SeedTagName = (typeof TAG_NAMES)[number];

function makeTag(name: string): SeedTag {
  return { id: tagId(name), name, slug: slug(name), color: tagColor(name) };
}

export const SEED_TAGS: readonly SeedTag[] = TAG_NAMES.map(makeTag);

interface ExerciseDefinition {
  name: string;
  loggingType: LoggingType;
  primaryTag: SeedTagName;
  additionalTags?: readonly SeedTagName[];
}

/**
 * Ćwiczenia wbudowane. Każdy z pięciu typów logowania jest reprezentowany —
 * inaczej cała ścieżka „wybierz ćwiczenie, zapisz serię" byłaby przetestowana
 * tylko dla ciężaru z powtórzeniami.
 */
const EXERCISE_DEFINITIONS: readonly ExerciseDefinition[] = [
  // biceps
  { name: 'Lying dumbbell curl', loggingType: 'weight_reps', primaryTag: 'biceps' },

  // triceps
  { name: 'Lying triceps extension', loggingType: 'weight_reps', primaryTag: 'triceps' },
  { name: 'Overhead cable triceps extension', loggingType: 'weight_reps', primaryTag: 'triceps' },

  // quads
  {
    name: 'Barbell squat',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },
  {
    name: 'Zercher squat',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes', 'back'],
  },
  {
    name: 'Leg press',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },
  {
    name: 'Rear kick',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },

  // hamstrings
  {
    name: 'Romanian deadlift',
    loggingType: 'weight_reps',
    primaryTag: 'hamstrings',
    additionalTags: ['glutes', 'back'],
  },
  { name: 'Single leg seated hamstring curl', loggingType: 'weight_reps', primaryTag: 'hamstrings' },
  {
    name: 'Dumbbell jefferson curl',
    loggingType: 'weight_reps',
    primaryTag: 'hamstrings',
    additionalTags: ['back'],
  },

  // glutes
  {
    name: 'Deadlift',
    loggingType: 'weight_reps',
    primaryTag: 'glutes',
    additionalTags: ['hamstrings', 'back'],
  },
  {
    name: 'Single leg hip thrust',
    loggingType: 'weight_reps',
    primaryTag: 'glutes',
    additionalTags: ['hamstrings'],
  },

  // chest
  {
    name: 'Flat dumbbell bench press',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Flat barbell bench press',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted push up',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted deep push up',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted dip',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },

  // back
  {
    name: 'Machine row',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['biceps'],
  },
  {
    name: 'Weighted pull up',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['biceps'],
  },
  {
    name: 'Dumbbell pullover',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['chest'],
  },

  // abs
  { name: "Mason's crunch", loggingType: 'bodyweight_reps', primaryTag: 'abs' },

  // shoulders
  { name: 'Lateral dumbbell raise', loggingType: 'weight_reps', primaryTag: 'shoulders' },
  {
    name: 'Overhead press',
    loggingType: 'weight_reps',
    primaryTag: 'shoulders',
    additionalTags: ['triceps'],
  },
  { name: 'Lying lateral raise', loggingType: 'weight_reps', primaryTag: 'shoulders' },

  // calves
  { name: 'Calf raise', loggingType: 'weight_reps', primaryTag: 'calves' },
];

export const SEED_EXERCISES: readonly SeedExercise[] = EXERCISE_DEFINITIONS.map((definition) => ({
  id: builtInExerciseId(definition.name),
  name: definition.name,
  slug: slug(definition.name),
  authorId: SYSTEM_USER.id,
  loggingType: definition.loggingType,
  primaryTagId: tagId(definition.primaryTag),
  additionalTagIds: (definition.additionalTags ?? []).map(tagId),
}));
