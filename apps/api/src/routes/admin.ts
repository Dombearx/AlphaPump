/**
 * Endpointy panelu administracyjnego (etap 13).
 *
 * Zakres jest dokładnie taki, jaki opisuje specyfikacja: zarządzanie
 * użytkownikami, podstawowe zarządzanie bazą ćwiczeń i tagów oraz podstawowy
 * wgląd w dane systemowe. Rozbudowanych workflow moderacyjnych nie ma i nie ma
 * ich być.
 *
 * ## Czego tu nie ma i dlaczego
 *
 * Ćwiczeniami i tagami panel zarządza **istniejącymi** endpointami: `PATCH` oraz
 * `DELETE /exercises/:id` dopuszczają administratora obok autora, a `PATCH`
 * i `DELETE /tags/:id` są zastrzeżone dla administratora od etapu 3. Dublowanie
 * ich pod `/admin` dałoby dwie ścieżki zapisu do tych samych wierszy — a więc
 * dwa miejsca, w których trzeba pamiętać o `server_seq`, tombstonie i regule
 * „tag używany przez ćwiczenia nie znika".
 *
 * Zostają więc cztery rzeczy, których nigdzie indziej nie ma: lista i edycja
 * kont, przegląd liczb systemowych, zadanie porządkowe cache'u odpowiedzi
 * modelu i ręczne wyzwolenie przeglądu zgłoszeń zwrotnych (`services/triage`).
 *
 * ## Dwie blokady, które chronią administratora od siebie samego
 *
 * Nie można zablokować ani zdegradować **własnego** konta — panel jest jedynym
 * narzędziem do nadawania roli, więc administrator, który odbierze ją sobie,
 * zostaje bez drogi powrotu poza ręczną edycją bazy. Nie można też ruszyć konta
 * systemowego: jest autorem wszystkich ćwiczeń wbudowanych, a jego identyfikator
 * wchodzi w klucz ich identyfikatorów.
 */

import { renderSeedDataFile, SYSTEM_USER } from '@alphapump/db';
import {
  adminUserListSchema,
  adminUserSchema,
  feedbackTriageReportSchema,
  seedExportSchema,
  systemStatsSchema,
  updateUserInputSchema,
  type AdminUser,
} from '@alphapump/core';
import { and, asc, count, eq, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';
import { loadSeedExport } from '../admin/seed-export.js';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { NO_LAYERS, DEFAULT_CACHE_RETENTION_DAYS, pruneCache } from '../duplicates/index.js';
import { conflict, forbidden, notFound, unavailable } from '../errors.js';
import { requireAdmin } from '../middleware/authenticate.js';
import { validateJson, validateParam } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { idParamSchema } from '../schemas.js';
import {
  cycles,
  duplicateCheckCache,
  exerciseEmbeddings,
  exerciseRecords,
  exercises,
  tags,
  users,
  workoutSets,
} from '../schema.js';

/* ------------------------------------------------------------------ schematy */

/**
 * Kształt odpowiedzi opisuje `@alphapump/core` — tymi samymi schematami czyta je
 * panel administracyjny. Tutaj zostaje wyłącznie to, co jest sprawą serwera:
 * ciało zadania porządkowego cache'u.
 */
export const updateUserBodySchema = updateUserInputSchema;

export const pruneCacheBodySchema = z.object({
  olderThanDays: z.int().min(1).max(3650).default(DEFAULT_CACHE_RETENTION_DAYS),
});

export const pruneCacheResponseSchema = z.object({ removed: z.int().min(0) });

/* -------------------------------------------------------------------- trasy */

export const adminRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/admin/users',
    summary: 'Lista kont',
    description: 'Wszystkie konta wraz z blokadą i liczbą zapisanych serii oraz ćwiczeń.',
    tag: 'administracja',
    security: 'admin',
    responses: [{ status: 200, description: 'Konta', schema: adminUserListSchema }],
  },
  {
    method: 'patch',
    path: '/admin/users/:id',
    summary: 'Zmiana konta',
    description:
      'Nick, rola i blokada. Własnego konta nie da się zablokować ani zdegradować, ' +
      'a konta systemowego nie da się zmienić w ogóle — jest autorem ćwiczeń wbudowanych.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    body: updateUserBodySchema,
    responses: [
      { status: 200, description: 'Konto zmienione', schema: adminUserSchema },
      { status: 403, description: 'Konto systemowe albo brak roli administratora' },
      { status: 404, description: 'Konto nie istnieje' },
      { status: 409, description: 'Próba zablokowania albo degradacji własnego konta' },
    ],
  },
  {
    method: 'get',
    path: '/admin/stats',
    summary: 'Dane systemowe',
    description:
      'Liczby, po których widać stan systemu bez sięgania do bazy: konta, biblioteka, ' +
      'serie, dane pochodne i stan warstwy wykrywania duplikatów.',
    tag: 'administracja',
    security: 'admin',
    responses: [{ status: 200, description: 'Liczby systemowe', schema: systemStatsSchema }],
  },
  {
    method: 'post',
    path: '/admin/duplicate-cache/prune',
    summary: 'Porządkowanie cache’u re-rankera',
    description:
      'Zdejmuje wpisy starsze niż okno retencji. Cache jest w całości odtwarzalny — ' +
      'jego brak znaczy tylko, że model zostanie zapytany ponownie.',
    tag: 'administracja',
    security: 'admin',
    body: pruneCacheBodySchema,
    responses: [
      { status: 200, description: 'Liczba zdjętych wpisów', schema: pruneCacheResponseSchema },
    ],
  },
  {
    method: 'post',
    path: '/admin/feedback/run',
    summary: 'Ręczny przegląd zgłoszeń zwrotnych',
    description:
      'Wyzwala u usługi `services/triage` dokładnie ten sam przebieg, który dzieje się ' +
      'codziennie o umówionej godzinie: sprawdza nowe zgłoszenia, klasyfikuje je i albo ' +
      'zakłada issue na GitHubie, albo otwiera dyskusję na Discordzie.',
    tag: 'administracja',
    security: 'admin',
    responses: [
      { status: 200, description: 'Podsumowanie przebiegu', schema: feedbackTriageReportSchema },
      { status: 409, description: 'Przegląd już trwa' },
      { status: 503, description: 'Usługa triage nie jest skonfigurowana albo nieosiągalna' },
    ],
  },
  {
    method: 'get',
    path: '/admin/seed/export',
    summary: 'Treść seeda biblioteki wbudowanej',
    description:
      'Składa `packages/db/src/seed/data.ts` na nowo z aktualnej biblioteki konta ' +
      'systemowego — do wklejenia z powrotem do repozytorium po edycji w panelu. ' +
      'Produkcja nie ma repozytorium pod ręką (obraz API niesie tylko skompilowane ' +
      '`dist/`), więc zamiast zapisywać plik na miejscu, endpoint oddaje gotową treść ' +
      'do pobrania — commit i push zostają po stronie osoby, która go uruchamia. To samo ' +
      'da się zrobić lokalnie poleceniem `pnpm --filter api regenerate-seed`, jeśli ktoś ' +
      'ma bezpośredni dostęp do bazy przez VPN.',
    tag: 'administracja',
    security: 'admin',
    responses: [
      { status: 200, description: 'Treść pliku i ostrzeżenia', schema: seedExportSchema },
    ],
  },
];

const total = async (rows: Promise<{ value: number }[]>): Promise<number> =>
  (await rows)[0]?.value ?? 0;

export function createAdminRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;
  const layers = dependencies.duplicates ?? NO_LAYERS;

  router.use('/admin/*', requireAdmin);

  /**
   * Liczby serii i ćwiczeń per konto, jednym zapytaniem na encję. Podzapytanie
   * skorelowane w liście kolumn dałoby ten sam wynik `N + 1` zapytaniami — przy
   * kilkunastu kontach bez znaczenia, ale bez powodu.
   */
  const setsByUser = async (): Promise<Map<string, number>> => {
    const rows = await db
      .select({ userId: workoutSets.userId, value: count() })
      .from(workoutSets)
      .where(isNull(workoutSets.deletedAt))
      .groupBy(workoutSets.userId);
    return new Map(rows.map((row) => [row.userId, Number(row.value)]));
  };

  const exercisesByAuthor = async (): Promise<Map<string, number>> => {
    const rows = await db
      .select({ userId: exercises.authorId, value: count() })
      .from(exercises)
      .where(isNull(exercises.deletedAt))
      .groupBy(exercises.authorId);
    return new Map(rows.map((row) => [row.userId, Number(row.value)]));
  };

  const toDto = (
    row: typeof users.$inferSelect,
    setCount: number,
    exerciseCount: number,
  ): AdminUser => ({
    id: row.id,
    email: row.email,
    nickname: row.nickname,
    role: row.role,
    banned: row.banned,
    banReason: row.banReason,
    setCount,
    exerciseCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: null,
  });

  router.get('/admin/users', async (context) => {
    const rows = await db.select().from(users).orderBy(asc(users.email));
    const sets = await setsByUser();
    const authored = await exercisesByAuthor();

    return context.json({
      users: rows.map((row) => toDto(row, sets.get(row.id) ?? 0, authored.get(row.id) ?? 0)),
    });
  });

  router.patch(
    '/admin/users/:id',
    validateParam(idParamSchema),
    validateJson(updateUserBodySchema),
    async (context) => {
      const principal = context.get('principal');
      const { id } = context.req.valid('param');
      const input = context.req.valid('json');

      if (id === SYSTEM_USER.id) {
        throw forbidden('Konto systemowe jest autorem ćwiczeń wbudowanych i nie podlega zmianom');
      }

      const [existing] = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!existing) throw notFound('Konto nie istnieje');

      // Administrator nie może odciąć sobie drogi powrotu: panel jest jedynym
      // narzędziem do nadawania roli.
      if (id === principal.id) {
        if (input.banned === true) throw conflict('Nie można zablokować własnego konta');
        if (input.role === 'user') {
          throw conflict('Nie można odebrać roli administratora własnemu kontu');
        }
      }

      const banned = input.banned ?? existing.banned;
      const [row] = await db
        .update(users)
        .set({
          ...(input.nickname === undefined ? {} : { nickname: input.nickname }),
          ...(input.role === undefined ? {} : { role: input.role }),
          ...(input.banned === undefined ? {} : { banned: input.banned }),
          // Zdjęcie blokady czyści powód — powód blokady, której nie ma, jest
          // tylko śmieciem, który kiedyś kogoś wprowadzi w błąd.
          banReason: banned ? (input.banReason ?? existing.banReason) : null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, id))
        .returning();

      const sets = await setsByUser();
      const authored = await exercisesByAuthor();

      return context.json(toDto(row!, sets.get(id) ?? 0, authored.get(id) ?? 0));
    },
  );

  router.get('/admin/stats', async (context) => {
    // `count(*)::int` zamiast `count()` z Drizzle: `bigint` wraca ze sterownika
    // jako napis, a schemat odpowiedzi opisuje liczby. Rzutowanie w SQL-u jest
    // krótsze niż konwersja przy każdym z kilkunastu pól.
    const scalar = { value: sql<number>`count(*)::int` };

    const [lastDay] = await db
      .select({ day: max(workoutSets.performedOn) })
      .from(workoutSets)
      .where(isNull(workoutSets.deletedAt));

    return context.json({
      users: {
        total: await total(db.select(scalar).from(users)),
        admins: await total(db.select(scalar).from(users).where(eq(users.role, 'admin'))),
        banned: await total(db.select(scalar).from(users).where(eq(users.banned, true))),
      },
      library: {
        tags: await total(db.select(scalar).from(tags).where(isNull(tags.deletedAt))),
        exercises: await total(
          db.select(scalar).from(exercises).where(isNull(exercises.deletedAt)),
        ),
        builtInExercises: await total(
          db
            .select(scalar)
            .from(exercises)
            .where(and(isNull(exercises.deletedAt), eq(exercises.authorId, SYSTEM_USER.id))),
        ),
        deletedExercises: await total(
          db.select(scalar).from(exercises).where(isNotNull(exercises.deletedAt)),
        ),
        deletedTags: await total(db.select(scalar).from(tags).where(isNotNull(tags.deletedAt))),
      },
      training: {
        sets: await total(db.select(scalar).from(workoutSets).where(isNull(workoutSets.deletedAt))),
        deletedSets: await total(
          db.select(scalar).from(workoutSets).where(isNotNull(workoutSets.deletedAt)),
        ),
        cycles: await total(db.select(scalar).from(cycles).where(isNull(cycles.deletedAt))),
        lastPerformedOn: lastDay?.day ?? null,
      },
      derived: {
        globalRecords: await total(db.select(scalar).from(exerciseRecords)),
      },
      duplicates: {
        semanticEnabled: layers.embedder !== null,
        rerankerEnabled: layers.reranker !== null,
        embeddings: await total(db.select(scalar).from(exerciseEmbeddings)),
        cachedVerdicts: await total(db.select(scalar).from(duplicateCheckCache)),
      },
    });
  });

  router.post(
    '/admin/duplicate-cache/prune',
    validateJson(pruneCacheBodySchema),
    async (context) => {
      const { olderThanDays } = context.req.valid('json');
      return context.json({ removed: await pruneCache(db, olderThanDays) });
    },
  );

  router.post('/admin/feedback/run', async (context) => {
    if (!dependencies.triage) {
      throw unavailable(
        'Usługa segregacji zgłoszeń nie jest skonfigurowana (brak TRIAGE_URL/TRIAGE_HTTP_TOKEN)',
      );
    }
    return context.json(await dependencies.triage.runDaily());
  });

  router.get('/admin/seed/export', async (context) => {
    const { tagNames, exercises, warnings } = await loadSeedExport(db);
    return context.json({
      fileName: 'data.ts',
      content: renderSeedDataFile({ tagNames, exercises }),
      tags: tagNames.length,
      exercises: exercises.length,
      warnings,
    });
  });

  return router;
}
