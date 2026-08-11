/**
 * Wykrywanie duplikatów ćwiczeń — endpoint dla ekranu tworzenia ćwiczenia.
 *
 * Jedno pytanie, jedna odpowiedź: „dodaję ćwiczenie o tej nazwie — czy coś
 * takiego już jest?". Endpoint jest **wyłącznie doradczy**. Nie ma tu żadnej
 * ścieżki, którą jego odpowiedź mogłaby zablokować zapis: `POST /exercises`
 * o niego nie pyta i pytać nie będzie, bo specyfikacja wprost zabrania blokowania
 * tworzenia ćwiczeń.
 *
 * `GET`, a nie `POST`, mimo że pod spodem potrafi wywołać model: zapytanie nie
 * zmienia stanu widocznego dla użytkownika (jedynym zapisem jest wpis w cache'u),
 * a metoda `GET` daje aplikacji zwykłe, anulowalne żądanie w trakcie pisania
 * nazwy.
 */

import { duplicateCheckResponseSchema } from '@alphapump/core';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { NO_LAYERS, findDuplicates } from '../duplicates/index.js';
import { validateQuery } from '../middleware/validate.js';
import type { RouteSpec } from '../openapi.js';
import { similarExercisesQuerySchema } from '../schemas.js';

export const duplicateRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/exercises/similar',
    summary: 'Podobne ćwiczenia',
    description:
      'Wyszukiwanie hybrydowe: leksykalne (trigramy i `tsvector`) plus semantyczne ' +
      '(embeddingi), scalone przez RRF, opcjonalnie ocenione przez model. Pole `layer` ' +
      'mówi, która warstwa faktycznie się wykonała — przy wyłączonej warstwie ' +
      'semantycznej odpowiedź jest równoważna ostrzeżeniu liczonemu lokalnie ' +
      'na telefonie. Odpowiedź jest podpowiedzią i nigdy nie blokuje zapisu ćwiczenia.',
    tag: 'ćwiczenia',
    security: 'user',
    query: similarExercisesQuerySchema,
    responses: [
      {
        status: 200,
        description: 'Kandydaci na duplikat, od najbardziej podobnego',
        schema: duplicateCheckResponseSchema,
      },
    ],
  },
];

export function createDuplicateRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const layers = dependencies.duplicates ?? NO_LAYERS;

  router.get('/exercises/similar', validateQuery(similarExercisesQuerySchema), async (context) => {
    const query = context.req.valid('query');

    return context.json(
      await findDuplicates(dependencies.db, layers, {
        name: query.name,
        excludeId: query.excludeId ?? null,
        limit: query.limit,
      }),
    );
  });

  return router;
}
