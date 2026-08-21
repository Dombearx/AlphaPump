/**
 * Przeliczenie wektorów biblioteki.
 *
 * Jedna trasa, ale własny plik: to jedyne miejsce w panelu, które **niczego nie
 * robi w żądaniu** — oddaje robotę kolejce i odpowiada 202. Trzymanie jej obok
 * scaleń zacierałoby tę różnicę.
 */

import { type EmbeddingRefreshReport } from '@alphapump/core';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../../context.js';
import { NO_BACKLOG } from '../../duplicates/index.js';

export function createLibraryEmbeddingRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const embeddings = dependencies.embeddings ?? NO_BACKLOG;

  /**
   * Przeliczenie wektorów całej biblioteki — zlecenie, nie robota w miejscu.
   *
   * Wcześniej ten handler iterował po wszystkich ćwiczeniach sekwencyjnie, do
   * ośmiu sekund na każde, i odpowiadał dopiero na końcu. Caddy przerywa po
   * dwóch minutach, więc przy większej bibliotece panel dostawał błąd bramy,
   * a zadanie po cichu leciało dalej — i ponowne kliknięcie startowało drugi
   * przebieg obok pierwszego.
   *
   * Teraz zgłasza bibliotekę do kolejki (`EmbeddingBacklog`) i odpowiada od
   * razu. Kolejka ma jednego wykonawcę, więc drugie kliknięcie nie mnoży
   * wywołań u dostawcy modeli, a postęp widać w `/admin/stats`.
   */
  router.post('/admin/library/embeddings/refresh', async (context) => {
    const queued = await embeddings.enqueueLibrary();

    if (queued === null) {
      const disabled: EmbeddingRefreshReport = {
        enabled: false,
        status: 'disabled',
        queued: 0,
        pending: 0,
      };
      return context.json(disabled);
    }

    const status = embeddings.status();
    const report: EmbeddingRefreshReport = {
      enabled: true,
      status: 'started',
      queued,
      pending: status.pending,
    };
    // 202: zlecenie przyjęte, praca trwa gdzie indziej. 200 znaczyłoby
    // „policzone", a policzone jeszcze nie jest.
    return context.json(report, 202);
  });

  return router;
}
