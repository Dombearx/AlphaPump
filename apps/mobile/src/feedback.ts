/**
 * Wysyłka zgłoszenia zwrotnego — `POST /feedback`.
 *
 * Jedyny w aplikacji zapis, który idzie **wprost** na serwer, z pominięciem
 * bazy lokalnej i outboksu: zgłoszenie nie jest encją produktu (nie ma go po
 * co synchronizować ani trzymać offline), tylko jednorazową wiadomością.
 * Stąd też brak tu retry — nieudana wysyłka po prostu wraca błędem do ekranu,
 * tak jak zwykły formularz.
 *
 * Kształt błędów jest ten sam co przy synchronizacji i przy `remote/read-only`
 * — offline / sesja wygasła / serwer odpowiedział czymś nie do przyjęcia — bo
 * to ta sama rozmowa z tym samym API, tylko w jedną stronę zamiast w dwie.
 *
 * ## Co jedzie razem z treścią
 *
 * Bufor logów aplikacji (`app-log.ts`) i **stan synchronizacji tego telefonu**.
 * To drugie dołożyliśmy po zgłoszeniu, które przyszło z pustym logiem i zdaniem
 * „nie znalazłem ćwiczenia na twojej liście": pierwsze dwie hipotezy dotyczyły
 * synchronizacji, a rozstrzygnąć ich nie było czym. Kwarantanna odrzuceń
 * (`sync/reconcile.ts`) odpowiada dokładnie na to pytanie — trzyma wiersze,
 * których serwer nie przyjął, razem z kodem powodu i liczbą prób. Wiersz, który
 * odbił się od reguły serwera, nie naprawi się sam ani od czekania, ani od
 * kolejnej wymiany; dopóki nikt tego nie zobaczy, wygląda z ekranu tak samo jak
 * wszystko inne.
 */

import {
  FEEDBACK_LOG_LIMIT,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  describeRejection,
} from '@alphapump/core';
import type { SqliteDatabase, SyncRejectionRow } from '@alphapump/db/sqlite';
import { recentLogs, type AppLogEntry } from './app-log';
import { lastSyncSentence } from './sync/describe';
import { pendingCount } from './sync/outbox';
import { stuckRows } from './sync/reconcile';
import { readSyncState } from './sync/state';
import { SyncAuthError, SyncOfflineError, SyncServerError } from './sync/transport';

export { FEEDBACK_MESSAGE_MAX_LENGTH };

/** Stan synchronizacji w postaci, w jakiej opisuje go zgłoszenie. */
export interface SyncReport {
  /** Wiersze czekające w kolejce wysyłki. */
  pending: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
  /** Wiersze, których serwer nie przyjął — patrz `sync/reconcile.ts`. */
  stuck: readonly SyncRejectionRow[];
}

/**
 * Ile odrzuconych wierszy opisujemy z osobna. Reszta jedzie jako liczba
 * w zdaniu podsumowującym: dwadzieścia wierszy odbitych tą samą regułą to
 * dwadzieścia razy ta sama linijka, a miejsca w zgłoszeniu jest trzydzieści.
 */
const STUCK_DETAIL_LIMIT = 5;

/**
 * Stan synchronizacji jako wpisy logu — w tym samym kształcie, w którym jadą
 * logi aplikacji, żeby po drugiej stronie nie trzeba było czytać dwóch rzeczy.
 *
 * Odrzucony wiersz jest wpisem `error`, a nie `log`: to jest zapis, który
 * u użytkownika istnieje, a na serwerze nie — i sam się tam nie znajdzie.
 */
export function syncReportEntries(report: SyncReport, now: Date = new Date()): AppLogEntry[] {
  const at = now.toISOString();
  const rejected =
    report.stuck.length === 0
      ? 'no rows rejected by the server'
      : `${String(report.stuck.length)} row(s) rejected by the server`;

  const entries: AppLogEntry[] = [
    {
      level: report.stuck.length === 0 ? 'log' : 'warn',
      message:
        `Sync: ${String(report.pending)} change(s) queued, ${rejected}. ` +
        `${lastSyncSentence(report.lastSyncedAt, now)}` +
        `${report.lastError === null ? '' : ` Last error: ${report.lastError}`}`,
      at,
    },
  ];

  for (const row of report.stuck.slice(0, STUCK_DETAIL_LIMIT)) {
    entries.push({
      level: 'error',
      message:
        `Sync rejected ${row.entity} ${row.rowId}: ` +
        `${row.reason === null ? 'no reason code (old server)' : `${describeRejection(row.reason, row.reasonDetail)} [${row.reason}]`}, ` +
        `${String(row.attempts)} attempt(s), next try ${row.retryAfter.toISOString()}`,
      at: row.rejectedAt.toISOString(),
    });
  }

  return entries;
}

/**
 * Komplet, który jedzie ze zgłoszeniem: najpierw stan synchronizacji, potem
 * bufor logów.
 *
 * Serwer przyjmuje najwyżej `FEEDBACK_LOG_LIMIT` wpisów i **odrzuca** nadmiar,
 * zamiast go przycinać, więc przycięcie jest tutaj. Ucina się bufor, a nie
 * diagnostyka: bufor jest tym, co akurat wpadło w tej sesji, a stan
 * synchronizacji jest tym, po co ten komplet w ogóle jedzie.
 */
export async function feedbackLogs(
  db: SqliteDatabase,
  now: Date = new Date(),
): Promise<AppLogEntry[]> {
  const [state, pending, stuck] = await Promise.all([
    readSyncState(db),
    pendingCount(db),
    stuckRows(db),
  ]);

  const diagnostics = syncReportEntries(
    {
      pending,
      lastSyncedAt: state.pulledAt ?? state.pushedAt,
      lastError: state.lastError,
      stuck,
    },
    now,
  );

  const room = Math.max(0, FEEDBACK_LOG_LIMIT - diagnostics.length);
  return [...diagnostics, ...recentLogs().slice(-room)];
}

const TIMEOUT_MS = 10_000;

/** `null` znaczy „można wysłać" — ten sam kształt co walidatory gdzie indziej w aplikacji. */
export function feedbackProblem(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed.length === 0) return 'Write what happened before sending.';
  if (trimmed.length > FEEDBACK_MESSAGE_MAX_LENGTH) {
    return `Keep it under ${String(FEEDBACK_MESSAGE_MAX_LENGTH)} characters.`;
  }
  return null;
}

export interface SubmitFeedbackOptions {
  baseUrl: string;
  cookie: () => string;
  message: string;
  logs: readonly AppLogEntry[];
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function submitFeedback(options: SubmitFeedbackOptions): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const call = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await call(`${options.baseUrl}/feedback`, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', cookie: options.cookie() },
      body: JSON.stringify({ message: options.message.trim(), logs: options.logs }),
    });
  } catch (error) {
    // Brak trasy do hosta i nasz timeout znaczą to samo: jesteśmy poza VPN-em.
    throw new SyncOfflineError(error);
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 401 || response.status === 403) throw new SyncAuthError();
  if (!response.ok) {
    throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
  }
}
