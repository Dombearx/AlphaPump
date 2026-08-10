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
  'Klatka piersiowa',
  'Plecy',
  'Barki',
  'Biceps',
  'Triceps',
  'Przedramiona',
  'Brzuch',
  'Nogi',
  'Pośladki',
  'Łydki',
  'Cardio',
  'Całe ciało',
  'Mobilność',
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
  // ciężar + powtórzenia
  { name: 'Wyciskanie sztangi leżąc', loggingType: 'weight_reps', primaryTag: 'Klatka piersiowa' },
  { name: 'Wyciskanie hantli leżąc', loggingType: 'weight_reps', primaryTag: 'Klatka piersiowa' },
  {
    name: 'Wyciskanie sztangi na skosie dodatnim',
    loggingType: 'weight_reps',
    primaryTag: 'Klatka piersiowa',
  },
  { name: 'Rozpiętki hantlami', loggingType: 'weight_reps', primaryTag: 'Klatka piersiowa' },
  { name: 'Wiosłowanie sztangą', loggingType: 'weight_reps', primaryTag: 'Plecy' },
  { name: 'Wiosłowanie hantlem', loggingType: 'weight_reps', primaryTag: 'Plecy' },
  { name: 'Ściąganie drążka wyciągu górnego', loggingType: 'weight_reps', primaryTag: 'Plecy' },
  {
    name: 'Martwy ciąg',
    loggingType: 'weight_reps',
    primaryTag: 'Plecy',
    additionalTags: ['Nogi', 'Całe ciało'],
  },
  { name: 'Przysiad ze sztangą', loggingType: 'weight_reps', primaryTag: 'Nogi' },
  { name: 'Przysiad przedni', loggingType: 'weight_reps', primaryTag: 'Nogi' },
  {
    name: 'Wykroki z hantlami',
    loggingType: 'weight_reps',
    primaryTag: 'Nogi',
    additionalTags: ['Pośladki'],
  },
  { name: 'Wyciskanie nogami', loggingType: 'weight_reps', primaryTag: 'Nogi' },
  { name: 'Uginanie nóg leżąc', loggingType: 'weight_reps', primaryTag: 'Nogi' },
  { name: 'Prostowanie nóg siedząc', loggingType: 'weight_reps', primaryTag: 'Nogi' },
  { name: 'Wyciskanie żołnierskie', loggingType: 'weight_reps', primaryTag: 'Barki' },
  { name: 'Wznosy bokiem', loggingType: 'weight_reps', primaryTag: 'Barki' },
  { name: 'Wznosy w opadzie tułowia', loggingType: 'weight_reps', primaryTag: 'Barki' },
  { name: 'Uginanie ramion ze sztangą', loggingType: 'weight_reps', primaryTag: 'Biceps' },
  { name: 'Uginanie ramion z hantlami', loggingType: 'weight_reps', primaryTag: 'Biceps' },
  {
    name: 'Uginanie ramion młotkowe',
    loggingType: 'weight_reps',
    primaryTag: 'Biceps',
    additionalTags: ['Przedramiona'],
  },
  { name: 'Wyciskanie francuskie', loggingType: 'weight_reps', primaryTag: 'Triceps' },
  { name: 'Prostowanie ramion na wyciągu', loggingType: 'weight_reps', primaryTag: 'Triceps' },
  { name: 'Wspięcia na palce ze sztangą', loggingType: 'weight_reps', primaryTag: 'Łydki' },

  // masa ciała + powtórzenia
  { name: 'Podciąganie nachwytem', loggingType: 'bodyweight_reps', primaryTag: 'Plecy' },
  {
    name: 'Podciąganie podchwytem',
    loggingType: 'bodyweight_reps',
    primaryTag: 'Plecy',
    additionalTags: ['Biceps'],
  },
  { name: 'Pompki', loggingType: 'bodyweight_reps', primaryTag: 'Klatka piersiowa' },
  {
    name: 'Pompki na poręczach',
    loggingType: 'bodyweight_reps',
    primaryTag: 'Klatka piersiowa',
    additionalTags: ['Triceps'],
  },
  { name: 'Brzuszki', loggingType: 'bodyweight_reps', primaryTag: 'Brzuch' },
  { name: 'Unoszenie nóg w zwisie', loggingType: 'bodyweight_reps', primaryTag: 'Brzuch' },
  { name: 'Przysiady bez obciążenia', loggingType: 'bodyweight_reps', primaryTag: 'Nogi' },

  // masa ciała + czas
  { name: 'Deska', loggingType: 'bodyweight_time', primaryTag: 'Brzuch' },
  { name: 'Zwis na drążku', loggingType: 'bodyweight_time', primaryTag: 'Przedramiona' },
  { name: 'Rozciąganie', loggingType: 'bodyweight_time', primaryTag: 'Mobilność' },

  // ciężar + czas
  {
    name: 'Spacer farmera',
    loggingType: 'weight_time',
    primaryTag: 'Całe ciało',
    additionalTags: ['Przedramiona'],
  },
  { name: 'Przysiad izometryczny z obciążeniem', loggingType: 'weight_time', primaryTag: 'Nogi' },

  // dystans + czas
  { name: 'Bieg', loggingType: 'distance_time', primaryTag: 'Cardio' },
  { name: 'Marsz', loggingType: 'distance_time', primaryTag: 'Cardio' },
  { name: 'Rower', loggingType: 'distance_time', primaryTag: 'Cardio' },
  {
    name: 'Wiosłowanie na ergometrze',
    loggingType: 'distance_time',
    primaryTag: 'Cardio',
    additionalTags: ['Całe ciało'],
  },
  {
    name: 'Pływanie',
    loggingType: 'distance_time',
    primaryTag: 'Cardio',
    additionalTags: ['Całe ciało'],
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
