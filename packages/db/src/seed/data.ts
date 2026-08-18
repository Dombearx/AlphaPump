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
  'Chest',
  'Back',
  'Shoulders',
  'Biceps',
  'Triceps',
  'Forearms',
  'Abs',
  'Legs',
  'Glutes',
  'Calves',
  'Cardio',
  'Full body',
  'Mobility',
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
  // weight + reps
  { name: 'Barbell bench press', loggingType: 'weight_reps', primaryTag: 'Chest' },
  { name: 'Dumbbell bench press', loggingType: 'weight_reps', primaryTag: 'Chest' },
  {
    name: 'Incline barbell bench press',
    loggingType: 'weight_reps',
    primaryTag: 'Chest',
  },
  { name: 'Dumbbell flyes', loggingType: 'weight_reps', primaryTag: 'Chest' },
  { name: 'Barbell row', loggingType: 'weight_reps', primaryTag: 'Back' },
  { name: 'Dumbbell row', loggingType: 'weight_reps', primaryTag: 'Back' },
  { name: 'Lat pulldown', loggingType: 'weight_reps', primaryTag: 'Back' },
  {
    name: 'Deadlift',
    loggingType: 'weight_reps',
    primaryTag: 'Back',
    additionalTags: ['Legs', 'Full body'],
  },
  { name: 'Barbell squat', loggingType: 'weight_reps', primaryTag: 'Legs' },
  { name: 'Front squat', loggingType: 'weight_reps', primaryTag: 'Legs' },
  {
    name: 'Dumbbell lunges',
    loggingType: 'weight_reps',
    primaryTag: 'Legs',
    additionalTags: ['Glutes'],
  },
  { name: 'Leg press', loggingType: 'weight_reps', primaryTag: 'Legs' },
  { name: 'Lying leg curl', loggingType: 'weight_reps', primaryTag: 'Legs' },
  { name: 'Seated leg extension', loggingType: 'weight_reps', primaryTag: 'Legs' },
  { name: 'Overhead press', loggingType: 'weight_reps', primaryTag: 'Shoulders' },
  { name: 'Lateral raises', loggingType: 'weight_reps', primaryTag: 'Shoulders' },
  { name: 'Bent-over rear delt raises', loggingType: 'weight_reps', primaryTag: 'Shoulders' },
  { name: 'Barbell curl', loggingType: 'weight_reps', primaryTag: 'Biceps' },
  { name: 'Dumbbell curl', loggingType: 'weight_reps', primaryTag: 'Biceps' },
  {
    name: 'Hammer curl',
    loggingType: 'weight_reps',
    primaryTag: 'Biceps',
    additionalTags: ['Forearms'],
  },
  { name: 'Skull crushers', loggingType: 'weight_reps', primaryTag: 'Triceps' },
  { name: 'Triceps pushdown', loggingType: 'weight_reps', primaryTag: 'Triceps' },
  { name: 'Standing barbell calf raise', loggingType: 'weight_reps', primaryTag: 'Calves' },

  // bodyweight + reps
  { name: 'Pull-up', loggingType: 'bodyweight_reps', primaryTag: 'Back' },
  {
    name: 'Chin-up',
    loggingType: 'bodyweight_reps',
    primaryTag: 'Back',
    additionalTags: ['Biceps'],
  },
  { name: 'Push-ups', loggingType: 'bodyweight_reps', primaryTag: 'Chest' },
  {
    name: 'Dips',
    loggingType: 'bodyweight_reps',
    primaryTag: 'Chest',
    additionalTags: ['Triceps'],
  },
  { name: 'Sit-ups', loggingType: 'bodyweight_reps', primaryTag: 'Abs' },
  { name: 'Hanging leg raise', loggingType: 'bodyweight_reps', primaryTag: 'Abs' },
  { name: 'Bodyweight squats', loggingType: 'bodyweight_reps', primaryTag: 'Legs' },

  // bodyweight + time
  { name: 'Plank', loggingType: 'bodyweight_time', primaryTag: 'Abs' },
  { name: 'Dead hang', loggingType: 'bodyweight_time', primaryTag: 'Forearms' },
  { name: 'Stretching', loggingType: 'bodyweight_time', primaryTag: 'Mobility' },

  // weight + time
  {
    name: "Farmer's walk",
    loggingType: 'weight_time',
    primaryTag: 'Full body',
    additionalTags: ['Forearms'],
  },
  { name: 'Weighted wall sit', loggingType: 'weight_time', primaryTag: 'Legs' },

  // distance + time
  { name: 'Running', loggingType: 'distance_time', primaryTag: 'Cardio' },
  { name: 'Walking', loggingType: 'distance_time', primaryTag: 'Cardio' },
  { name: 'Cycling', loggingType: 'distance_time', primaryTag: 'Cardio' },
  {
    name: 'Rowing machine',
    loggingType: 'distance_time',
    primaryTag: 'Cardio',
    additionalTags: ['Full body'],
  },
  {
    name: 'Swimming',
    loggingType: 'distance_time',
    primaryTag: 'Cardio',
    additionalTags: ['Full body'],
  },
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
