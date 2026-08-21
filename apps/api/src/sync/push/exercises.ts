/**
 * Ćwiczenia w paczce pushu.
 *
 * Zmieniać może wyłącznie autor albo administrator — bez tego wspólna biblioteka
 * wchodzi w problemy rodem z wiki, a samo LWW przestaje wystarczać do
 * rozstrzygania konfliktów.
 *
 * Jeden wyjątek: **wstawienie** brakującego ćwiczenia wbudowanego. Telefon ma
 * bibliotekę wbudowaną z własnego seeda od pierwszego uruchomienia i jest to
 * jedyny zbiór wierszy, które legalnie zna, a których serwer może nie mieć —
 * cudze ćwiczenia trafiają na urządzenie wyłącznie pullem, czyli już po
 * zapisaniu ich na serwerze. Odrzucanie takiego wiersza kosztowałoby serie:
 * seria wskazująca na nieistniejące ćwiczenie też zostaje odrzucona.
 *
 * Podszycie się pod konto systemowe nie wchodzi w grę, bo identyfikator wiersza
 * musi wynikać z pary autor + nazwa (+ siłownia) — sprawdza to niżej ta sama
 * reguła, co dla ćwiczeń własnych. Autoryzacja zostaje więc nietknięta tam, gdzie
 * ma znaczenie: **istniejącego** wiersza konta systemowego dalej nie ruszy nikt
 * poza administratorem, a wyjątek dotyczy wyłącznie wiersza żywego — tombstone
 * brakującego ćwiczenia wbudowanego znaczyłby „skasuj z biblioteki coś, czego
 * serwer nigdy nie miał".
 */

import {
  clampRevision,
  exerciseId as deterministicExerciseId,
  resolveSyncConflict,
  slug,
  SYSTEM_USER_ID,
} from '@alphapump/core';
import type { ExercisePush } from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import { EXERCISE_IN_USE_MESSAGE, isExerciseInUse } from '../../exercise-usage.js';
import { exerciseTags, exercises, tags } from '../../schema.js';
import { revisionOf, toSyncedExerciseDto } from '../rows.js';
import { incomingRevision, isWrite, stampFrom, writeStamp, type PushContext } from './shared.js';

export async function applyExercises(
  context: PushContext,
  incoming: readonly ExercisePush[],
): Promise<void> {
  if (incoming.length === 0) return;
  const { tx } = context;

  const ids = incoming.map((row) => row.id);
  const known = new Map(
    (await tx.select().from(exercises).where(inArray(exercises.id, ids))).map((row) => [
      row.id,
      row,
    ]),
  );

  // Tagi dodatkowe wszystkich ćwiczeń z paczki, jednym zapytaniem. Potrzebne
  // przy odrzuceniu, żeby oddać telefonowi wiersz serwerowy w komplecie.
  const linkRows = await tx
    .select()
    .from(exerciseTags)
    .where(inArray(exerciseTags.exerciseId, ids))
    .orderBy(asc(exerciseTags.position));
  const linksByExercise = new Map<string, string[]>();
  for (const link of linkRows) {
    const bucket = linksByExercise.get(link.exerciseId);
    if (bucket) bucket.push(link.tagId);
    else linksByExercise.set(link.exerciseId, [link.tagId]);
  }

  for (const row of incoming) {
    const revision = clampRevision(incomingRevision(row, context.deviceId), context.now);
    const existing = known.get(row.id);
    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    const currentTagIds = (): string[] => linksByExercise.get(row.id) ?? [];

    const reject = (reason: string): void => {
      context.record('exercise', row.id, 'rejected', reason);
      if (existing) context.changes.exercises.push(toSyncedExerciseDto(existing, currentTagIds()));
    };

    const authorId = existing?.authorId ?? row.authorId;
    const missingBuiltIn = !existing && row.authorId === SYSTEM_USER_ID && row.deletedAt === null;
    if (!context.isAdmin && !missingBuiltIn && authorId !== context.principal.id) {
      reject('Ćwiczenie może zmieniać wyłącznie jego autor albo administrator');
      continue;
    }

    if (!isWrite(decision)) {
      context.record('exercise', row.id, decision);
      if (existing) context.changes.exercises.push(toSyncedExerciseDto(existing, currentTagIds()));
      continue;
    }

    if (decision === 'delete') {
      // „Ćwiczenia z zapisanymi seriami nie da się usunąć" obowiązuje tak samo
      // tutaj, jak przy `DELETE /exercises/:id`. Telefon zna wyłącznie serie
      // swojego właściciela, więc tombstone potrafi tu przyjechać dla ćwiczenia,
      // na którym trenuje ktoś inny.
      if (await isExerciseInUse(tx, row.id)) {
        reject(EXERCISE_IN_USE_MESSAGE);
        continue;
      }

      const stamp = stampFrom(revision, context.deviceId);
      const [written] = await tx
        .update(exercises)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(exercises.id, row.id))
        .returning();
      if (written === undefined) {
        reject('Ćwiczenie zniknęło w trakcie zapisu — spróbuj ponownie');
        continue;
      }

      context.changes.exercises.push(toSyncedExerciseDto(written, currentTagIds()));
      context.advance(written.serverSeq);
      context.record('exercise', row.id, decision);
      continue;
    }

    // Typ logowania jest ustalany raz przy tworzeniu. Zmiana osierociłaby
    // historyczne serie, które przestałyby pasować do własnego ćwiczenia.
    if (existing && row.loggingType !== existing.loggingType) {
      reject('Typ logowania ćwiczenia jest nieedytowalny');
      continue;
    }

    const wantedTagIds = [row.primaryTagId, ...row.additionalTagIds];
    if (new Set(wantedTagIds).size !== wantedTagIds.length) {
      reject('Tag główny nie może powtarzać się wśród tagów dodatkowych');
      continue;
    }
    const missingTags = await findMissingTags(tx, wantedTagIds);
    if (missingTags.length > 0) {
      reject(`Nie ma takich tagów: ${missingTags.join(', ')}`);
      continue;
    }

    const newSlug = slug(row.name);
    if (decision === 'insert' && row.id !== deterministicExerciseId(authorId, row.name, row.gym)) {
      reject('Identyfikator ćwiczenia nie wynika z pary autor + nazwa (+ siłownia)');
      continue;
    }

    const [collision] = await tx
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.authorId, authorId),
          eq(exercises.slug, newSlug),
          row.gym === null ? isNull(exercises.gym) : eq(exercises.gym, row.gym),
          ne(exercises.id, row.id),
        ),
      )
      .limit(1);
    if (collision) {
      reject('Autor ma już ćwiczenie o takiej nazwie');
      continue;
    }

    const stamp = stampFrom(revision, context.deviceId);
    const values = {
      id: row.id,
      name: row.name,
      slug: newSlug,
      authorId,
      loggingType: existing?.loggingType ?? row.loggingType,
      primaryTagId: row.primaryTagId,
      note: row.note,
      gym: row.gym,
    };

    const [written] =
      decision === 'update'
        ? await tx
            .update(exercises)
            .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
            .where(eq(exercises.id, row.id))
            .returning()
        : await tx
            .insert(exercises)
            .values({ ...values, ...stamp })
            .onConflictDoUpdate({ target: exercises.id, set: { ...values, ...stamp } })
            .returning();

    if (written === undefined) {
      reject('Ćwiczenie zniknęło w trakcie zapisu — spróbuj ponownie');
      continue;
    }

    // Zestaw tagów dodatkowych jedzie z ćwiczeniem i jest podmieniany w całości —
    // nie ma sensu synchronizować go wiersz po wierszu.
    await tx.delete(exerciseTags).where(eq(exerciseTags.exerciseId, row.id));
    if (row.additionalTagIds.length > 0) {
      await tx.insert(exerciseTags).values(
        row.additionalTagIds.map((tagId, position) => ({
          exerciseId: row.id,
          tagId,
          position,
        })),
      );
    }
    linksByExercise.set(row.id, [...row.additionalTagIds]);

    context.changes.exercises.push(toSyncedExerciseDto(written, row.additionalTagIds));
    context.advance(written.serverSeq);
    context.record('exercise', row.id, decision);
  }
}

/** Identyfikatory tagów, których nie ma w bazie. Pusta lista nie pyta bazy. */
async function findMissingTags(tx: PushContext['tx'], ids: readonly string[]): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await tx.select({ id: tags.id }).from(tags).where(inArray(tags.id, unique));
  const found = new Set(rows.map((row) => row.id));
  return unique.filter((id) => !found.has(id));
}
