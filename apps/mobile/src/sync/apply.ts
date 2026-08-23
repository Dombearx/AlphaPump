/**
 * Zapisywanie paczki zmian do bazy lokalnej.
 *
 * Jedna ścieżka dla obu kierunków: to, co wraca z pushu, i to, co przywozi pull,
 * ma ten sam kształt (`SyncChanges`) i przechodzi przez ten sam kod. Dwie
 * ścieżki zapisu znaczyłyby dwa miejsca, w których można zapomnieć o kolumnie.
 *
 * ## Dlaczego przychodzący wiersz nie zawsze wygrywa
 *
 * Kusi, żeby po prostu nadpisać wiersz tym, co przyszło z serwera — w końcu to
 * serwer rozstrzyga konflikty. Rzecz w tym, że między złożeniem paczki pushu
 * a zapisaniem odpowiedzi użytkownik zdąży edytować tę samą serię: odpowiedź
 * niesie wtedy stan **sprzed** jego edycji i nadpisanie cofnęłoby mu zmianę na
 * ekranie. Ta edycja czeka już w outboxie, więc dojedzie następną paczką —
 * ale do tego czasu ekran pokazywałby coś, czego użytkownik nie napisał.
 *
 * Dlatego każdy wiersz przechodzi przez `resolveSyncConflict` z `@alphapump/core`
 * — **tę samą** funkcję, którą serwer rozstrzyga pushe. Reguły są symetryczne:
 * nowsza wersja wygrywa, usunięcie bije edycję, a świadome odtworzenie encji
 * (data utworzenia późniejsza niż usunięcie) wraca do życia.
 *
 * Wiersz, który przegrał, i tak dostaje `server_seq`. Numer opisuje wersję
 * serwera, a nie treść lokalną — a bez niego urządzenie nie wiedziałoby, że
 * serwer w ogóle o tym wierszu wie.
 *
 * ## Transakcja
 *
 * Funkcja **nie otwiera transakcji sama**. Wywołanie musi ją opakować razem
 * z przesunięciem kursora (`writeCursor`) i ustawić `defer_foreign_keys`, bo
 * paczka jest posortowana po `server_seq`, czyli chronologicznie względem
 * zapisu na serwerze — seria potrafi wyprzedzić własne ćwiczenie.
 */

import {
  resolveSyncConflict,
  isWrite,
  type SyncChanges,
  type SyncRevision,
  type SyncedCycle,
  type SyncedExercise,
  type SyncedTag,
  type SyncedUser,
  type SyncedWorkoutSet,
} from '@alphapump/core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';

export interface ApplyOutcome {
  /** Wiersze zapisane do bazy. */
  written: number;
  /** Wiersze, które przegrały rozstrzygnięcie — została wersja lokalna. */
  kept: number;
}

const instant = (value: string): Date => new Date(value);
const nullableInstant = (value: string | null): Date | null =>
  value === null ? null : new Date(value);

/** Wiersz lokalny sprowadzony do tego, co rozstrzyga konflikt. */
function localRevision(row: {
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
 * Wiersz przychodzący. `deviceId` jest pusty, bo serwer go nie odsyła — przy
 * remisie `updatedAt` liczy się wtedy porządek napisów, w którym `null` (czyli
 * pusty napis) przegrywa z każdym identyfikatorem urządzenia. To jest właściwe
 * rozstrzygnięcie: przy dokładnym remisie zostaje wersja lokalna, więc ekran się
 * nie miga.
 */
function incomingRevision(row: {
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}): SyncRevision {
  return { ...row, deviceId: null };
}

export async function applyChanges(
  db: SqliteDatabase,
  changes: SyncChanges,
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { written: 0, kept: 0 };

  for (const row of changes.users) await applyUser(db, row, outcome);
  for (const row of changes.tags) await applyTag(db, row, outcome);
  for (const row of changes.exercises) await applyExercise(db, row, outcome);
  for (const row of changes.cycles) await applyCycle(db, row, outcome);
  for (const row of changes.sets) await applySet(db, row, outcome);

  return outcome;
}

/* --------------------------------------------------------------- użytkownicy */

/**
 * Konta są w bazie lokalnej cache'em — telefon potrzebuje nicków przy autorze
 * ćwiczenia i przy rekordach globalnych. Nikt ich lokalnie nie edytuje poza
 * zapisem własnego konta przy logowaniu, więc wersja serwerowa wygrywa zawsze
 * poza dokładnym remisem.
 */
async function applyUser(
  db: SqliteDatabase,
  row: SyncedUser,
  outcome: ApplyOutcome,
): Promise<void> {
  const [local] = await db.select().from(users).where(eq(users.id, row.id)).limit(1);
  const decision = resolveSyncConflict(local ? localRevision(local) : null, incomingRevision(row));

  if (!isWrite(decision)) {
    if (local) await db.update(users).set({ serverSeq: row.serverSeq }).where(eq(users.id, row.id));
    outcome.kept += 1;
    return;
  }

  const values = {
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    role: row.role,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
    serverSeq: row.serverSeq,
  };

  await db.insert(users).values(values).onConflictDoUpdate({ target: users.id, set: values });
  outcome.written += 1;
}

/* ---------------------------------------------------------------------- tagi */

async function applyTag(db: SqliteDatabase, row: SyncedTag, outcome: ApplyOutcome): Promise<void> {
  const [local] = await db.select().from(tags).where(eq(tags.id, row.id)).limit(1);
  const decision = resolveSyncConflict(local ? localRevision(local) : null, incomingRevision(row));

  if (!isWrite(decision)) {
    if (local) await db.update(tags).set({ serverSeq: row.serverSeq }).where(eq(tags.id, row.id));
    outcome.kept += 1;
    return;
  }

  const values = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    color: row.color,
    translations: row.translations,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
    serverSeq: row.serverSeq,
  };

  await db.insert(tags).values(values).onConflictDoUpdate({ target: tags.id, set: values });
  outcome.written += 1;
}

/* ----------------------------------------------------------------- ćwiczenia */

/**
 * Tagi dodatkowe jadą z ćwiczeniem i są podmieniane w całości — dokładnie tak,
 * jak robi to serwer. Różnicowanie zbioru dawałoby ten sam wynik za cenę
 * drugiego miejsca, w którym można się pomylić.
 */
async function applyExercise(
  db: SqliteDatabase,
  row: SyncedExercise,
  outcome: ApplyOutcome,
): Promise<void> {
  const [local] = await db.select().from(exercises).where(eq(exercises.id, row.id)).limit(1);
  const decision = resolveSyncConflict(local ? localRevision(local) : null, incomingRevision(row));

  if (!isWrite(decision)) {
    if (local) {
      await db.update(exercises).set({ serverSeq: row.serverSeq }).where(eq(exercises.id, row.id));
    }
    outcome.kept += 1;
    return;
  }

  const values = {
    id: row.id,
    name: row.name,
    slug: row.slug,
    authorId: row.authorId,
    loggingType: row.loggingType,
    primaryTagId: row.primaryTagId,
    note: row.note,
    gym: row.gym,
    translations: row.translations,
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
    serverSeq: row.serverSeq,
  };

  await db
    .insert(exercises)
    .values(values)
    .onConflictDoUpdate({ target: exercises.id, set: values });

  await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, row.id));
  if (row.additionalTagIds.length > 0) {
    await db.insert(exerciseTags).values(
      row.additionalTagIds.map((tagId, position) => ({
        exerciseId: row.id,
        tagId,
        position,
      })),
    );
  }

  outcome.written += 1;
}

/* --------------------------------------------------------------------- cykle */

async function applyCycle(
  db: SqliteDatabase,
  row: SyncedCycle,
  outcome: ApplyOutcome,
): Promise<void> {
  const [local] = await db.select().from(cycles).where(eq(cycles.id, row.id)).limit(1);
  const decision = resolveSyncConflict(local ? localRevision(local) : null, incomingRevision(row));

  if (!isWrite(decision)) {
    if (local)
      await db.update(cycles).set({ serverSeq: row.serverSeq }).where(eq(cycles.id, row.id));
    outcome.kept += 1;
    return;
  }

  const values = {
    id: row.id,
    userId: row.userId,
    name: row.name,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    archivedAt: nullableInstant(row.archivedAt),
    createdAt: instant(row.createdAt),
    updatedAt: instant(row.updatedAt),
    deletedAt: nullableInstant(row.deletedAt),
    serverSeq: row.serverSeq,
  };

  await db.insert(cycles).values(values).onConflictDoUpdate({ target: cycles.id, set: values });

  await db.delete(cycleGoals).where(eq(cycleGoals.cycleId, row.id));
  if (row.goals.length > 0) {
    await db.insert(cycleGoals).values(
      row.goals.map((goal, position) => ({
        id: goal.id,
        cycleId: row.id,
        metric: goal.metric,
        target: goal.target,
        exerciseId: goal.exerciseId,
        tagId: goal.tagId,
        position,
      })),
    );
  }

  outcome.written += 1;
}

/* --------------------------------------------------------------------- serie */

async function applySet(
  db: SqliteDatabase,
  row: SyncedWorkoutSet,
  outcome: ApplyOutcome,
): Promise<void> {
  const [local] = await db.select().from(workoutSets).where(eq(workoutSets.id, row.id)).limit(1);
  const decision = resolveSyncConflict(local ? localRevision(local) : null, incomingRevision(row));

  if (!isWrite(decision)) {
    if (local) {
      await db
        .update(workoutSets)
        .set({ serverSeq: row.serverSeq })
        .where(eq(workoutSets.id, row.id));
    }
    outcome.kept += 1;
    return;
  }

  const values = {
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
    serverSeq: row.serverSeq,
  };

  await db
    .insert(workoutSets)
    .values(values)
    .onConflictDoUpdate({ target: workoutSets.id, set: values });
  outcome.written += 1;
}
