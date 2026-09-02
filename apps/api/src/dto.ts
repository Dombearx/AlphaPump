/**
 * Zamiana wierszy bazy na kształt wystawiany przez API.
 *
 * Kształtem jest schemat z `@alphapump/core` — ten sam, którego używają
 * formularze w aplikacji i walidacja żądań. Dzięki temu „co API zwraca" i „co
 * aplikacja umie przeczytać" nie są dwiema niezależnymi definicjami, które
 * potrafią się rozjechać przy pierwszej dodanej kolumnie.
 *
 * Znaczniki czasu wychodzą jako napisy ISO-8601 ze strefą, dni treningowe jako
 * `YYYY-MM-DD` bez strefy — tak jak są trzymane w bazie.
 */

import {
  sanitizeAdditionalTagIds,
  sanitizeTranslations,
  type Cycle,
  type CycleGoal,
  type Exercise,
  type Tag,
  type User,
  type WorkoutSet,
} from '@alphapump/core';
import type {
  CycleGoalRow,
  CycleRow,
  ExerciseRow,
  TagRow,
  UserRow,
  WorkoutSetRow,
} from '@alphapump/db/pg';

const instant = (value: Date) => value.toISOString();
const nullableInstant = (value: Date | null) => (value === null ? null : value.toISOString());

/** Wiersze domenowe nie mają własnego `deletedAt` w tabeli użytkowników. */
export function toUserDto(row: UserRow): User {
  return {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    role: row.role,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: null,
  };
}

export function toTagDto(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    translations: sanitizeTranslations(row.translations),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  };
}

/**
 * Ćwiczenie w kształcie API.
 *
 * Zestaw tagów dodatkowych przechodzi tu przez `sanitizeAdditionalTagIds`
 * i jest to ta sama decyzja, co przy tłumaczeniach niżej. Ćwiczenia są globalne:
 * jeden wiersz, w którym tag główny powtarza się wśród dodatkowych — bo tak
 * zostawiła go ścieżka zapisu naprawiona dopiero w kolejnym wydaniu albo ręczna
 * zmiana w bazie — nie przechodzi przez `exerciseSchema` u odbiorcy i wywala
 * parsowanie **całej** odpowiedzi. Panel przestaje się otwierać, a telefony
 * stają na „Pull response has an unknown shape" i nie ruszą, dopóki ktoś nie
 * poprawi bazy ręcznie.
 *
 * Odsianie tutaj tego nie naprawia — ono odbiera temu jednemu wierszowi moc
 * zatrzymania wszystkiego. Naprawą jest `/admin/integrity`, gdzie ten sam
 * konflikt jest wypisany razem z tym, co zrobi przycisk „Napraw".
 */
export function toExerciseDto(row: ExerciseRow, additionalTagIds: string[]): Exercise {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    authorId: row.authorId,
    loggingType: row.loggingType,
    primaryTagId: row.primaryTagId,
    additionalTagIds: sanitizeAdditionalTagIds(row.primaryTagId, additionalTagIds),
    note: row.note,
    gym: row.gym,
    translations: sanitizeTranslations(row.translations),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  };
}

export function toSetDto(row: WorkoutSetRow): WorkoutSet {
  return {
    id: row.id,
    userId: row.userId,
    exerciseId: row.exerciseId,
    performedOn: row.performedOn,
    position: row.position,
    weightG: row.weightG,
    reps: row.reps,
    durationS: row.durationS,
    distanceM: row.distanceM,
    bodyweightG: row.bodyweightG,
    note: row.note,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  };
}

export function toCycleGoalDto(row: CycleGoalRow): CycleGoal {
  return {
    id: row.id,
    metric: row.metric,
    target: row.target,
    exerciseId: row.exerciseId,
    tagId: row.tagId,
  };
}

export function toCycleDto(row: CycleRow, goals: CycleGoalRow[]): Cycle {
  return {
    id: row.id,
    userId: row.userId,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    archivedAt: nullableInstant(row.archivedAt),
    goals: goals.map(toCycleGoalDto),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
  };
}
