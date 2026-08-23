/**
 * Dane startowe — konto systemowe, tagi i ćwiczenia wbudowane.
 *
 * Zestaw jest **dialekt-agnostyczny**: to zwykłe obiekty, które seed
 * PostgreSQL i seed SQLite wstawiają jednym i tym samym wsadem. Identyfikatory
 * i kolory nie są tu wpisane ręcznie, tylko liczone funkcjami z `@alphapump/core`
 * — czyli dokładnie tak, jak policzy je telefon, tworząc tag offline.
 *
 * To jest sedno parzystości seeda: po obu stronach daje
 * **identyczne identyfikatory** ćwiczeń wbudowanych, bo obie strony liczą je
 * z tej samej nazwy tym samym kodem.
 *
 * Ćwiczenia wbudowane potrzebują autora, bo `authorId` wchodzi w klucz
 * identyfikatora. Stałe konto systemowe sprawia, że ich id są takie same
 * w seedzie, w bazie i po odtworzeniu z kopii zapasowej.
 */

import {
  SYSTEM_USER_ID,
  assignTagColors,
  builtInExerciseId,
  slug,
  tagId,
  type LoggingType,
  type Translations,
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
  translations: Translations;
}

export interface SeedExercise {
  id: string;
  name: string;
  slug: string;
  authorId: string;
  loggingType: LoggingType;
  primaryTagId: string;
  additionalTagIds: string[];
  translations: Translations;
}

/**
 * Tagi startowe. Lista jest krótka celowo — tagi tworzą użytkownicy, a te
 * poniżej mają tylko sprawić, że pierwsze ćwiczenie da się dodać bez zakładania
 * słownika od zera.
 */
const TAG_NAMES_PL = {
  abs: 'brzuch',
  back: 'plecy',
  biceps: 'biceps',
  calves: 'łydki',
  chest: 'klatka',
  glutes: 'pośladki',
  hamstrings: 'dwugłowe uda',
  quads: 'czworogłowe uda',
  shoulders: 'barki',
  triceps: 'triceps',
} as const;

export type SeedTagName = keyof typeof TAG_NAMES_PL;

/** Kolejność jest tu istotna: z niej wynika przydział kolorów paru linijek niżej. */
const TAG_NAMES = Object.keys(TAG_NAMES_PL) as readonly SeedTagName[];

/**
 * Kolory idą przez `assignTagColors`, a nie po jednym z nazwy: unikalność jest
 * własnością zbioru, więc dziesięć tagów startowych trzeba przydzielić naraz.
 * Wynik jest deterministyczny, więc telefon i serwer dostają to samo.
 */
const SEED_TAG_COLORS = assignTagColors(TAG_NAMES.map((name) => ({ slug: slug(name) })));

export const SEED_TAGS: readonly SeedTag[] = TAG_NAMES.map((name, index) => ({
  id: tagId(name),
  name,
  slug: slug(name),
  color: SEED_TAG_COLORS[index]!,
  translations: { en: name, pl: TAG_NAMES_PL[name] },
}));

interface ExerciseDefinition {
  name: string;
  /** Nazwa polska. Wpisana ręcznie, a nie tłumaczona automatem: biblioteka
   *  wbudowana jedzie w seedzie, który nie ma prawa wołać sieci. */
  namePl: string;
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
  {
    name: 'Lying dumbbell curl',
    namePl: 'Uginanie ramion z hantlami leżąc',
    loggingType: 'weight_reps',
    primaryTag: 'biceps',
  },

  // triceps
  {
    name: 'Lying triceps extension',
    namePl: 'Wyciskanie francuskie leżąc',
    loggingType: 'weight_reps',
    primaryTag: 'triceps',
  },
  {
    name: 'Overhead cable triceps extension',
    namePl: 'Wyprost ramion z wyciągu zza głowy',
    loggingType: 'weight_reps',
    primaryTag: 'triceps',
  },

  // quads
  {
    name: 'Barbell squat',
    namePl: 'Przysiad ze sztangą',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },
  {
    name: 'Zercher squat',
    namePl: 'Przysiad Zerchera',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes', 'back'],
  },
  {
    name: 'Leg press',
    namePl: 'Wyciskanie nogami na suwnicy',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },
  {
    name: 'Rear kick',
    namePl: 'Zakopywanie nogi w tył',
    loggingType: 'weight_reps',
    primaryTag: 'quads',
    additionalTags: ['glutes'],
  },

  // hamstrings
  {
    name: 'Romanian deadlift',
    namePl: 'Martwy ciąg rumuński',
    loggingType: 'weight_reps',
    primaryTag: 'hamstrings',
    additionalTags: ['glutes', 'back'],
  },
  {
    name: 'Single leg seated hamstring curl',
    namePl: 'Uginanie jednej nogi siedząc',
    loggingType: 'weight_reps',
    primaryTag: 'hamstrings',
  },
  {
    name: 'Dumbbell jefferson curl',
    namePl: 'Jefferson curl z hantlem',
    loggingType: 'weight_reps',
    primaryTag: 'hamstrings',
    additionalTags: ['back'],
  },

  // glutes
  {
    name: 'Deadlift',
    namePl: 'Martwy ciąg',
    loggingType: 'weight_reps',
    primaryTag: 'glutes',
    additionalTags: ['hamstrings', 'back'],
  },
  {
    name: 'Single leg hip thrust',
    namePl: 'Wypychanie bioder na jednej nodze',
    loggingType: 'weight_reps',
    primaryTag: 'glutes',
    additionalTags: ['hamstrings'],
  },

  // chest
  {
    name: 'Flat dumbbell bench press',
    namePl: 'Wyciskanie hantli na ławce płaskiej',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Flat barbell bench press',
    namePl: 'Wyciskanie sztangi na ławce płaskiej',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted push up',
    namePl: 'Pompki z obciążeniem',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted deep push up',
    namePl: 'Głębokie pompki z obciążeniem',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },
  {
    name: 'Weighted dip',
    namePl: 'Pompki na poręczach z obciążeniem',
    loggingType: 'weight_reps',
    primaryTag: 'chest',
    additionalTags: ['triceps', 'shoulders'],
  },

  // back
  {
    name: 'Machine row',
    namePl: 'Wiosłowanie na maszynie',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['biceps'],
  },
  {
    name: 'Weighted pull up',
    namePl: 'Podciąganie z obciążeniem',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['biceps'],
  },
  {
    name: 'Dumbbell pullover',
    namePl: 'Przenoszenie hantla za głowę',
    loggingType: 'weight_reps',
    primaryTag: 'back',
    additionalTags: ['chest'],
  },

  // abs
  {
    name: "Mason's crunch",
    namePl: 'Brzuszki masona',
    loggingType: 'bodyweight_reps',
    primaryTag: 'abs',
  },

  // shoulders
  {
    name: 'Lateral dumbbell raise',
    namePl: 'Wznosy hantli bokiem',
    loggingType: 'weight_reps',
    primaryTag: 'shoulders',
  },
  {
    name: 'Overhead press',
    namePl: 'Wyciskanie żołnierskie',
    loggingType: 'weight_reps',
    primaryTag: 'shoulders',
    additionalTags: ['triceps'],
  },
  {
    name: 'Lying lateral raise',
    namePl: 'Wznosy bokiem leżąc',
    loggingType: 'weight_reps',
    primaryTag: 'shoulders',
  },

  // calves
  {
    name: 'Calf raise',
    namePl: 'Wspięcia na palce',
    loggingType: 'weight_reps',
    primaryTag: 'calves',
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
  translations: { en: definition.name, pl: definition.namePl },
}));
