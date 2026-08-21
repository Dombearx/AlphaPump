/**
 * Serie w paczce pushu. Historia serii jest prywatna — także administrator nie
 * dotyka cudzej.
 */

import { clampRevision, resolveSyncConflict, setInputSchemaFor } from '@alphapump/core';
import type { WorkoutSetPush } from '@alphapump/core';
import { eq, inArray } from 'drizzle-orm';
import { exercises, workoutSets } from '../../schema.js';
import { noteAffectedSet } from '../derived.js';
import { revisionOf, toSyncedSetDto } from '../rows.js';
import { incomingRevision, isWrite, stampFrom, writeStamp, type PushContext } from './shared.js';

export async function applySets(
  context: PushContext,
  incoming: readonly WorkoutSetPush[],
): Promise<void> {
  if (incoming.length === 0) return;
  const { tx } = context;

  const known = new Map(
    (
      await tx
        .select()
        .from(workoutSets)
        .where(
          inArray(
            workoutSets.id,
            incoming.map((row) => row.id),
          ),
        )
    ).map((row) => [row.id, row]),
  );

  // Typ logowania ćwiczenia rozstrzyga, czy pomiary serii są sensowne, więc
  // ćwiczenia też wczytujemy hurtem, a nie po jednym na serię.
  const referenced = [...new Set(incoming.map((row) => row.exerciseId))];
  const library = new Map(
    (
      await tx
        .select({ id: exercises.id, loggingType: exercises.loggingType })
        .from(exercises)
        .where(inArray(exercises.id, referenced))
    ).map((row) => [row.id, row]),
  );

  for (const row of incoming) {
    const revision = clampRevision(incomingRevision(row, context.deviceId), context.now);
    const existing = known.get(row.id);

    if (existing && existing.userId !== context.principal.id) {
      context.record('set', row.id, 'rejected', 'not_owner');
      continue;
    }

    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    if (!isWrite(decision)) {
      context.record('set', row.id, decision);
      if (existing) context.changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    if (decision === 'delete') {
      const stamp = stampFrom(revision, context.deviceId);
      const [written] = await tx
        .update(workoutSets)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(workoutSets.id, row.id))
        .returning();
      if (written === undefined) {
        context.record('set', row.id, 'rejected', 'vanished');
        continue;
      }

      context.changes.sets.push(toSyncedSetDto(written));
      context.advance(written.serverSeq);
      noteAffectedSet(context.scope, context.principal.id, written.exerciseId);
      context.record('set', row.id, decision);
      continue;
    }

    const exercise = library.get(row.exerciseId);
    if (exercise === undefined) {
      context.record('set', row.id, 'rejected', 'missing_exercise');
      if (existing) context.changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    // Pomiary są walidowane względem typu logowania **ćwiczenia**, a nie samego
    // ciała żądania: dystans przy wyciskaniu sztangi nie ma jak się prześlizgnąć.
    const measurements = setInputSchemaFor(exercise.loggingType).safeParse({
      exerciseId: row.exerciseId,
      performedOn: row.performedOn,
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceM: row.distanceM,
      bodyweightG: row.bodyweightG,
      note: row.note,
    });
    if (!measurements.success) {
      context.record('set', row.id, 'rejected', 'measurements_mismatch', exercise.loggingType);
      if (existing) context.changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    const stamp = stampFrom(revision, context.deviceId);
    const values = {
      id: row.id,
      userId: context.principal.id,
      exerciseId: row.exerciseId,
      performedOn: row.performedOn,
      position: row.position,
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceM: row.distanceM,
      bodyweightG: row.bodyweightG,
      note: row.note,
    };

    const [written] =
      decision === 'update'
        ? await tx
            .update(workoutSets)
            .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
            .where(eq(workoutSets.id, row.id))
            .returning()
        : await tx
            .insert(workoutSets)
            .values({ ...values, ...stamp })
            .onConflictDoUpdate({ target: workoutSets.id, set: { ...values, ...stamp } })
            .returning();

    if (written === undefined) {
      context.record('set', row.id, 'rejected', 'vanished');
      continue;
    }

    context.changes.sets.push(toSyncedSetDto(written));
    context.advance(written.serverSeq);
    // Przeniesienie serii między ćwiczeniami rusza rekordy po obu stronach.
    if (existing) noteAffectedSet(context.scope, context.principal.id, existing.exerciseId);
    noteAffectedSet(context.scope, context.principal.id, written.exerciseId);
    context.record('set', row.id, decision);
  }
}
