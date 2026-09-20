/**
 * Schematy Zod — jedno źródło prawdy o kształcie danych, współdzielone przez
 * API, klienta i formularze w aplikacji. Typy encji są z nich wyprowadzane,
 * żeby walidacja i typy nie mogły się rozjechać.
 *
 * Schematy opisują dane **po** normalizacji: `slug`, `id` i kolor tagu są tu
 * zwykłymi polami, bo wyliczają je funkcje z `ids.ts` i `tag-color.ts` w chwili
 * tworzenia encji — także offline.
 */

import { z } from 'zod';
import { isIsoDate } from './dates.js';
import { INTENSITIES } from './intensity.js';
import { languageSchema } from './languages.js';
import { LOGGING_TYPES, requiredMeasurements, usesBodyweight } from './logging-type.js';
import { isSlug, slug } from './slug.js';

/* ------------------------------------------------------------------ wspólne */

export const uuidSchema = z.uuid();

export const isoDateSchema = z
  .string()
  .refine(isIsoDate, { message: 'Oczekiwano istniejącej daty w formacie YYYY-MM-DD' });

export const isoDateTimeSchema = z.iso.datetime({ offset: true });

export const slugSchema = z
  .string()
  .min(1)
  .refine(isSlug, { message: 'Wartość nie jest znormalizowanym slugiem' });

export const hexColorSchema = z.string().regex(/^#[0-9a-f]{6}$/, {
  message: 'Oczekiwano koloru w formacie #rrggbb',
});

/**
 * Nazwa widoczna dla użytkownika. Musi dawać niepusty slug — z nazwy złożonej
 * wyłącznie ze znaków interpunkcyjnych nie da się wyliczyć identyfikatora.
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .refine((value) => slug(value).length > 0, {
    message: 'Nazwa musi zawierać przynajmniej jedną literę lub cyfrę',
  });

/**
 * Nazwy encji w poszczególnych językach. Rekord **częściowy** — komplet nie
 * jest wymagany, bo tłumaczenia dochodzą później (automatem albo ręcznie),
 * a do wyświetlenia zawsze zostaje nazwa kanoniczna.
 */
export const translationsSchema = z.partialRecord(languageSchema, displayNameSchema);

export const noteSchema = z.string().trim().max(1000);

/** Siłownia — opcjonalny doprecyzowujący dopisek, wchodzi też w id ćwiczenia (patrz `ids.ts`). */
export const gymSchema = z.string().trim().max(80);

/** Pola, po których jedzie synchronizacja. Soft delete jest wszędzie — bez
 *  tombstone'a usunięcie wykonane offline nie miałoby jak dojechać na serwer. */
export const syncFieldsSchema = z.object({
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
});

const grams = z.int().min(0);
const positiveSeconds = z.int().positive();
const positiveMeters = z.int().positive();
const positiveReps = z.int().positive();

/* ---------------------------------------------------------------- użytkownik */

export const USER_ROLES = ['user', 'admin'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const userRoleSchema = z.enum(USER_ROLES);

export const userSchema = z
  .object({
    id: uuidSchema,
    email: z.email(),
    nickname: z.string().trim().min(1).max(40),
    role: userRoleSchema,
  })
  .extend(syncFieldsSchema.shape);

export type User = z.infer<typeof userSchema>;

/**
 * Najkrótsze dopuszczalne hasło — ta sama liczba, którą better-auth dostaje
 * w `emailAndPassword.minPasswordLength`.
 *
 * Stała jest tutaj, bo pilnują jej **trzy** miejsca: konfiguracja better-auth
 * (rejestracja i logowanie), generator hasła tymczasowego w API i formularz
 * ustawienia własnego hasła. Wpisana z ręki w każdym z nich rozjechałaby się
 * przy pierwszej zmianie — a rozjazd wyszedłby dopiero komuś, kto próbuje
 * ustawić hasło i dostaje odmowę bez powodu.
 */
export const MIN_PASSWORD_LENGTH = 8;

/**
 * Ustawienie własnego hasła po resecie wykonanym przez administratora
 * (`POST /me/password`).
 *
 * Nie ma tu `currentPassword` i to jest cała różnica względem zwykłej zmiany
 * hasła w better-auth: tamta potwierdza tożsamość starym hasłem, a ta jest
 * dostępna **wyłącznie** dla konta z hasłem tymczasowym — czyli takiego, którego
 * stare hasło zna administrator, bo sam je przed chwilą nadał. Pytanie o nie
 * niczego by nie dowiodło.
 */
export const setOwnPasswordInputSchema = z.object({
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(128),
});

export type SetOwnPasswordInput = z.infer<typeof setOwnPasswordInputSchema>;

/* ----------------------------------------------------------------------- tag */

export const tagSchema = z
  .object({
    id: uuidSchema,
    name: displayNameSchema,
    slug: slugSchema,
    color: hexColorSchema,
    translations: translationsSchema.nullable(),
  })
  .extend(syncFieldsSchema.shape);

export type Tag = z.infer<typeof tagSchema>;

export const createTagInputSchema = z.object({
  name: displayNameSchema,
  /** Nazwy w pozostałych językach; brakujące uzupełnia tłumaczenie automatyczne. */
  translations: translationsSchema.nullable().default(null),
});

export type CreateTagInput = z.infer<typeof createTagInputSchema>;

/**
 * Zmiana tagu (`PATCH /tags/:id`).
 *
 * Nazwa jest wymagana — to jest zmiana nazwy i innego powodu nie ma.
 * Tłumaczenia są **opcjonalne**, i ta różnica jest tu regułą: pominięcie pola
 * znaczy „zostaw, jak jest", a podanie go — „taki jest teraz komplet nazw",
 * łącznie z usunięciem tej, którą model wymyślił źle. Gdyby pominięcie znaczyło
 * `null`, zwykła zmiana nazwy z panelu kasowałaby po cichu wszystkie
 * tłumaczenia wiersza.
 */
export const updateTagInputSchema = z.object({
  name: displayNameSchema,
  translations: translationsSchema.nullable().optional(),
});

export type UpdateTagInput = z.infer<typeof updateTagInputSchema>;

/* ----------------------------------------------------------------- ćwiczenie */

export const loggingTypeSchema = z.enum(LOGGING_TYPES);

/**
 * Intensywność wysiłku. Domyślne `null` („nieokreślona") jest tu **wartością
 * domyślną schematu**, a nie tylko dopuszczalną: pole doszło do istniejącej
 * encji, więc wiersz bez niego — z archiwum sprzed zmiany albo z telefonu
 * ze starszą wersją aplikacji — musi dalej się wczytywać.
 */
export const intensitySchema = z.enum(INTENSITIES);

export const exerciseSchema = z
  .object({
    id: uuidSchema,
    name: displayNameSchema,
    slug: slugSchema,
    authorId: uuidSchema,
    loggingType: loggingTypeSchema,
    /** Dokładnie jeden tag główny — to on decyduje o zaliczaniu serii do cykli. */
    primaryTagId: uuidSchema,
    /** Patrz `intensity.ts`: cecha ćwiczenia, nie pojedynczej serii. */
    intensity: intensitySchema.nullable().default(null),
    additionalTagIds: z.array(uuidSchema),
    note: noteSchema.nullable(),
    gym: gymSchema.nullable(),
    translations: translationsSchema.nullable(),
  })
  .extend(syncFieldsSchema.shape)
  .refine((exercise) => !exercise.additionalTagIds.includes(exercise.primaryTagId), {
    message: 'Tag główny nie może powtarzać się wśród tagów dodatkowych',
    path: ['additionalTagIds'],
  })
  .refine(
    (exercise) => new Set(exercise.additionalTagIds).size === exercise.additionalTagIds.length,
    { message: 'Tagi dodatkowe nie mogą się powtarzać', path: ['additionalTagIds'] },
  );

export type Exercise = z.infer<typeof exerciseSchema>;

export const createExerciseInputSchema = z.object({
  name: displayNameSchema,
  /** Typ logowania jest ustalany tu raz na zawsze — zmiana wymaga nowego ćwiczenia. */
  loggingType: loggingTypeSchema,
  primaryTagId: uuidSchema,
  intensity: intensitySchema.nullable().default(null),
  additionalTagIds: z.array(uuidSchema).default([]),
  note: noteSchema.nullable().default(null),
  gym: gymSchema.nullable().default(null),
  /** Nazwy w pozostałych językach; brakujące uzupełnia tłumaczenie automatyczne. */
  translations: translationsSchema.nullable().default(null),
});

export type CreateExerciseInput = z.infer<typeof createExerciseInputSchema>;

/** Typ logowania świadomie nie jest edytowalny. */
export const updateExerciseInputSchema = createExerciseInputSchema
  .omit({ loggingType: true })
  .partial();

export type UpdateExerciseInput = z.infer<typeof updateExerciseInputSchema>;

/* --------------------------------------------------------------------- seria */

export const setMeasurementsSchema = z.object({
  weightG: grams.nullable(),
  reps: positiveReps.nullable(),
  durationS: positiveSeconds.nullable(),
  distanceM: positiveMeters.nullable(),
});

export const workoutSetSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    exerciseId: uuidSchema,
    /** Dzień kalendarzowy, bez strefy czasowej. */
    performedOn: isoDateSchema,
    /** Kolejność w obrębie dnia i ćwiczenia; użytkownik może ją zmieniać. */
    position: z.int().min(0),
    /** Zapisywana przy ćwiczeniach na masę ciała, ale nieliczona do rekordów. */
    bodyweightG: grams.nullable(),
    note: noteSchema.nullable(),
  })
  .extend(setMeasurementsSchema.shape)
  .extend(syncFieldsSchema.shape);

export type WorkoutSet = z.infer<typeof workoutSetSchema>;

export const createSetInputSchema = z
  .object({
    exerciseId: uuidSchema,
    performedOn: isoDateSchema,
    bodyweightG: grams.nullable().default(null),
    note: noteSchema.nullable().default(null),
  })
  .extend(setMeasurementsSchema.shape);

export type CreateSetInput = z.infer<typeof createSetInputSchema>;

/**
 * Walidacja pomiarów zależna od typu logowania ćwiczenia — pola wymagane muszą
 * być wypełnione, a pola spoza typu muszą zostać puste, żeby do bazy nie trafiał
 * dystans przy wyciskaniu sztangi.
 */
export function setInputSchemaFor(loggingType: (typeof LOGGING_TYPES)[number]) {
  const required = new Set<string>(requiredMeasurements(loggingType));

  return createSetInputSchema.superRefine((input, context) => {
    for (const key of ['weightG', 'reps', 'durationS', 'distanceM'] as const) {
      const value = input[key];
      if (required.has(key) && value === null) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `Pole wymagane dla typu logowania ${loggingType}`,
        });
      }
      if (!required.has(key) && value !== null) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: `Pole nie występuje w typie logowania ${loggingType}`,
        });
      }
    }

    if (!usesBodyweight(loggingType) && input.bodyweightG !== null) {
      context.addIssue({
        code: 'custom',
        path: ['bodyweightG'],
        message: `Masa ciała nie występuje w typie logowania ${loggingType}`,
      });
    }
  });
}

/* ---------------------------------------------------------------------- cykl */

export const GOAL_METRICS = ['sets', 'duration', 'distance'] as const;
export type GoalMetric = (typeof GOAL_METRICS)[number];
export const goalMetricSchema = z.enum(GOAL_METRICS);

/**
 * Pozycja celu wskazuje **dokładnie jedno**: ćwiczenie, tag albo intensywność —
 * nigdy dwa i nigdy żadnego. Kształt z polami nullowalnymi, a nie unia, bo tak
 * wygląda wiersz w bazie po obu stronach synchronizacji.
 *
 * `stretchTarget` jest drugim, wyższym progiem tej samej pozycji. Wymóg „większy
 * od `target`" nie jest ozdobą: dwa poziomy, z których wyższy jest niżej,
 * pokazywałyby cykl ukończony na poziomie wyższym, zanim osiągnie minimalny.
 */
const cycleGoalFields = z.object({
  id: uuidSchema,
  metric: goalMetricSchema,
  /** Liczba serii, sekundy albo metry — zależnie od metryki. */
  target: z.int().positive(),
  /** Próg wyższy („dodatkowe korzyści zdrowotne" w cyklu WHO); `null` = jeden poziom. */
  stretchTarget: z.int().positive().nullable().default(null),
  exerciseId: uuidSchema.nullable(),
  tagId: uuidSchema.nullable(),
  intensity: intensitySchema.nullable().default(null),
});

const EXACTLY_ONE_SCOPE = {
  message: 'Pozycja celu musi wskazywać dokładnie jedno: ćwiczenie, tag albo intensywność',
} as const;

const RISING_LEVELS = {
  message: 'Próg wyższy musi być większy od minimalnego',
  path: ['stretchTarget'],
};

const hasExactlyOneScope = (goal: {
  exerciseId: string | null;
  tagId: string | null;
  intensity: string | null;
}): boolean =>
  [goal.exerciseId, goal.tagId, goal.intensity].filter((scope) => scope !== null).length === 1;

const hasRisingLevels = (goal: { target: number; stretchTarget: number | null }): boolean =>
  goal.stretchTarget === null || goal.stretchTarget > goal.target;

export const cycleGoalSchema = cycleGoalFields
  .refine(hasExactlyOneScope, EXACTLY_ONE_SCOPE)
  .refine(hasRisingLevels, RISING_LEVELS);

export type CycleGoal = z.infer<typeof cycleGoalSchema>;

/** Pozycja celu przed zapisem — identyfikator nadaje klient przy tworzeniu cyklu. */
export const cycleGoalInputSchema = cycleGoalFields
  .omit({ id: true })
  .refine(hasExactlyOneScope, EXACTLY_ONE_SCOPE)
  .refine(hasRisingLevels, RISING_LEVELS);

export type CycleGoalInput = z.infer<typeof cycleGoalInputSchema>;

/**
 * Pozycja celu tak, jak podaje ją wołający — pola z wartością domyślną wolno
 * pominąć. Kształt **przed** walidacją, więc to jego oczekują funkcje
 * przyjmujące cel do zapisania; `CycleGoalInput` jest tym, co z nich wychodzi.
 * Bez tego rozróżnienia każdy zwykły cel musiałby wypisywać `stretchTarget:
 * null, intensity: null` tylko po to, żeby przejść przez typy.
 */
export type CycleGoalDraft = z.input<typeof cycleGoalInputSchema>;

export const cycleSchema = z
  .object({
    id: uuidSchema,
    userId: uuidSchema,
    name: displayNameSchema,
    /** Reset cyklu to ustawienie nowej daty początku — historia zostaje. */
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullable(),
    archivedAt: isoDateTimeSchema.nullable(),
    goals: z.array(cycleGoalSchema).min(1),
  })
  .extend(syncFieldsSchema.shape)
  .refine((cycle) => cycle.endsOn === null || cycle.endsOn >= cycle.startsOn, {
    message: 'Koniec cyklu nie może wyprzedzać jego początku',
    path: ['endsOn'],
  });

export type Cycle = z.infer<typeof cycleSchema>;

export const createCycleInputSchema = z
  .object({
    name: displayNameSchema,
    startsOn: isoDateSchema,
    endsOn: isoDateSchema.nullable().default(null),
    goals: z.array(cycleGoalInputSchema).min(1),
  })
  .refine((cycle) => cycle.endsOn === null || cycle.endsOn >= cycle.startsOn, {
    message: 'Koniec cyklu nie może wyprzedzać jego początku',
    path: ['endsOn'],
  });

export type CreateCycleInput = z.infer<typeof createCycleInputSchema>;
