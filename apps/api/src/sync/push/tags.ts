/**
 * Tagi w paczce pushu.
 *
 * Tworzyć może każdy, zmieniać i usuwać wyłącznie administrator — tak samo jak
 * przy `PATCH /tags/:id`. Synchronizacja nie jest tylnym wejściem.
 */

import { clampRevision, resolveSyncConflict, slug, tagColor, tagId } from '@alphapump/core';
import type { SyncRejection, TagPush } from '@alphapump/core';
import { eq, inArray } from 'drizzle-orm';
import { TAG_IN_USE, TAG_RULES, findTagBySlug, isTagInUse } from '../../domain/tags.js';
import { tags } from '../../schema.js';
import { revisionOf, toSyncedTagDto } from '../rows.js';
import { incomingRevision, isWrite, stampFrom, writeStamp, type PushContext } from './shared.js';

export async function applyTags(context: PushContext, incoming: readonly TagPush[]): Promise<void> {
  if (incoming.length === 0) return;
  const { tx, isAdmin } = context;

  // Jednym zapytaniem, nie jednym na wiersz. Paczka niesie do pięciuset tagów,
  // a każdy `SELECT` to osobna runda do bazy.
  const known = new Map(
    (
      await tx
        .select()
        .from(tags)
        .where(
          inArray(
            tags.id,
            incoming.map((row) => row.id),
          ),
        )
    ).map((row) => [row.id, row]),
  );

  for (const row of incoming) {
    const revision = clampRevision(incomingRevision(row, context.deviceId), context.now);
    const existing = known.get(row.id);
    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    const reject = (reason: SyncRejection, detail?: string): void => {
      context.record('tag', row.id, 'rejected', reason, detail);
      if (existing) context.changes.tags.push(toSyncedTagDto(existing));
    };

    if (!isAdmin && (decision === 'update' || decision === 'delete')) {
      reject(TAG_RULES.adminOnly);
      continue;
    }

    if (!isWrite(decision)) {
      context.record('tag', row.id, decision);
      if (existing) context.changes.tags.push(toSyncedTagDto(existing));
      continue;
    }

    const name = row.name;
    const newSlug = slug(name);

    // „Usunięcie tagu używanego przez ćwiczenia jest zabronione" obowiązuje tak
    // samo tutaj, jak przy `DELETE /tags/:id`. Bez tego push byłby wejściem,
    // przez które reguła nie obowiązuje.
    if (decision === 'delete' && (await isTagInUse(tx, row.id))) {
      reject(TAG_IN_USE);
      continue;
    }

    if (decision !== 'delete') {
      // Odrzucenie oddaje telefonowi **wiersz kolizyjny**, a nie ten z paczki —
      // to jedyne miejsce, w którym push odsyła coś innego niż stan wiersza o tym
      // samym id, więc nie idzie przez `reject`.
      const collision = await findTagBySlug(tx, newSlug, row.id);
      if (collision) {
        context.record('tag', row.id, 'rejected', TAG_RULES.slugTaken, name);
        context.changes.tags.push(toSyncedTagDto(collision));
        continue;
      }
      // Identyfikator wynika z nazwy **przy tworzeniu** i tylko wtedy jest
      // sprawdzany — dokładnie jak przy ćwiczeniach. Zmiana nazwy tagu zostawia
      // id nietknięte (inaczej poprawienie literówki osierociłoby ćwiczenia).
      if (decision === 'insert' && row.id !== tagId(name)) {
        reject(TAG_RULES.idNotFromName);
        continue;
      }
    }

    const stamp = stampFrom(revision, context.deviceId);
    const values = { name, slug: newSlug, color: tagColor(name) };

    const [written] =
      decision === 'delete'
        ? await tx
            .update(tags)
            .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
            .where(eq(tags.id, row.id))
            .returning()
        : decision === 'update'
          ? await tx
              .update(tags)
              .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
              .where(eq(tags.id, row.id))
              .returning()
          : await tx
              .insert(tags)
              .values({ id: row.id, ...values, ...stamp })
              .onConflictDoUpdate({ target: tags.id, set: { ...values, ...stamp } })
              .returning();

    // Wiersz mógł zniknąć między odczytem a zapisem — na przykład przez zadanie
    // porządkowe tombstone'ów. Odrzucenie jest tu wynikiem, a nie awarią: wcześniej
    // stało tu `row!` i taki wyścig kończył się 500 na całą paczkę.
    if (written === undefined) {
      context.record('tag', row.id, 'rejected', 'vanished');
      continue;
    }

    context.changes.tags.push(toSyncedTagDto(written));
    context.advance(written.serverSeq);
    context.record('tag', row.id, decision);
  }
}
