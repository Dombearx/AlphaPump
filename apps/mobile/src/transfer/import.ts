/**
 * Import archiwum do bazy lokalnej.
 *
 * Trzy rzeczy odróżniają ten import od serwerowego i wszystkie trzy wynikają
 * z tego, czym jest telefon:
 *
 * 1. **Zapisujemy wyłącznie dane właściciela telefonu.** Baza lokalna jest
 *    jednoosobowa: trzyma serie jednej osoby, a konta innych wyłącznie jako cache
 *    nicków. Wiersze cudze są pomijane i zliczone w raporcie.
 * 2. **Każdy zapisany wiersz ląduje w outboxie.** Bez tego import byłby lokalną
 *    ciekawostką: dane wróciłyby na ekran i zniknęły przy pierwszym pullu, bo
 *    serwer o nich nie wie. Kolejkowanie sprawia, że import na telefonie jest
 *    równoważny importowi na serwerze — tylko asynchroniczny.
 * 3. **Nie ma `server_seq`.** Wiersz przywrócony lokalnie jeszcze go nie ma
 *    i mieć nie może; nada go serwer, gdy przyjmie push.
 *
 * Reguła rozstrzygania konfliktów jest **ta sama** co przy synchronizacji:
 * `resolveSyncConflict` z rdzenia. Import nie cofa więc danych nowszych niż plik,
 * a wiersz usunięty po eksporcie nie wraca do życia tylko dlatego, że jest
 * w pliku. Druga implementacja LWW byłaby dokładnie tym rodzajem rozjazdu, który
 * ten projekt konsekwentnie eliminuje.
 *
 * Tłumaczenie identyfikatorów (dopasowanie konta po e-mailu i przeliczenie
 * identyfikatorów ćwiczeń) robi `planArchiveIdentity` z rdzenia — ta sama funkcja,
 * której używa serwer.
 */

import {
  findArchiveProblems,
  isWrite,
  planArchiveIdentity,
  resolveSyncConflict,
  type Archive,
  type ArchiveSummary,
  type SyncRevision,
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
import { withTransaction } from '../db/transaction';
import { enqueue } from '../sync/outbox';

export class ArchiveRejectedError extends Error {
  readonly problems: string[];

  constructor(message: string, problems: string[] = []) {
    super(message);
    this.name = 'ArchiveRejectedError';
    this.problems = problems;
  }
}

export interface LocalImportOptions {
  /** Konto właściciela telefonu — jego dane wchodzą, cudze nie. */
  userId: string;
  email: string;
  deviceId: string;
  now?: Date;
}

export interface LocalImportReport {
  imported: ArchiveSummary;
  skipped: ArchiveSummary;
  /** Ćwiczenia, którym po dopasowaniu konta zmienił się identyfikator. */
  remappedExercises: number;
  notes: string[];
}

const emptySummary = (): ArchiveSummary => ({
  users: 0,
  tags: 0,
  exercises: 0,
  sets: 0,
  cycles: 0,
});

const instant = (value: string): Date => new Date(value);

/** Wiersz lokalny sprowadzony do tego, co rozstrzyga konflikt. */
const localRevision = (row: {
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  deviceId: string | null;
}): SyncRevision => ({
  createdAt: row.createdAt.toISOString(),
  updatedAt: row.updatedAt.toISOString(),
  deletedAt: row.deletedAt === null ? null : row.deletedAt.toISOString(),
  deviceId: row.deviceId,
});

/**
 * Wiersz z archiwum. `deviceId` jest tym urządzeniem, które importuje — to ono
 * odpowiada za tę wersję wiersza, a przy remisie `updatedAt` daje rozstrzygnięcie
 * deterministyczne.
 */
const archiveRevision = (
  row: { createdAt: string; updatedAt: string; deletedAt: string | null },
  deviceId: string,
): SyncRevision => ({ ...row, deviceId });

export async function importLocalArchive(
  db: SqliteDatabase,
  archive: Archive,
  options: LocalImportOptions,
): Promise<LocalImportReport> {
  const now = options.now ?? new Date();
  const { deviceId } = options;

  const problems = findArchiveProblems(archive);
  if (problems.length > 0) {
    throw new ArchiveRejectedError(
      "The archive is inconsistent — it can't be restored",
      problems.map((problem) => `${problem.entity} ${problem.id}: ${problem.message}`),
    );
  }

  // Baza lokalna zna adresy kont z cache'u, ale rozstrzygające jest jedno:
  // właściciel telefonu. To on jest „znanym" kontem, na które tłumaczy się konto
  // z archiwum o tym samym adresie.
  const known = new Map<string, string>([[options.email.toLowerCase(), options.userId]]);
  for (const row of await db.select().from(users)) {
    // Adres ma tu tylko właściciel telefonu; reszta kont jest cache'em nicków.
    if (row.email === null) continue;
    if (!known.has(row.email.toLowerCase())) known.set(row.email.toLowerCase(), row.id);
  }

  const plan = planArchiveIdentity(archive, known);
  const imported = emptySummary();
  const skipped = emptySummary();
  const notes = new Set<string>();

  // Konta z archiwum, których telefon nie zna, nie są zakładane: tabela kont jest
  // tu cache'em nicków, który wypełnia pull. Ich dane po prostu nie wejdą.
  const unresolved = plan.missingUsers.filter((user) => plan.userIdMap.get(user.id) === user.id);
  for (const user of unresolved) plan.userIdMap.delete(user.id);
  skipped.users = archive.users.length;

  if (unresolved.length > 0) {
    notes.add('Skipped data for accounts not present on this device.');
  }

  await withTransaction(
    db,
    async () => {
      /* ------------------------------------------------------------------ tagi */

      for (const tag of archive.tags) {
        const [local] = await db.select().from(tags).where(eq(tags.id, tag.id)).limit(1);
        const decision = resolveSyncConflict(
          local ? localRevision(local) : null,
          archiveRevision(tag, deviceId),
        );
        if (!isWrite(decision)) continue;

        const values = {
          id: tag.id,
          name: tag.name,
          slug: tag.slug,
          color: tag.color,
          createdAt: instant(tag.createdAt),
          updatedAt: instant(tag.updatedAt),
          deletedAt: null,
          deviceId,
        };
        await db.insert(tags).values(values).onConflictDoUpdate({ target: tags.id, set: values });
        await enqueue(db, 'tag', tag.id, now);
        imported.tags += 1;
      }

      /* ------------------------------------------------------------- ćwiczenia */

      const writtenExerciseIds = new Set<string>();

      for (const exercise of archive.exercises) {
        const authorId = plan.userIdMap.get(exercise.authorId);
        const id = plan.exerciseIdMap.get(exercise.id);
        if (authorId === undefined || id === undefined) {
          skipped.exercises += 1;
          continue;
        }

        const [local] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);

        // Ćwiczenie cudzego autora, którego nie ma w bibliotece lokalnej, wchodzi
        // — biblioteka jest wspólna, a bez niego serie właściciela nie miałyby na
        // co wskazywać. Zmiany cudzego ćwiczenia, które już jest, nie forsujemy:
        // rozstrzyga zwykłe LWW, tak jak przy pullu.
        const decision = resolveSyncConflict(
          local ? localRevision(local) : null,
          archiveRevision(exercise, deviceId),
        );
        if (!isWrite(decision)) {
          writtenExerciseIds.add(id);
          continue;
        }

        const values = {
          id,
          name: exercise.name,
          slug: exercise.slug,
          authorId,
          // Typ logowania jest ustalany raz; przy istniejącym wierszu zostaje ten
          // z bazy, bo historyczne serie już do niego pasują.
          loggingType: local?.loggingType ?? exercise.loggingType,
          primaryTagId: exercise.primaryTagId,
          note: exercise.note,
          createdAt: instant(exercise.createdAt),
          updatedAt: instant(exercise.updatedAt),
          deletedAt: null,
          deviceId,
        };
        await db
          .insert(exercises)
          .values(values)
          .onConflictDoUpdate({ target: exercises.id, set: values });

        await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, id));
        if (exercise.additionalTagIds.length > 0) {
          await db.insert(exerciseTags).values(
            exercise.additionalTagIds.map((tagId, position) => ({
              exerciseId: id,
              tagId,
              position,
            })),
          );
        }

        // W outbox wchodzą wyłącznie ćwiczenia, których autorem jest właściciel
        // telefonu — serwer i tak odrzuciłby cudze, bo zmieniać może je tylko
        // autor albo administrator.
        if (authorId === options.userId) await enqueue(db, 'exercise', id, now);
        writtenExerciseIds.add(id);
        imported.exercises += 1;
      }

      /* ----------------------------------------------------------------- serie */

      for (const set of archive.sets) {
        const userId = plan.userIdMap.get(set.userId);
        const exerciseId = plan.exerciseIdMap.get(set.exerciseId);

        if (
          userId !== options.userId ||
          exerciseId === undefined ||
          !writtenExerciseIds.has(exerciseId)
        ) {
          skipped.sets += 1;
          continue;
        }

        const [local] = await db
          .select()
          .from(workoutSets)
          .where(eq(workoutSets.id, set.id))
          .limit(1);
        const decision = resolveSyncConflict(
          local ? localRevision(local) : null,
          archiveRevision(set, deviceId),
        );
        if (!isWrite(decision)) continue;

        const values = {
          id: set.id,
          userId,
          exerciseId,
          performedOn: set.performedOn,
          position: set.position,
          weightG: set.weightG,
          reps: set.reps,
          durationS: set.durationS,
          distanceM: set.distanceM,
          bodyweightG: set.bodyweightG,
          note: set.note,
          createdAt: instant(set.createdAt),
          updatedAt: instant(set.updatedAt),
          deletedAt: null,
          deviceId,
        };
        await db
          .insert(workoutSets)
          .values(values)
          .onConflictDoUpdate({ target: workoutSets.id, set: values });
        await enqueue(db, 'set', set.id, now);
        imported.sets += 1;
      }

      /* ----------------------------------------------------------------- cykle */

      for (const cycle of archive.cycles) {
        const userId = plan.userIdMap.get(cycle.userId);
        const goalsResolvable = cycle.goals.every((goal) => {
          if (goal.exerciseId === null) return true;
          const mapped = plan.exerciseIdMap.get(goal.exerciseId);
          return mapped !== undefined && writtenExerciseIds.has(mapped);
        });

        if (userId !== options.userId || !goalsResolvable) {
          skipped.cycles += 1;
          continue;
        }

        const [local] = await db.select().from(cycles).where(eq(cycles.id, cycle.id)).limit(1);
        const decision = resolveSyncConflict(
          local ? localRevision(local) : null,
          archiveRevision(cycle, deviceId),
        );
        if (!isWrite(decision)) continue;

        const values = {
          id: cycle.id,
          userId,
          name: cycle.name,
          startsOn: cycle.startsOn,
          endsOn: cycle.endsOn,
          archivedAt: cycle.archivedAt === null ? null : instant(cycle.archivedAt),
          createdAt: instant(cycle.createdAt),
          updatedAt: instant(cycle.updatedAt),
          deletedAt: null,
          deviceId,
        };
        await db
          .insert(cycles)
          .values(values)
          .onConflictDoUpdate({ target: cycles.id, set: values });

        await db.delete(cycleGoals).where(eq(cycleGoals.cycleId, cycle.id));
        await db.insert(cycleGoals).values(
          cycle.goals.map((goal, position) => ({
            id: goal.id,
            cycleId: cycle.id,
            metric: goal.metric,
            target: goal.target,
            exerciseId:
              goal.exerciseId === null ? null : (plan.exerciseIdMap.get(goal.exerciseId) ?? null),
            tagId: goal.tagId,
            position,
          })),
        );

        await enqueue(db, 'cycle', cycle.id, now);
        imported.cycles += 1;
      }
    },
    // Paczka nie jest posortowana topologicznie — seria potrafi wyprzedzić własne
    // ćwiczenie. Odroczenie kluczy obcych do `COMMIT` rozwiązuje to bez
    // osłabiania więzów: niespójność, której nic w paczce nie domyka, dalej nie
    // przechodzi.
    { deferForeignKeys: true },
  );

  if (skipped.sets > 0) {
    notes.add('Skipped sets belonging to another account or pointing to an unknown exercise.');
  }
  if (skipped.exercises > 0) {
    notes.add("Skipped exercises whose author isn't on this device.");
  }

  return {
    imported,
    skipped,
    remappedExercises: plan.remappedExerciseIds.length,
    notes: [...notes],
  };
}
