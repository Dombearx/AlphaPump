/**
 * Zapytania ekranów.
 *
 * Funkcje zwracają **niewykonane** zapytania Drizzle, bo tego oczekuje
 * `useLiveQuery`: dostaje zapytanie, subskrybuje tabele, których dotyka,
 * i przerysowuje ekran po każdym zapisie. Zwrócenie gotowych danych zabrałoby
 * tę właściwość i wymusiłoby ręczne odświeżanie.
 *
 * Wszystko jedzie z bazy lokalnej. Nie ma tu warstwy stanu serwerowego, nie ma
 * cache'a do unieważniania i nie ma ekranu, który czeka na sieć.
 */

import type { IsoDate } from '@alphapump/core';
import { exercises, tags, users, workoutSets, type SqliteDatabase } from '@alphapump/db/sqlite';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';

/**
 * Serie jednego dnia wraz z opisem ćwiczenia.
 *
 * Zapytanie sortuje po pozycji, czyli po kolejności ustawionej przez
 * użytkownika. Podziału na ćwiczenia nie da się tu zrobić sensownie: pozycja
 * liczona jest w obrębie pary dzień + ćwiczenie, więc każde ćwiczenie zaczyna od
 * zera i samo sortowanie po niej pomieszałoby grupy. Grupowaniem zajmuje się
 * `groupDaySets` — na kilkudziesięciu wierszach dnia jest to tańsze niż
 * skorelowane podzapytanie po `min(created_at)` w każdym wierszu.
 */
export function daySets(db: SqliteDatabase, userId: string, day: IsoDate) {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      exerciseName: exercises.name,
      loggingType: exercises.loggingType,
      tagColor: tags.color,
      position: workoutSets.position,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      bodyweightG: workoutSets.bodyweightG,
      note: workoutSets.note,
      createdAt: workoutSets.createdAt,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(
      and(
        eq(workoutSets.userId, userId),
        eq(workoutSets.performedOn, day),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(asc(workoutSets.position), asc(workoutSets.id));
}

export type DaySetRow = Awaited<ReturnType<typeof daySets>>[number];

/** Ćwiczenie wykonane danego dnia razem ze swoimi seriami. */
export interface DayExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  loggingType: DaySetRow['loggingType'];
  tagColor: string;
  sets: DaySetRow[];
}

/**
 * Grupuje serie dnia po ćwiczeniu.
 *
 * Grupy idą w kolejności, w jakiej ćwiczenia zaczęto tego dnia wykonywać —
 * czyli tak, jak wyglądał trening. Wewnątrz grupy zostaje kolejność z zapytania,
 * czyli ta ustawiona przez użytkownika.
 */
export function groupDaySets(rows: readonly DaySetRow[]): DayExerciseGroup[] {
  const groups = new Map<string, DayExerciseGroup & { startedAt: number }>();

  for (const row of rows) {
    const existing = groups.get(row.exerciseId);
    if (existing) {
      existing.sets.push(row);
      existing.startedAt = Math.min(existing.startedAt, row.createdAt.getTime());
      continue;
    }

    groups.set(row.exerciseId, {
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      loggingType: row.loggingType,
      tagColor: row.tagColor,
      sets: [row],
      startedAt: row.createdAt.getTime(),
    });
  }

  return [...groups.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(({ startedAt: _startedAt, ...group }) => group);
}

/** Serie jednego ćwiczenia — cała historia użytkownika, w porządku chronologicznym. */
export function exerciseHistory(db: SqliteDatabase, userId: string, exerciseId: string) {
  return db
    .select()
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.userId, userId),
        eq(workoutSets.exerciseId, exerciseId),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position), asc(workoutSets.id));
}

/** Ćwiczenie z tagiem głównym i nickiem autora — nagłówek ekranu logowania. */
export function exerciseDetails(db: SqliteDatabase, exerciseId: string) {
  return db
    .select({
      id: exercises.id,
      name: exercises.name,
      loggingType: exercises.loggingType,
      note: exercises.note,
      tagName: tags.name,
      tagColor: tags.color,
      authorNickname: users.nickname,
    })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .innerJoin(users, eq(users.id, exercises.authorId))
    .where(eq(exercises.id, exerciseId))
    .limit(1);
}

export type ExerciseDetailsRow = Awaited<ReturnType<typeof exerciseDetails>>[number];

/**
 * Biblioteka do wyboru ćwiczenia, z licznikiem serii użytkownika.
 *
 * Licznik jest podzapytaniem, a nie złączeniem: złączenie z seriami rozmnożyłoby
 * wiersze ćwiczeń, a `GROUP BY` po całej bibliotece kosztowałby więcej niż
 * policzenie tego, o co pytamy. Ćwiczenia używane wcześniej idą na górę —
 * przy „możliwie najmniejszej liczbie kroków do zapisania serii" to zwykle one
 * są tym, czego użytkownik szuka.
 */
export function exerciseLibrary(db: SqliteDatabase, userId: string) {
  const usage = sql<number>`(
    select count(*) from ${workoutSets}
    where ${workoutSets.exerciseId} = ${exercises.id}
      and ${workoutSets.userId} = ${userId}
      and ${workoutSets.deletedAt} is null
  )`;

  const lastPerformedOn = sql<IsoDate | null>`(
    select max(${workoutSets.performedOn}) from ${workoutSets}
    where ${workoutSets.exerciseId} = ${exercises.id}
      and ${workoutSets.userId} = ${userId}
      and ${workoutSets.deletedAt} is null
  )`;

  return db
    .select({
      id: exercises.id,
      name: exercises.name,
      loggingType: exercises.loggingType,
      tagId: exercises.primaryTagId,
      tagName: tags.name,
      tagColor: tags.color,
      setCount: usage.as('set_count'),
      lastPerformedOn: lastPerformedOn.as('last_performed_on'),
    })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(isNull(exercises.deletedAt))
    .orderBy(sql`set_count desc`, asc(exercises.name));
}

export type LibraryRow = Awaited<ReturnType<typeof exerciseLibrary>>[number];

/** Konto właściciela urządzenia — nick pokazywany w nagłówku. */
export function localUser(db: SqliteDatabase, userId: string) {
  return db
    .select({ id: users.id, nickname: users.nickname, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
}
