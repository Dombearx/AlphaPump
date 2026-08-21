/**
 * Kiedy synchronizować i co zrobić, gdy się nie udało.
 *
 * Zasada jest jedna i twarda: **interfejs nigdy nie czeka na sieć.** Zapis idzie
 * do SQLite i wraca natychmiast, a wymiana z serwerem dzieje się obok. Dlatego
 * `request()` niczego nie zwraca i nie rzuca — zgłasza tylko, że jest powód, by
 * się zsynchronizować. Ekran, który miałby `await`ować synchronizację, byłby
 * ekranem blokującym się na sieci.
 *
 * ## Kiedy
 *
 * - po każdym zapisie lokalnym (ekran woła `request()`),
 * - po powrocie aplikacji na wierzch,
 * - po zalogowaniu,
 * - okresowo, dopóki aplikacja jest otwarta,
 * - po nieudanej próbie — z rosnącym odstępem.
 *
 * ## Wycofywanie
 *
 * Odstęp rośnie dwukrotnie po każdej nieudanej próbie, do godzinnego sufitu.
 * Telefon poza VPN-em potrafi być poza nim cały dzień — próba co pięć sekund nie
 * przybliżyłaby synchronizacji ani o chwilę, a zjadłaby baterię. Pierwsza próba
 * po powrocie na wierzch jest zawsze natychmiastowa, bo to najczęstszy moment,
 * w którym łączność faktycznie wraca.
 *
 * Wygasła sesja jest osobnym przypadkiem: ponawianie nie ma tu czego naprawić,
 * dopóki użytkownik się nie zaloguje. Silnik przestaje więc próbować i czeka na
 * jawne `request()`.
 */

import type { SqliteDatabase } from '@alphapump/db/sqlite';
import { pendingCount } from './outbox';
import { stuckRows } from './reconcile';
import { runSync, type SyncRunResult } from './run';
import { markError, readSyncState } from './state';
import { SyncAuthError, isOffline, type SyncTransport } from './transport';

export type SyncPhase =
  /** Wszystko wysłane i pobrane. */
  | 'idle'
  /** Wymiana w toku. */
  | 'syncing'
  /** Serwer nieosiągalny — normalny stan pracy, nie awaria. */
  | 'offline'
  /** Serwer odpowiedział błędem. */
  | 'error'
  /** Sesja wygasła; potrzebne ponowne logowanie. */
  | 'signed-out';

export interface SyncSnapshot {
  phase: SyncPhase;
  /** Ile wierszy czeka w kolejce wysyłki. */
  pending: number;
  lastSyncedAt: Date | null;
  lastError: string | null;
  /**
   * Wiersze, których serwer nie przyjął i które czekają na kolejną próbę.
   *
   * Licznik jest **trwały**, a nie „z ostatniej wymiany": bierze się
   * z kwarantanny (`reconcile.ts`), więc nie znika po pierwszej wymianie bez
   * odrzuceń i nie da się przeoczyć zapisu, który utknął.
   */
  rejected: number;
  /** Powód pierwszego z nich — do pokazania wprost. */
  rejectedReason: string | null;
}

export interface SyncEngine {
  snapshot(): SyncSnapshot;
  subscribe(listener: (snapshot: SyncSnapshot) => void): () => void;
  /** Zgłasza powód do synchronizacji. Nie czeka i nie rzuca. */
  request(): void;
  /** Wymiana z oczekiwaniem na wynik — dla testów i gestu „odśwież". */
  syncNow(): Promise<SyncRunResult | null>;
  /** Odświeża licznik oczekujących bez ruszania sieci. */
  refresh(): Promise<void>;
  stop(): void;
}

export interface SyncEngineOptions {
  db: SqliteDatabase;
  transport: SyncTransport;
  deviceId: string;
  /** Odstęp między wymianami, gdy wszystko idzie dobrze. */
  idleIntervalMs?: number;
  /** Pierwszy odstęp po nieudanej próbie; kolejne podwajają się do sufitu. */
  retryBaseMs?: number;
  retryMaxMs?: number;
  /** Wstrzykiwane w testach, żeby nie czekać naprawdę. */
  schedule?: (run: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

const DEFAULTS = {
  idleIntervalMs: 5 * 60_000,
  retryBaseMs: 15_000,
  retryMaxMs: 60 * 60_000,
} as const;

/** Ile czekamy, zanim zapis pociągnie za sobą wysyłkę. */
const COALESCE_MS = 1_500;

export function createSyncEngine(options: SyncEngineOptions): SyncEngine {
  const schedule = options.schedule ?? ((run, delay) => setTimeout(run, delay));
  const cancel =
    options.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const idleIntervalMs = options.idleIntervalMs ?? DEFAULTS.idleIntervalMs;
  const retryBaseMs = options.retryBaseMs ?? DEFAULTS.retryBaseMs;
  const retryMaxMs = options.retryMaxMs ?? DEFAULTS.retryMaxMs;

  let snapshot: SyncSnapshot = {
    phase: 'idle',
    pending: 0,
    lastSyncedAt: null,
    lastError: null,
    rejected: 0,
    rejectedReason: null,
  };

  const listeners = new Set<(snapshot: SyncSnapshot) => void>();
  let timer: unknown = null;
  let running: Promise<SyncRunResult | null> | null = null;
  /** Zgłoszenie, które przyszło w trakcie wymiany — obsłużymy je zaraz po niej. */
  let requestedAgain = false;
  let attempt = 0;
  let stopped = false;

  const emit = (patch: Partial<SyncSnapshot>): void => {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) listener(snapshot);
  };

  const clearTimer = (): void => {
    if (timer !== null) cancel(timer);
    timer = null;
  };

  const scheduleIn = (delayMs: number): void => {
    if (stopped) return;
    clearTimer();
    timer = schedule(() => {
      timer = null;
      void syncNow();
    }, delayMs);
  };

  const countPending = async (): Promise<number> => pendingCount(options.db);

  /** Stan kwarantanny — czytany z bazy, więc przeżywa restart aplikacji. */
  const readStuck = async (): Promise<Pick<SyncSnapshot, 'rejected' | 'rejectedReason'>> => {
    const rows = await stuckRows(options.db);
    return {
      rejected: rows.length,
      rejectedReason: rows.find((row) => row.reason !== null)?.reason ?? null,
    };
  };

  async function exchange(): Promise<SyncRunResult | null> {
    emit({ phase: 'syncing' });

    try {
      const result = await runSync({
        db: options.db,
        transport: options.transport,
        deviceId: options.deviceId,
      });

      attempt = 0;
      const state = await readSyncState(options.db);
      emit({
        phase: 'idle',
        pending: await countPending(),
        lastSyncedAt: state.pulledAt ?? state.pushedAt,
        lastError: null,
        ...(await readStuck()),
      });

      // Kolejka nie musi być pusta: paczka ma limit, a serwer mógł w tym czasie
      // przyjąć tylko część. Dopóki coś czeka **i coś się ruszyło**, wracamy od
      // razu.
      //
      // Drugi warunek jest bezpiecznikiem, nie optymalizacją. Paczka bywa
      // przycięta przed wysłaniem (`payload.ts`), a odsiane wiersze wracają do
      // kolejki — więc „coś czeka" potrafi być prawdą w kółko. Bez sprawdzenia,
      // czy poprzedni przebieg cokolwiek wysłał, wymiana kręciłaby się bez
      // przerwy, zjadając baterię na paczce, z której i tak nic nie wychodzi.
      // Gdy nic nie pojechało, następna próba idzie zwykłym odstępem.
      if (snapshot.pending > 0 && result.pushed > 0) requestedAgain = true;
      return result;
    } catch (error) {
      attempt += 1;
      const phase = phaseOf(error);
      const message = phase === 'offline' ? null : describe(error);

      emit({ phase, pending: await countPending(), lastError: message });
      await markError(options.db, message).catch(() => undefined);
      return null;
    }
  }

  async function syncNow(): Promise<SyncRunResult | null> {
    if (stopped) return null;

    if (running !== null) {
      requestedAgain = true;
      return running;
    }

    clearTimer();
    running = exchange();

    try {
      return await running;
    } finally {
      running = null;

      if (!stopped) {
        if (requestedAgain) {
          requestedAgain = false;
          scheduleIn(0);
        } else if (snapshot.phase === 'idle') {
          scheduleIn(idleIntervalMs);
        } else if (snapshot.phase !== 'signed-out') {
          scheduleIn(backoff(attempt, retryBaseMs, retryMaxMs));
        }
      }
    }
  }

  return {
    snapshot: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    request() {
      if (stopped) return;

      if (running !== null) {
        requestedAgain = true;
        return;
      }

      // Chwila zwłoki scala serię zapisów — zapisanie pięciu serii pod rząd
      // wysyła jedną paczkę, a nie pięć.
      scheduleIn(COALESCE_MS);
    },

    syncNow,

    async refresh() {
      emit({ pending: await countPending(), ...(await readStuck()) });
    },

    stop() {
      stopped = true;
      clearTimer();
      listeners.clear();
    },
  };
}

export function backoff(attempt: number, baseMs: number, maxMs: number): number {
  if (attempt <= 1) return baseMs;
  return Math.min(baseMs * 2 ** (attempt - 1), maxMs);
}

function phaseOf(error: unknown): SyncPhase {
  if (isOffline(error)) return 'offline';
  if (error instanceof SyncAuthError) return 'signed-out';
  return 'error';
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
