/**
 * Cykle w bazie lokalnej — definicja, reset, archiwum.
 *
 * Postępu **nie zapisujemy nigdzie**. Jest daną pochodną, liczoną z serii przez
 * `computeCycleProgress` z rdzenia (patrz `src/cycle-progress.ts`). To nie jest
 * oszczędność miejsca, tylko warunek poprawności całego etapu 9: skoro postęp
 * liczy się od zera przy każdym odczycie, usunięcie serii po prostu go
 * zmniejsza — bez korekt wstecznych, bez licznika, który potrafi rozjechać się
 * z rzeczywistością po nieudanej synchronizacji.
 *
 * Pozycje celu jadą razem z cyklem: kolejka wysyłki dostaje wpis o **cyklu**,
 * nawet gdy zmieniła się tylko pozycja, bo tak wygląda paczka pushu i tak
 * podmienia je serwer. `cycle_goals` nie jest osobną encją synchronizacji.
 *
 * Reset to przesunięcie początku liczenia, nie skasowanie dorobku. Serie
 * zostają nietknięte, więc poprzedni okres da się przeliczyć w każdej chwili —
 * robi to `previousCyclePeriod` z rdzenia.
 */

import {
  createCycleInputSchema,
  newCycleGoalId,
  newCycleId,
  resetCycleRange,
  type CycleGoalInput,
  type IsoDate,
} from '@alphapump/core';
import { cycleGoals, cycles, type CycleRow, type SqliteDatabase } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { enqueue } from '../sync/outbox';
import { withTransaction } from './transaction';

export interface CycleAuthor {
  userId: string;
  deviceId: string;
}

export interface CycleValues {
  name: string;
  startsOn: IsoDate;
  endsOn: IsoDate | null;
  goals: CycleGoalInput[];
}

export class CycleNotFoundError extends Error {
  constructor(cycleId: string) {
    super(`No cycle with ID ${cycleId}`);
    this.name = 'CycleNotFoundError';
  }
}

/**
 * Podmienia komplet pozycji celu.
 *
 * Identyfikatory pozycji są nadawane od nowa przy każdej edycji i to jest
 * świadome: pozycja nie jest osobną encją synchronizacji, nikt na nią nie
 * wskazuje, a próba dopasowania „tej samej" pozycji po metryce i zakresie
 * dawałaby tę samą treść za cenę reguły, którą trzeba by pamiętać.
 */
async function replaceGoals(
  db: SqliteDatabase,
  cycleId: string,
  goals: readonly CycleGoalInput[],
): Promise<void> {
  await db.delete(cycleGoals).where(eq(cycleGoals.cycleId, cycleId));
  await db.insert(cycleGoals).values(
    goals.map((goal, position) => ({
      id: newCycleGoalId(),
      cycleId,
      metric: goal.metric,
      target: goal.target,
      exerciseId: goal.exerciseId,
      tagId: goal.tagId,
      position,
    })),
  );
}

export async function createCycle(
  db: SqliteDatabase,
  command: CycleAuthor & CycleValues,
  now: Date = new Date(),
): Promise<string> {
  const input = createCycleInputSchema.parse({
    name: command.name,
    startsOn: command.startsOn,
    endsOn: command.endsOn,
    goals: command.goals,
  });

  const id = newCycleId();

  await withTransaction(db, async () => {
    await db.insert(cycles).values({
      id,
      userId: command.userId,
      name: input.name,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      createdAt: now,
      updatedAt: now,
      deviceId: command.deviceId,
    });

    await replaceGoals(db, id, input.goals);
    await enqueue(db, 'cycle', id, now);
  });

  return id;
}

export interface UpdateCycleCommand extends CycleAuthor, Partial<CycleValues> {
  cycleId: string;
}

export async function updateCycle(
  db: SqliteDatabase,
  command: UpdateCycleCommand,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadCycle(db, command.cycleId, command.userId);

  // Walidujemy stan **po** zmianie, a nie samą łatkę: warunek „koniec nie
  // wyprzedza początku" dotyczy pary dat, z których jedna bywa nietknięta.
  const input = createCycleInputSchema.parse({
    name: command.name ?? existing.name,
    startsOn: command.startsOn ?? existing.startsOn,
    endsOn: command.endsOn === undefined ? existing.endsOn : command.endsOn,
    goals: command.goals ?? (await loadGoalInputs(db, existing.id)),
  });

  await withTransaction(db, async () => {
    await db
      .update(cycles)
      .set({
        name: input.name,
        startsOn: input.startsOn,
        endsOn: input.endsOn,
        updatedAt: now,
        deviceId: command.deviceId,
      })
      .where(eq(cycles.id, existing.id));

    if (command.goals !== undefined) await replaceGoals(db, existing.id, input.goals);
    await enqueue(db, 'cycle', existing.id, now);
  });
}

/**
 * Reset — nowa data początku liczenia. Koniec przesuwa się o tyle samo, więc
 * cel miesięczny po resecie dalej trwa miesiąc. Serii nie ruszamy: to one są
 * historią i to z nich liczy się realizacja poprzedniego okresu.
 */
export async function resetCycle(
  db: SqliteDatabase,
  cycleId: string,
  startsOn: IsoDate,
  author: CycleAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadCycle(db, cycleId, author.userId);
  const range = resetCycleRange(existing, startsOn);

  await withTransaction(db, async () => {
    await db
      .update(cycles)
      .set({
        startsOn: range.startsOn,
        endsOn: range.endsOn,
        // Reset wraca cyklem do gry, także wtedy, gdy leżał w archiwum.
        archivedAt: null,
        updatedAt: now,
        deviceId: author.deviceId,
      })
      .where(eq(cycles.id, existing.id));

    await enqueue(db, 'cycle', existing.id, now);
  });
}

export async function setCycleArchived(
  db: SqliteDatabase,
  cycleId: string,
  archived: boolean,
  author: CycleAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadCycle(db, cycleId, author.userId);

  await withTransaction(db, async () => {
    await db
      .update(cycles)
      .set({ archivedAt: archived ? now : null, updatedAt: now, deviceId: author.deviceId })
      .where(eq(cycles.id, existing.id));

    await enqueue(db, 'cycle', existing.id, now);
  });
}

/** Usunięcie miękkie — bez tombstone'a nie miałoby jak dojechać na serwer. */
export async function deleteCycle(
  db: SqliteDatabase,
  cycleId: string,
  author: CycleAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadCycle(db, cycleId, author.userId);

  await withTransaction(db, async () => {
    await db
      .update(cycles)
      .set({ deletedAt: now, updatedAt: now, deviceId: author.deviceId })
      .where(eq(cycles.id, existing.id));

    await enqueue(db, 'cycle', existing.id, now);
  });
}

async function loadCycle(db: SqliteDatabase, cycleId: string, userId: string): Promise<CycleRow> {
  const [row] = await db.select().from(cycles).where(eq(cycles.id, cycleId)).limit(1);
  if (!row || row.deletedAt !== null || row.userId !== userId) {
    throw new CycleNotFoundError(cycleId);
  }
  return row;
}

/** Pozycje cyklu w kształcie wejścia — do walidacji stanu po zmianie. */
async function loadGoalInputs(db: SqliteDatabase, cycleId: string): Promise<CycleGoalInput[]> {
  const rows = await db.select().from(cycleGoals).where(eq(cycleGoals.cycleId, cycleId));
  return rows.map((row) => ({
    metric: row.metric,
    target: row.target,
    exerciseId: row.exerciseId,
    tagId: row.tagId,
  }));
}
