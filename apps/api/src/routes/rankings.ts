/**
 * Rankingi globalne.
 *
 * Ranking obejmuje wszystkich użytkowników i **nie jest ograniczony do
 * przedziału czasu** — tak stanowi specyfikacja, przy założeniu, że aplikacji
 * używa jedna grupa znajomych.
 *
 * ## Co jest liczone w locie, a co z cache'u
 *
 * Objętość i dystans to zwykłe sumy po seriach — liczone zapytaniem w chwili
 * pytania, bez żadnego stanu pośredniego. Dzięki temu nie mają jak rozjechać
 * się z surowymi danymi: nie ma czego unieważniać ani przeliczać.
 *
 * Liczba rekordów jest zliczeniem po `exercise_records`, bo wyznaczenie frontu
 * Pareto wymaga serii wszystkich użytkowników i nie da się go sensownie
 * wyrazić jednym zapytaniem agregującym. To jedyne miejsce, w którym ranking
 * czyta dane pochodne — przeliczane po każdej zmianie serii.
 *
 * ## Prywatność
 *
 * Na zewnątrz wychodzi nick i zagregowana liczba. Sumy nie da się rozłożyć
 * z powrotem na serie, a identyfikator konta jest w aplikacji jawny i tak:
 * telefon pobiera nicki pullem, żeby pokazać autorów ćwiczeń.
 */

import {
  rankCandidates,
  rankingResponseSchema,
  type RankingCandidate,
  type RankingMetric,
} from '@alphapump/core';
import { count, eq, isNull, sql, sum } from 'drizzle-orm';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../context.js';
import type { Database } from '../db.js';
import { validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { rankingQuerySchema } from '../schemas.js';
import { exerciseRecords, users, workoutSets } from '../schema.js';

export const rankingRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/rankings',
    summary: 'Ranking globalny',
    description:
      'Trzy zestawienia ze specyfikacji: suma objętości (ciężar × powtórzenia), ' +
      'suma dystansu i liczba posiadanych rekordów globalnych. Wartości są ' +
      'całkowite, w jednostkach bazy — gramoreps, metry, sztuki. Ranking jest ' +
      'globalny i bez przedziału czasu; użytkownicy z wynikiem zerowym w nim nie ' +
      'startują.',
    tag: 'rankingi',
    security: 'user',
    query: rankingQuerySchema,
    responses: [{ status: 200, description: 'Ranking', schema: rankingResponseSchema }],
  },
];

/** `SUM(...)` wraca z PostgreSQL jako napis (bigint) albo `null` dla braku wierszy. */
function toInteger(value: string | number | null): number {
  return value === null ? 0 : Math.round(Number(value));
}

async function candidatesFor(db: Database, metric: RankingMetric): Promise<RankingCandidate[]> {
  if (metric === 'records') {
    const rows = await db
      .select({ userId: users.id, nickname: users.nickname, value: count(exerciseRecords.setId) })
      .from(users)
      .innerJoin(exerciseRecords, eq(exerciseRecords.userId, users.id))
      .groupBy(users.id, users.nickname);

    return rows.map((row) => ({ ...row, value: toInteger(row.value) }));
  }

  // Objętość mnoży **gramy** przez powtórzenia — tak samo jak `setVolume`
  // w rdzeniu. Suma liczb całkowitych nie zależy od kolejności składników,
  // a suma kilogramów w zmiennoprzecinkowych już by zależała.
  const value =
    metric === 'volume'
      ? sum(sql`${workoutSets.weightG} * ${workoutSets.reps}`)
      : sum(workoutSets.distanceM);

  const rows = await db
    .select({ userId: users.id, nickname: users.nickname, value })
    .from(users)
    .innerJoin(workoutSets, eq(workoutSets.userId, users.id))
    .where(isNull(workoutSets.deletedAt))
    .groupBy(users.id, users.nickname);

  return rows.map((row) => ({ ...row, value: toInteger(row.value) }));
}

export function createRankingRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const { db } = dependencies;

  router.get('/rankings', validateQuery(rankingQuerySchema), async (context) => {
    const { metric, limit } = context.req.valid('query');
    const entries = rankCandidates(await candidatesFor(db, metric));
    return context.json({ metric, entries: entries.slice(0, limit) });
  });

  return router;
}
