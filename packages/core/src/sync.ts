/**
 * Protokół synchronizacji: rozstrzyganie konfliktów i kształt paczek.
 *
 * Reguły siedzą tutaj, a nie w kodzie serwera, z tego samego powodu co front
 * Pareto: telefon musi umieć przewidzieć rozstrzygnięcie **przed** wysłaniem
 * paczki, żeby nie pokazywać użytkownikowi wersji, którą serwer za chwilę
 * odrzuci. Dwie implementacje tej samej tabelki rozjechałyby się cicho.
 *
 * | Sytuacja                             | Rozstrzygnięcie                        |
 * | ------------------------------------ | -------------------------------------- |
 * | dwa urządzenia dodają różne wiersze  | suma — brak konfliktu z definicji      |
 * | dwa urządzenia edytują ten sam wiersz| LWW po `updatedAt`, remis po `deviceId`|
 * | jedno usuwa, drugie edytuje          | **usunięcie wygrywa**, niezależnie od czasu |
 *
 * Dodanie serii nie jest konfliktem, bo każda seria dostaje własne UUIDv7 już
 * na telefonie. Prawdziwy konflikt istnieje wyłącznie wtedy, gdy dwa urządzenia
 * dotkną wiersza o tym samym identyfikatorze.
 */

import { z } from 'zod';
import { v7 as uuidv7 } from 'uuid';
import { syncRejectionSchema } from './rejections.js';
import {
  cycleGoalSchema,
  cycleSchema,
  displayNameSchema,
  exerciseSchema,
  gymSchema,
  isoDateSchema,
  isoDateTimeSchema,
  loggingTypeSchema,
  noteSchema,
  setMeasurementsSchema,
  tagSchema,
  userSchema,
  uuidSchema,
  workoutSetSchema,
} from './schemas.js';

/* -------------------------------------------------------------- urządzenie */

/**
 * Identyfikator urządzenia. Nadawany raz, przy pierwszym uruchomieniu
 * aplikacji, i trzymany lokalnie — służy wyłącznie do rozstrzygania remisów
 * `updatedAt`, nie identyfikuje użytkownika.
 */
export function newDeviceId(): string {
  return uuidv7();
}

export const deviceIdSchema = uuidSchema;

/* -------------------------------------------------- znaczniki czasu i remisy */

const instantOf = (value: string): number => Date.parse(value);

/**
 * Przycina znacznik z przyszłości do „teraz" serwera.
 *
 * LWW opiera się na zegarze telefonu, a ten bywa przestawiony — bez przycinania
 * jedno urządzenie z zegarem o rok do przodu wygrywałoby **każdy** konflikt aż
 * do momentu, w którym reszta świata go dogoni.
 */
export function clampToNow(value: string, now: Date): string {
  const parsed = instantOf(value);
  if (Number.isNaN(parsed)) throw new RangeError(`Niepoprawny znacznik czasu: ${value}`);
  return new Date(Math.min(parsed, now.getTime())).toISOString();
}

/** Stan wiersza w zakresie, który wystarcza do rozstrzygnięcia konfliktu. */
export interface SyncRevision {
  /** Moment utworzenia encji. Odróżnia świadome odtworzenie od spóźnionej edycji. */
  createdAt: string;
  updatedAt: string;
  /** Tombstone — `null` znaczy „wiersz żyje". */
  deletedAt: string | null;
  /** Urządzenie ostatniego zapisu; `null` dla zapisów spoza synchronizacji. */
  deviceId: string | null;
}

export function clampRevision<T extends SyncRevision>(revision: T, now: Date): T {
  return {
    ...revision,
    createdAt: clampToNow(revision.createdAt, now),
    updatedAt: clampToNow(revision.updatedAt, now),
    deletedAt: revision.deletedAt === null ? null : clampToNow(revision.deletedAt, now),
  };
}

/**
 * Porządek LWW: najpierw `updatedAt`, przy remisie `deviceId`.
 *
 * Remis nie jest teoretyczny — dwa zapisy tej samej milisekundy zdarzają się
 * przy imporcie i przy zapisie wsadowym. Bez drugiego kryterium rozstrzygnięcie
 * zależałoby od kolejności pushy, więc urządzenia mogłyby zbiec się do różnych
 * wersji wiersza. `deviceId` daje ten sam wynik niezależnie od kolejności.
 */
export function compareRevisions(a: SyncRevision, b: SyncRevision): number {
  const byTime = instantOf(a.updatedAt) - instantOf(b.updatedAt);
  if (byTime !== 0) return byTime;

  const left = a.deviceId ?? '';
  const right = b.deviceId ?? '';
  return left < right ? -1 : left > right ? 1 : 0;
}

/* ------------------------------------------------------ rozstrzyganie konfliktu */

export const SYNC_DECISIONS = [
  /** Wiersza nie ma albo wraca do życia — zapisujemy przychodzącą wersję w całości. */
  'insert',
  /** Wersja przychodząca jest nowsza — wymieniamy pola wiersza. */
  'update',
  /** Przychodzi tombstone — usunięcie wygrywa, pól nie ruszamy. */
  'delete',
  /** LWW przegrane; na serwerze zostaje wersja dotychczasowa. */
  'stale',
  /** Wiersz jest usunięty na serwerze — edycja przegrywa z usunięciem. */
  'deleted',
  /** Obie strony mają ten sam stan; nie ma czego zapisywać. */
  'noop',
  /**
   * Wiersz nie wszedł z powodu uprawnień albo niespójnych danych.
   * `resolveSyncConflict` nigdy tego nie zwraca — to rozstrzygnięcie serwera,
   * podejmowane, zanim w ogóle dojdzie do porównywania wersji.
   */
  'rejected',
] as const;

export type SyncDecision = (typeof SYNC_DECISIONS)[number];

/** Czy rozstrzygnięcie oznacza zapis do bazy. */
export function isWrite(decision: SyncDecision): boolean {
  return decision === 'insert' || decision === 'update' || decision === 'delete';
}

/**
 * Rozstrzyga los jednego wiersza z paczki pushu.
 *
 * `existing` to wiersz na serwerze (`null`, gdy serwer go nie zna), `incoming`
 * to wersja z telefonu — **po** przycięciu znaczników z przyszłości.
 *
 * ## Dlaczego usunięcie ustępuje odtworzeniu
 *
 * „Usunięcie wygrywa niezależnie od czasu" rozstrzyga sytuację, w której jedno
 * urządzenie kasuje wiersz, a drugie równolegle go edytuje. Nie może jednak
 * znaczyć „usuniętego identyfikatora nie da się już nigdy użyć": identyfikatory
 * ćwiczeń i tagów są **deterministyczne**, więc skasowanie ćwiczenia „Przysiad"
 * blokowałoby jego ponowne dodanie na zawsze.
 *
 * Rozróżnia je `createdAt`. Spóźniona edycja niesie datę utworzenia sprzed
 * usunięcia — i przegrywa. Świadome odtworzenie encji niesie datę utworzenia
 * **późniejszą niż usunięcie** — i wraca do życia.
 */
export function resolveSyncConflict(
  existing: SyncRevision | null,
  incoming: SyncRevision,
): SyncDecision {
  if (existing === null) return 'insert';

  if (existing.deletedAt !== null) {
    if (incoming.deletedAt !== null) return 'noop';
    return instantOf(incoming.createdAt) > instantOf(existing.deletedAt) ? 'insert' : 'deleted';
  }

  if (incoming.deletedAt !== null) return 'delete';

  return compareRevisions(incoming, existing) > 0 ? 'update' : 'stale';
}

/* ------------------------------------------------------------- paczka pushu */

export const SYNC_ENTITIES = ['tag', 'exercise', 'cycle', 'set'] as const;

export type SyncEntity = (typeof SYNC_ENTITIES)[number];

export const syncEntitySchema = z.enum(SYNC_ENTITIES);

/** Pola wspólne dla każdego wiersza wysyłanego z telefonu. */
const pushRowFields = {
  /** Nadany na telefonie — deterministyczny dla tagów i ćwiczeń, UUIDv7 dla reszty. */
  id: uuidSchema,
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema,
  deletedAt: isoDateTimeSchema.nullable(),
};

export const tagPushSchema = z.object({
  ...pushRowFields,
  name: displayNameSchema,
});

export type TagPush = z.infer<typeof tagPushSchema>;

export const exercisePushSchema = z.object({
  ...pushRowFields,
  name: displayNameSchema,
  authorId: uuidSchema,
  loggingType: loggingTypeSchema,
  primaryTagId: uuidSchema,
  /** Zestaw tagów dodatkowych jedzie z ćwiczeniem i jest podmieniany w całości. */
  additionalTagIds: z.array(uuidSchema).default([]),
  note: noteSchema.nullable().default(null),
  gym: gymSchema.nullable().default(null),
});

export type ExercisePush = z.infer<typeof exercisePushSchema>;

/**
 * Seria bez `userId` — właścicielem jest zawsze uwierzytelniony użytkownik.
 * Pole w ciele żądania byłoby wyłącznie zaproszeniem do podszycia się.
 */
export const workoutSetPushSchema = z
  .object({
    ...pushRowFields,
    exerciseId: uuidSchema,
    performedOn: isoDateSchema,
    position: z.int().min(0),
    bodyweightG: z.int().min(0).nullable().default(null),
    note: noteSchema.nullable().default(null),
  })
  .extend(setMeasurementsSchema.shape);

export type WorkoutSetPush = z.infer<typeof workoutSetPushSchema>;

export const cyclePushSchema = z.object({
  ...pushRowFields,
  name: displayNameSchema,
  startsOn: isoDateSchema,
  endsOn: isoDateSchema.nullable().default(null),
  archivedAt: isoDateTimeSchema.nullable().default(null),
  /** Pozycje celu jadą z cyklem i są podmieniane w całości. */
  goals: z.array(cycleGoalSchema).min(1),
});

export type CyclePush = z.infer<typeof cyclePushSchema>;

/** Ile wierszy jednej encji przyjmujemy w jednej paczce. */
export const SYNC_PUSH_LIMIT = 500;

const pushBatch = <T extends z.ZodType>(schema: T) =>
  z.array(schema).max(SYNC_PUSH_LIMIT).default([]);

export const syncPushRequestSchema = z.object({
  deviceId: deviceIdSchema,
  tags: pushBatch(tagPushSchema),
  exercises: pushBatch(exercisePushSchema),
  cycles: pushBatch(cyclePushSchema),
  sets: pushBatch(workoutSetPushSchema),
});

export type SyncPushRequest = z.infer<typeof syncPushRequestSchema>;

/* ---------------------------------------------------------------- odpowiedzi */

export const syncResultSchema = z.object({
  entity: syncEntitySchema,
  id: uuidSchema,
  decision: z.enum(SYNC_DECISIONS),
  /**
   * Powód odrzucenia — wypełniany tylko wtedy, gdy wiersz nie wszedł.
   *
   * Kod, nie zdanie: zdanie buduje ta strona, która je pokazuje (patrz
   * `describeRejection`). Telefon może na tym oprzeć decyzję, czy w ogóle
   * warto ponawiać, zamiast dopasowywać napisy.
   */
  reason: syncRejectionSchema.nullable().default(null),
  /** Zmienna część komunikatu: lista identyfikatorów, nazwa, typ logowania. */
  reasonDetail: z.string().nullable().default(null),
});

export type SyncResult = z.infer<typeof syncResultSchema>;

/**
 * Wiersze schodzące na telefon. Niosą `serverSeq`, bo to on jest kursorem —
 * telefon zapisuje go przy wierszu i wie, czego już nie musi pobierać.
 */
const serverSeqField = { serverSeq: z.int().positive() };

/**
 * Konto w cache'u telefonu. `email` jest wypełniony wyłącznie dla właściciela
 * urządzenia — adresy pozostałych osób nie są aplikacji do niczego potrzebne,
 * a pull jedzie do każdego telefonu w grupie.
 */
export const syncedUserSchema = userSchema.extend({
  ...serverSeqField,
  email: z.email().nullable(),
});
export const syncedTagSchema = tagSchema.extend(serverSeqField);
export const syncedExerciseSchema = exerciseSchema.extend(serverSeqField);
export const syncedWorkoutSetSchema = workoutSetSchema.extend(serverSeqField);
export const syncedCycleSchema = cycleSchema.extend(serverSeqField);

export type SyncedUser = z.infer<typeof syncedUserSchema>;
export type SyncedTag = z.infer<typeof syncedTagSchema>;
export type SyncedExercise = z.infer<typeof syncedExerciseSchema>;
export type SyncedWorkoutSet = z.infer<typeof syncedWorkoutSetSchema>;
export type SyncedCycle = z.infer<typeof syncedCycleSchema>;

/**
 * Komplet wierszy w jednej odpowiedzi — ten sam kształt dla pushu i pullu.
 *
 * Dzięki temu telefon ma **jedną** ścieżkę zapisu: to, co wraca z pushu
 * (po przycięciu znaczników i rozstrzygnięciu konfliktów), stosuje dokładnie
 * tak samo jak to, co przywozi pull.
 */
export const syncChangesSchema = z.object({
  /** Cache użytkowników — telefon potrzebuje nicków przy rekordach globalnych. */
  users: z.array(syncedUserSchema).default([]),
  tags: z.array(syncedTagSchema).default([]),
  exercises: z.array(syncedExerciseSchema).default([]),
  cycles: z.array(syncedCycleSchema).default([]),
  sets: z.array(syncedWorkoutSetSchema).default([]),
});

export type SyncChanges = z.infer<typeof syncChangesSchema>;

export const syncPushResponseSchema = z.object({
  serverTime: isoDateTimeSchema,
  /**
   * Najwyższy `serverSeq` nadany w tym pushu; `0`, gdy nic nie weszło.
   *
   * **To nie jest kursor pullu.** Między kursorem telefonu a tą wartością mogą
   * leżeć wiersze innych osób, których urządzenie jeszcze nie widziało —
   * przesunięcie kursora tutaj przeskoczyłoby je bezpowrotnie. Wartość służy do
   * potwierdzenia, że paczka faktycznie coś zapisała.
   */
  cursor: z.int().min(0),
  results: z.array(syncResultSchema),
  /** Stan wierszy z paczki **po** rozstrzygnięciu — do wprost zastosowania lokalnie. */
  changes: syncChangesSchema,
});

export type SyncPushResponse = z.infer<typeof syncPushResponseSchema>;

/** Ile wierszy schodzi w jednej paczce pullu. */
export const SYNC_PULL_LIMIT = 500;

export const syncPullQuerySchema = z.object({
  /** Kursor: ostatni `serverSeq`, który telefon ma już u siebie. */
  since: z.coerce.number().int().min(0).default(0),
  limit: z.coerce.number().int().min(1).max(SYNC_PULL_LIMIT).default(SYNC_PULL_LIMIT),
});

export type SyncPullQuery = z.infer<typeof syncPullQuerySchema>;

export const syncPullResponseSchema = z.object({
  serverTime: isoDateTimeSchema,
  /** Nowy kursor telefonu. Równy `since`, gdy nie było nic nowego. */
  cursor: z.int().min(0),
  /** `true`, gdy paczka została ucięta limitem i trzeba pobrać kolejną. */
  hasMore: z.boolean(),
  changes: syncChangesSchema,
});

export type SyncPullResponse = z.infer<typeof syncPullResponseSchema>;
