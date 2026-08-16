/**
 * Klient usługi `services/triage` — jedyne miejsce, w którym API woła po sieci
 * drugi kontener zamiast bazy albo OpenRoutera. Usługa segregacji zgłoszeń
 * przegląda je i tak codziennie o umówionej godzinie (`TRIAGE_DAILY_AT`); ten
 * klient wystawia dokładnie ten sam przebieg panelowi administracyjnemu, jako
 * przycisk „uruchom teraz" — patrz `routes/admin.ts`.
 */

import { feedbackTriageReportSchema, type FeedbackTriageReport } from '@alphapump/core';
import type { TriageConfig } from './config.js';
import { conflict, internal } from './errors.js';

export interface TriageClient {
  runDaily(): Promise<FeedbackTriageReport>;
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
    async runDaily() {
      let response: Response;
      try {
        response = await fetchImpl(`${config.url}/run-daily`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${config.token}` },
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw internal(`Usługa segregacji zgłoszeń jest nieosiągalna: ${(error as Error).message}`);
      }

      if (response.status === 409) {
        throw conflict('Przegląd zgłoszeń już trwa — spróbuj ponownie za chwilę');
      }
      if (!response.ok) {
        throw internal(`Usługa segregacji zgłoszeń odpowiedziała kodem ${String(response.status)}`);
      }

      const payload: unknown = await response.json();
      const parsed = feedbackTriageReportSchema.safeParse(payload);
      if (!parsed.success) {
        throw internal('Usługa segregacji zgłoszeń zwróciła odpowiedź o nieznanym kształcie');
      }
      return parsed.data;
    },
  };
}
