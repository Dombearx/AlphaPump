/**
 * Cykle w paczce pushu. Cykl jest prywatny — cudzego nie pokazujemy nawet
 * w komunikacie błędu.
 */

import { clampRevision, resolveSyncConflict } from '@alphapump/core';
import type { CyclePush } from '@alphapump/core';
import { asc, eq, inArray } from 'drizzle-orm';
import { cycleGoals, cycles, exercises, tags } from '../../schema.js';
import { revisionOf, toSyncedCycleDto } from '../rows.js';
import { incomingRevision, isWrite, stampFrom, writeStamp, type PushContext } from './shared.js';

export async function applyCycles(
  context: PushContext,
  incoming: readonly CyclePush[],
): Promise<void> {
  if (incoming.length === 0) return;
  const { tx } = context;

  const ids = incoming.map((row) => row.id);
  const known = new Map(
    (await tx.select().from(cycles).where(inArray(cycles.id, ids))).map((row) => [row.id, row]),
  );

  const goalRows = await tx
    .select()
    .from(cycleGoals)
    .where(inArray(cycleGoals.cycleId, ids))
    .orderBy(asc(cycleGoals.position));
  const goalsByCycle = new Map<string, (typeof cycleGoals.$inferSelect)[]>();
  for (const goal of goalRows) {
    const bucket = goalsByCycle.get(goal.cycleId);
    if (bucket) bucket.push(goal);
    else goalsByCycle.set(goal.cycleId, [goal]);
  }

  for (const row of incoming) {
    const revision = clampRevision(incomingRevision(row, context.deviceId), context.now);
    const existing = known.get(row.id);
    const currentGoals = (): (typeof cycleGoals.$inferSelect)[] => goalsByCycle.get(row.id) ?? [];

    if (existing && existing.userId !== context.principal.id) {
      context.record('cycle', row.id, 'rejected', 'Cykl należy do innego użytkownika');
      continue;
    }

    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    if (!isWrite(decision)) {
      context.record('cycle', row.id, decision);
      if (existing) context.changes.cycles.push(toSyncedCycleDto(existing, currentGoals()));
      continue;
    }

    if (decision === 'delete') {
      const stamp = stampFrom(revision, context.deviceId);
      const [written] = await tx
        .update(cycles)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(cycles.id, row.id))
        .returning();
      if (written === undefined) {
        context.record('cycle', row.id, 'rejected', 'Cykl zniknął w trakcie zapisu');
        continue;
      }

      context.changes.cycles.push(toSyncedCycleDto(written, currentGoals()));
      context.advance(written.serverSeq);
      context.record('cycle', row.id, decision);
      continue;
    }

    const missing = await findMissingTargets(context, row);
    if (missing.length > 0) {
      context.record(
        'cycle',
        row.id,
        'rejected',
        `Cel wskazuje na nieznane byty: ${missing.join(', ')}`,
      );
      if (existing) context.changes.cycles.push(toSyncedCycleDto(existing, currentGoals()));
      continue;
    }

    const stamp = stampFrom(revision, context.deviceId);
    const values = {
      id: row.id,
      userId: context.principal.id,
      name: row.name,
      startsOn: row.startsOn,
      endsOn: row.endsOn,
      archivedAt: row.archivedAt === null ? null : new Date(row.archivedAt),
    };

    const [written] =
      decision === 'update'
        ? await tx
            .update(cycles)
            .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
            .where(eq(cycles.id, row.id))
            .returning()
        : await tx
            .insert(cycles)
            .values({ ...values, ...stamp })
            .onConflictDoUpdate({ target: cycles.id, set: { ...values, ...stamp } })
            .returning();

    if (written === undefined) {
      context.record('cycle', row.id, 'rejected', 'Cykl zniknął w trakcie zapisu');
      continue;
    }

    // Pozycje celu jadą z cyklem i są podmieniane w całości.
    await tx.delete(cycleGoals).where(eq(cycleGoals.cycleId, row.id));
    const written_goals = row.goals.map((goal, position) => ({
      id: goal.id,
      cycleId: row.id,
      metric: goal.metric,
      target: goal.target,
      exerciseId: goal.exerciseId,
      tagId: goal.tagId,
      position,
    }));
    await tx.insert(cycleGoals).values(written_goals);
    goalsByCycle.set(row.id, written_goals);

    context.changes.cycles.push(toSyncedCycleDto(written, written_goals));
    context.advance(written.serverSeq);
    context.record('cycle', row.id, decision);
  }
}

/** Ćwiczenia i tagi wskazane przez cele, których w bazie nie ma. */
async function findMissingTargets(context: PushContext, row: CyclePush): Promise<string[]> {
  const exerciseIds = [
    ...new Set(row.goals.flatMap((goal) => (goal.exerciseId === null ? [] : [goal.exerciseId]))),
  ];
  const tagIds = [
    ...new Set(row.goals.flatMap((goal) => (goal.tagId === null ? [] : [goal.tagId]))),
  ];

  const [foundExercises, foundTags] = await Promise.all([
    exerciseIds.length === 0
      ? []
      : context.tx
          .select({ id: exercises.id })
          .from(exercises)
          .where(inArray(exercises.id, exerciseIds)),
    tagIds.length === 0
      ? []
      : context.tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, tagIds)),
  ]);

  const known = new Set([...foundExercises, ...foundTags].map((entry) => entry.id));
  return [...exerciseIds, ...tagIds].filter((id) => !known.has(id));
}
