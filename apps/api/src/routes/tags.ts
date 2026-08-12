/**
 * Tagi.
 *
 * Tworzyć może każdy, edytować i usuwać tylko administrator — tak jak opisuje
 * to strategia synchronizacji per encja.
 *
 * Tworzenie jest **idempotentne**: identyfikator wylicza się ze sluga nazwy,
 * więc „biceps", „Biceps" i „BICEPS" trafiają w ten sam wiersz. Dwa telefony
 * bez sieci, tworzące ten sam tag, po synchronizacji zwyczajnie się zsumują —
 * dlatego ponowne utworzenie zwraca istniejący wiersz i status 200, a nie 409.
 */

import { slug, tagColor, tagId } from '@alphapump/core';
import { and, asc, eq, isNull, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { toTagDto } from '../dto.js';
import { conflict, notFound } from '../errors.js';
import { validateJson, validateParam } from '../middleware/validate.js';
import { requireAdmin } from '../middleware/authenticate.js';
import type { RouteSpec } from '../openapi.js';
import { createTagBodySchema, idParamSchema, updateTagBodySchema } from '../schemas.js';
import { tags } from '../schema.js';
import { stampDelete, stampWrite } from '../sync-columns.js';
import { TAG_IN_USE_MESSAGE, isTagInUse } from '../tag-usage.js';
import { tagSchema } from '@alphapump/core';

const tagListSchema = z.array(tagSchema);

export const tagRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/tags',
    summary: 'Lista tagów',
    tag: 'tagi',
    security: 'user',
    responses: [{ status: 200, description: 'Wszystkie nieusunięte tagi', schema: tagListSchema }],
  },
  {
    method: 'post',
    path: '/tags',
    summary: 'Utworzenie tagu',
    description:
      'Idempotentne — identyfikator wynika ze sluga nazwy, więc powtórzone ' +
      'utworzenie zwraca istniejący tag ze statusem 200.',
    tag: 'tagi',
    security: 'user',
    body: createTagBodySchema,
    responses: [
      { status: 201, description: 'Tag utworzony', schema: tagSchema },
      { status: 200, description: 'Tag o tej nazwie już istniał', schema: tagSchema },
    ],
  },
  {
    method: 'patch',
    path: '/tags/:id',
    summary: 'Zmiana nazwy tagu',
    tag: 'tagi',
    security: 'admin',
    params: idParamSchema,
    body: updateTagBodySchema,
    responses: [
      { status: 200, description: 'Tag zmieniony', schema: tagSchema },
      { status: 404, description: 'Tag nie istnieje' },
      { status: 409, description: 'Tag o takiej nazwie już istnieje' },
    ],
  },
  {
    method: 'delete',
    path: '/tags/:id',
    summary: 'Usunięcie tagu',
    description: 'Odmawia, gdy tag jest używany przez jakiekolwiek ćwiczenie.',
    tag: 'tagi',
    security: 'admin',
    params: idParamSchema,
    responses: [
      { status: 204, description: 'Tag usunięty' },
      { status: 404, description: 'Tag nie istnieje' },
      { status: 409, description: 'Tag jest używany przez ćwiczenia' },
    ],
  },
];

export function createTagRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  router.get('/tags', async (context) => {
    const rows = await db.select().from(tags).where(isNull(tags.deletedAt)).orderBy(asc(tags.name));
    return context.json(rows.map(toTagDto));
  });

  router.post('/tags', validateJson(createTagBodySchema), async (context) => {
    const { name } = context.req.valid('json');
    const id = tagId(name);

    const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (existing && existing.deletedAt === null) {
      return context.json(toTagDto(existing), 200);
    }

    // Tag skasowany wcześniej wraca do życia zamiast zderzyć się z kluczem
    // głównym — jego identyfikator jest funkcją nazwy i innego mieć nie może.
    const stamp = stampWrite();
    const [row] = await db
      .insert(tags)
      .values({ id, name, slug: slug(name), color: tagColor(name), ...stamp })
      .onConflictDoUpdate({
        target: tags.id,
        set: { name, deletedAt: null, ...stamp },
      })
      .returning();

    return context.json(toTagDto(row!), 201);
  });

  router.patch(
    '/tags/:id',
    requireAdmin,
    validateParam(idParamSchema),
    validateJson(updateTagBodySchema),
    async (context) => {
      const { id } = context.req.valid('param');
      const { name } = context.req.valid('json');

      const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
      if (!existing || existing.deletedAt !== null) throw notFound('Tag nie istnieje');

      const newSlug = slug(name);
      const [collision] = await db.select().from(tags).where(eq(tags.slug, newSlug)).limit(1);
      if (collision && collision.id !== id) {
        throw conflict('Tag o takiej nazwie już istnieje');
      }

      // Identyfikator zostaje. Wylicza się z nazwy tylko **przy tworzeniu** —
      // po zmianie nazwy przestaje jej odpowiadać i tak ma być, bo inaczej
      // poprawienie literówki osierociłoby wszystkie ćwiczenia z tym tagiem.
      const [row] = await db
        .update(tags)
        .set({ name, slug: newSlug, color: tagColor(name), ...stampWrite() })
        .where(eq(tags.id, id))
        .returning();

      return context.json(toTagDto(row!));
    },
  );

  router.delete('/tags/:id', requireAdmin, validateParam(idParamSchema), async (context) => {
    const { id } = context.req.valid('param');

    const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (!existing || existing.deletedAt !== null) throw notFound('Tag nie istnieje');

    // Ta sama reguła obowiązuje tombstone przyjeżdżający pushem — dlatego
    // predykat mieszka osobno, a nie w ciele tego handlera.
    if (await isTagInUse(db, id)) throw conflict(TAG_IN_USE_MESSAGE);

    await db.update(tags).set(stampDelete()).where(eq(tags.id, id));
    return context.body(null, 204);
  });

  return router;
}

/** Sprawdza, że wskazane tagi istnieją — wołane przy tworzeniu i edycji ćwiczeń. */
export async function assertTagsExist(
  dependencies: AppDependencies,
  tagIds: readonly string[],
): Promise<void> {
  const unique = [...new Set(tagIds)];
  if (unique.length === 0) return;

  const rows = await dependencies.db
    .select({ id: tags.id })
    .from(tags)
    .where(and(isNull(tags.deletedAt), or(...unique.map((id) => eq(tags.id, id)))));

  const known = new Set(rows.map((row) => row.id));
  const missing = unique.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw notFound(`Nie ma takich tagów: ${missing.join(', ')}`);
  }
}
