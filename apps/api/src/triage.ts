/**
 * Klient usługi `services/triage` — jedyne miejsce, w którym API woła po sieci
 * drugi kontener zamiast bazy albo OpenRoutera. Usługa segregacji zgłoszeń
 * zagląda do katalogu sama, co kilkanaście sekund
 * (`TRIAGE_FEEDBACK_POLL_SECONDS`), więc zgłoszenie i tak zostanie przeczytane
 * bez niczyjego udziału; ten klient wystawia dokładnie ten sam przebieg
 * panelowi administracyjnemu, jako przycisk „uruchom teraz" wraz
 * z podsumowaniem liczb — patrz `routes/admin.ts`.
 */

import { feedbackTriageReportSchema, type FeedbackTriageReport } from '@alphapump/core';
import type { TriageConfig } from './config.js';
import { conflict, internal } from './errors.js';

export interface TriageClient {
  runNow(): Promise<FeedbackTriageReport>;
}

/**
 * Model językowy odpowiada raz na zgłoszenie (klasyfikacja, ewentualnie treść
 * issue i sprawdzenie duplikatu) — przy kilkunastu zaległych zgłoszeniach
 * przebieg potrafi zająć minuty, nie sekundy. Limit jest hojny właśnie dlatego:
 * przedwczesne przerwanie zostawiłoby część zgłoszeń w trakcie przetwarzania.
 */
const TIMEOUT_MS = 5 * 60 * 1000;

export function createTriageClient(
  config: TriageConfig,
  fetchImpl: typeof fetch = fetch,
): TriageClient {
  return {
    async runNow() {
      let response: Response;
      try {
        response = await fetchImpl(`${config.url}/run`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw internal(`Usługa segregacji zgłoszeń jest nieosiągalna: ${(error as Error).message}`);
      }

      if (response.status === 409) {
        throw conflict('A triage pass is already running — try again in a moment');
      }
      if (!response.ok) {
        throw internal(`Usługa segregacji zgłoszeń odpowiedziała kodem ${String(response.status)}`);
      }

      const payload: unknown = await response.json();
      const parsed = feedbackTriageReportSchema.safeParse(payload);
      if (!parsed.success) {
        throw internal('The triage service returned a response of an unknown shape');
      }
      return parsed.data;
    },
  };
}
