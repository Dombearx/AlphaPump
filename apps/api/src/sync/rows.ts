/**
 * Wiersze bazy w kształcie protokołu synchronizacji.
 *
 * Różnica względem `dto.ts` jest jedna, ale istotna: te kształty niosą
 * `serverSeq`. To on jest kursorem pobierania — telefon zapisuje go przy
 * wierszu i dzięki temu wie, czego już nie musi ściągać. Zwykłe DTO API go nie
 * wystawiają, bo poza synchronizacją jest wyłącznie szumem.
 */

import type {
  SyncedCycle,
  SyncedExercise,
  SyncedTag,
  SyncedUser,
  SyncedWorkoutSet,
  SyncRevision,
} from '@alphapump/core';
import type {
  CycleGoalRow,
  CycleRow,
  ExerciseRow,
  TagRow,
  UserRow,
  WorkoutSetRow,
} from '@alphapump/db/pg';
import { toCycleDto, toExerciseDto, toSetDto, toTagDto, toUserDto } from '../dto.js';

/** Wiersz w zakresie, który wystarcza do rozstrzygnięcia konfliktu. */
export function revisionOf(row: {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deviceId: string | null;
}): SyncRevision {
  return {
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
    deviceId: row.deviceId,
  };
}

/**
 * Konto w cache'u telefonu.
 *
 * Adres e-mail wychodzi wyłącznie do właściciela konta. Pull jedzie do każdego
 * urządzenia w grupie, a aplikacja nie potrzebuje cudzych adresów do niczego —
 * nick wystarcza przy rekordach globalnych i przy autorze ćwiczenia.
 */
export function toSyncedUserDto(row: UserRow, viewerId: string): SyncedUser {
  return {
    ...toUserDto(row),
    email: row.id === viewerId ? row.email : null,
    serverSeq: row.serverSeq,
  };
}

export function toSyncedTagDto(row: TagRow): SyncedTag {
  return { ...toTagDto(row), serverSeq: row.serverSeq };
}

export function toSyncedExerciseDto(row: ExerciseRow, additionalTagIds: string[]): SyncedExercise {
  return { ...toExerciseDto(row, additionalTagIds), serverSeq: row.serverSeq };
}

export function toSyncedSetDto(row: WorkoutSetRow): SyncedWorkoutSet {
  return { ...toSetDto(row), serverSeq: row.serverSeq };
}

export function toSyncedCycleDto(row: CycleRow, goals: CycleGoalRow[]): SyncedCycle {
  return { ...toCycleDto(row, goals), serverSeq: row.serverSeq };
}
