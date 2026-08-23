/**
 * Eksport danych z bazy lokalnej.
 *
 * Specyfikacja wymaga eksportu i importu danych w JSON-ie, a stack wymaga, żeby
 * była to **ta sama** ścieżka, którą chodzi systemowa kopia zapasowa. Format
 * i jego reguły mieszkają więc w `@alphapump/core`, a tutaj jest wyłącznie odczyt
 * z SQLite — plik z telefonu wchodzi do bazy serwera i odwrotnie, bo obie strony
 * czytają go tym samym schematem.
 *
 * Eksport działa **offline** i to jest jego główna zaleta względem `GET /export`.
 * Telefon ma u siebie całą historię właściciela, więc „wyjmij moje dane" nie
 * potrzebuje ani sieci, ani VPN-a.
 *
 * Zakres jest ten sam co po stronie serwera: serie i cykle właściciela, ćwiczenia,
 * których te dane dotykają lub których jest autorem, tagi tych ćwiczeń oraz
 * minimalne dane kont — bez nich `authorId` i właściciel serii wskazywaliby po
 * odtworzeniu w próżnię. Tombstone'y nie wchodzą: archiwum odtwarza stan, nie
 * historię usunięć.
 */

import {
  createArchive,
  type Archive,
  type ArchiveContent,
  type ArchiveUser,
  type Cycle,
  type Exercise,
  type Tag,
  type WorkoutSet,
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
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';

const instant = (value: Date): string => value.toISOString();
const nullableInstant = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

/**
 * Składa archiwum danych właściciela telefonu.
 *
 * Moment eksportu podaje wołający, tak jak w rdzeniu — dzięki temu test zna
 * z góry wartość `exportedAt` i nie musi jej pomijać w porównaniach.
 */
export async function exportLocalArchive(
  db: SqliteDatabase,
  userId: string,
  now: Date = new Date(),
): Promise<Archive> {
  const setRows = await db
    .select()
    .from(workoutSets)
    .where(and(eq(workoutSets.userId, userId), isNull(workoutSets.deletedAt)))
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position));

  const cycleRows = await db
    .select()
    .from(cycles)
    .where(and(eq(cycles.userId, userId), isNull(cycles.deletedAt)))
    .orderBy(asc(cycles.startsOn));

  const goalRows =
    cycleRows.length === 0
      ? []
      : await db
          .select()
          .from(cycleGoals)
          .where(
            inArray(
              cycleGoals.cycleId,
              cycleRows.map((row) => row.id),
            ),
          )
          .orderBy(asc(cycleGoals.position));

  const referencedExerciseIds = new Set<string>([
    ...setRows.map((row) => row.exerciseId),
    ...goalRows.flatMap((row) => (row.exerciseId === null ? [] : [row.exerciseId])),
  ]);

  // Ćwiczenia dotknięte danymi konta **oraz** ćwiczenia jego autorstwa: ćwiczenie
  // wymyślone i jeszcze nieużyte też jest danymi użytkownika.
  const allExercises = await db
    .select()
    .from(exercises)
    .where(isNull(exercises.deletedAt))
    .orderBy(asc(exercises.name));
  const exerciseRows = allExercises.filter(
    (row) => row.authorId === userId || referencedExerciseIds.has(row.id),
  );

  const linkRows =
    exerciseRows.length === 0
      ? []
      : await db
          .select()
          .from(exerciseTags)
          .where(
            inArray(
              exerciseTags.exerciseId,
              exerciseRows.map((row) => row.id),
            ),
          )
          .orderBy(asc(exerciseTags.position));

  const additionalByExercise = new Map<string, string[]>();
  for (const link of linkRows) {
    const bucket = additionalByExercise.get(link.exerciseId);
    if (bucket) bucket.push(link.tagId);
    else additionalByExercise.set(link.exerciseId, [link.tagId]);
  }

  const tagIds = new Set<string>([
    ...exerciseRows.map((row) => row.primaryTagId),
    ...linkRows.map((row) => row.tagId),
    ...goalRows.flatMap((row) => (row.tagId === null ? [] : [row.tagId])),
  ]);

  const tagRows =
    tagIds.size === 0
      ? []
      : (await db.select().from(tags).where(isNull(tags.deletedAt)).orderBy(asc(tags.name))).filter(
          (row) => tagIds.has(row.id),
        );

  const userIds = new Set<string>([userId, ...exerciseRows.map((row) => row.authorId)]);
  const userRows = (await db.select().from(users).orderBy(asc(users.email))).filter((row) =>
    userIds.has(row.id),
  );

  const content: ArchiveContent = {
    // Telefon nigdy nie eksportuje poświadczeń: baza lokalna ich nie zna, a plik
    // z eksportu użytkownik nosi u siebie. Poświadczenia wchodzą wyłącznie do
    // archiwum systemowego robionego na serwerze.
    credentials: [],
    users: userRows.map((row): ArchiveUser => ({
      id: row.id,
      email: row.email,
      nickname: row.nickname,
      role: row.role,
    })),
    tags: tagRows.map((row): Tag => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      color: row.color,
      translations: row.translations,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: null,
    })),
    exercises: exerciseRows.map((row): Exercise => ({
      id: row.id,
      name: row.name,
      slug: row.slug,
      authorId: row.authorId,
      loggingType: row.loggingType,
      primaryTagId: row.primaryTagId,
      additionalTagIds: additionalByExercise.get(row.id) ?? [],
      note: row.note,
      gym: row.gym,
      translations: row.translations,
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: null,
    })),
    sets: setRows.map((row): WorkoutSet => ({
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
      deletedAt: null,
    })),
    cycles: cycleRows.map((row): Cycle => ({
      id: row.id,
      userId: row.userId,
      name: row.name,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      archivedAt: nullableInstant(row.archivedAt),
      goals: goalRows
        .filter((goal) => goal.cycleId === row.id)
        .map((goal) => ({
          id: goal.id,
          metric: goal.metric,
          target: goal.target,
          exerciseId: goal.exerciseId,
          tagId: goal.tagId,
        })),
      createdAt: instant(row.createdAt),
      updatedAt: instant(row.updatedAt),
      deletedAt: null,
    })),
  };

  return createArchive(content, { scope: 'user', exportedAt: now });
}

/** Nazwa pliku eksportu — data w nazwie, tak jak w plikach kopii na Dysku. */
export function archiveFileName(now: Date = new Date()): string {
  return `alphapump-${now.toISOString().slice(0, 10)}.json`;
}
