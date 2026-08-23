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

import {
  describeRejection,
  mergeTranslations,
  sameTranslations,
  slug,
  tagColor,
  tagId,
  tagSchema,
} from '@alphapump/core';
import { asc, eq, isNull } from 'drizzle-orm';
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
import {
  TAG_IN_USE,
  TAG_RULES,
  findTagBySlug,
  isTagInUse,
  takenTagColors,
} from '../domain/tags.js';
import { NO_TRANSLATIONS } from '../translation/index.js';

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
      { status: 404, description: 'No such tag' },
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
      { status: 404, description: 'No such tag' },
      { status: 409, description: 'Tag jest używany przez ćwiczenia' },
    ],
  },
];

export function createTagRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  // Pominięcie zależności znaczy „nie ma czym tłumaczyć" — tag zapisuje się
  // wtedy z samą nazwą kanoniczną, tak jak przed dodaniem języków.
  const translations = dependencies.translations ?? NO_TRANSLATIONS;

  router.get('/tags', async (context) => {
    const rows = await db.select().from(tags).where(isNull(tags.deletedAt)).orderBy(asc(tags.name));
    return context.json(rows.map(toTagDto));
  });

  router.post('/tags', validateJson(createTagBodySchema), async (context) => {
    const { name, translations: given } = context.req.valid('json');
    const id = tagId(name);

    const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (existing && existing.deletedAt === null) {
      // Tag już jest, ale formularz mógł przywieźć nazwę w języku, którego ten
      // wiersz jeszcze nie zna. Domykamy zestaw zamiast odsyłać go bez zmian —
      // inaczej dopisanie tłumaczenia do istniejącego tagu nie miałoby drogi.
      const merged = mergeTranslations(existing.translations, given);
      if (!sameTranslations(existing.translations, merged)) {
        const [updated] = await db
          .update(tags)
          .set({ translations: merged, ...stampWrite() })
          .where(eq(tags.id, id))
          .returning();
        return context.json(toTagDto(updated!), 200);
      }

      // Zestaw niedomknięty trafia do kolejki także przy powtórzonym utworzeniu:
      // wcześniejsze wywołanie mogło skończyć się błędem modelu.
      translations.enqueue([{ entity: 'tag', id }]);
      return context.json(toTagDto(existing), 200);
    }

    // Kolor omija te, które zajmują już żywe tagi — dopóki tagów jest mniej niż
    // dwadzieścia, żaden nie powtórzy się w bibliotece.
    const color = tagColor(name, await takenTagColors(db, id));

    // Tag skasowany wcześniej wraca do życia zamiast zderzyć się z kluczem
    // głównym — jego identyfikator jest funkcją nazwy i innego mieć nie może.
    const stamp = stampWrite();
    // Nazwy z formularza wchodzą od razu, a nie kolejką: wpisane ręcznie mają
    // pierwszeństwo przed tym, co poda model, więc muszą być w wierszu, zanim
    // model zostanie o cokolwiek zapytany.
    const supplied = mergeTranslations(given, null);
    const [row] = await db
      .insert(tags)
      .values({ id, name, slug: slug(name), color, translations: supplied, ...stamp })
      .onConflictDoUpdate({
        target: tags.id,
        // Slug i kolor razem z nazwą, tak samo jak w gałęzi wstawiania obok:
        // wskrzeszony tag ma dostać kolor wolny **teraz**, a nie ten, który
        // zajmował przed skasowaniem i który zdążył już przejąć ktoś inny.
        set: {
          name,
          slug: slug(name),
          color,
          translations: supplied,
          deletedAt: null,
          ...stamp,
        },
      })
      .returning();

    // Brakujące języki dokłada model — poza żądaniem, bo zapis nie ma na co
    // czekać, i bez prawa wywrócenia go, gdy dostawca nie odpowie.
    translations.enqueue([{ entity: 'tag', id }]);
    return context.json(toTagDto(row!), 201);
  });

  router.patch(
    '/tags/:id',
    requireAdmin,
    validateParam(idParamSchema),
    validateJson(updateTagBodySchema),
    async (context) => {
      const { id } = context.req.valid('param');
      const { name, translations: given } = context.req.valid('json');

      const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
      if (!existing || existing.deletedAt !== null) throw notFound('No such tag');

      const newSlug = slug(name);
      if (await findTagBySlug(db, newSlug, id)) {
        throw conflict(describeRejection(TAG_RULES.slugTaken, name));
      }

      // Identyfikator zostaje. Wylicza się z nazwy tylko **przy tworzeniu** —
      // po zmianie nazwy przestaje jej odpowiadać i tak ma być, bo inaczej
      // poprawienie literówki osierociłoby wszystkie ćwiczenia z tym tagiem.
      //
      // Kolor też zostaje: jest przydzielony, a nie policzony z nazwy, więc
      // przeliczenie go po zmianie pisowni wepchnęłoby tag na kolor sąsiada.
      //
      // Tłumaczenia **podmieniamy**, a nie domykamy, i to jest różnica względem
      // pushu z telefonu: tutaj po drugiej stronie siedzi administrator, który
      // widzi komplet nazw w formularzu i właśnie je poprawił. Domknięcie
      // znaczyłoby, że skasowania błędnego tłumaczenia nie da się zapisać.
      // Pominięcie pola to jednak co innego niż pusty komplet: znaczy „nie
      // dotykam nazw", bo inaczej zmiana samej pisowni kasowałaby tłumaczenia.
      const supplied = given === undefined ? existing.translations : mergeTranslations(given, null);
      const [row] = await db
        .update(tags)
        .set({ name, slug: newSlug, translations: supplied, ...stampWrite() })
        .where(eq(tags.id, id))
        .returning();

      // Zmieniona nazwa znaczy nieaktualne tłumaczenia — te, których
      // administrator nie wpisał sam, dokłada model z nowej nazwy.
      translations.enqueue([{ entity: 'tag', id }]);
      return context.json(toTagDto(row!));
    },
  );

  router.delete('/tags/:id', requireAdmin, validateParam(idParamSchema), async (context) => {
    const { id } = context.req.valid('param');

    const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
    if (!existing || existing.deletedAt !== null) throw notFound('No such tag');

    // Ta sama reguła obowiązuje tombstone przyjeżdżający pushem — dlatego
    // predykat mieszka osobno, a nie w ciele tego handlera.
    if (await isTagInUse(db, id)) throw conflict(describeRejection(TAG_IN_USE));

    await db.update(tags).set(stampDelete()).where(eq(tags.id, id));
    return context.body(null, 204);
  });

  return router;
}
