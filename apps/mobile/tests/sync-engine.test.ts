/**
 * Kiedy silnik próbuje ponownie i co pokazuje w międzyczasie.
 *
 * Czas jest wstrzykiwany, a nie odmierzany — test sprawdza, **jaki odstęp**
 * silnik zaplanował, zamiast czekać, aż minie. Czekanie na prawdziwe piętnaście
 * sekund byłoby testem cierpliwości, a nie wycofywania.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearLogs, recentLogs } from '../src/app-log';
import { backoff, createSyncEngine, type SyncEngine } from '../src/sync/engine';
import {
  SyncAuthError,
  SyncOfflineError,
  SyncServerError,
  type SyncTransport,
} from '../src/sync/transport';
import { createSet } from '../src/db/sets';
import { FakeSyncServer } from './fake-server';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

/** Kolejka zadań zamiast zegara: test decyduje, co i kiedy się wykonuje. */
class ManualScheduler {
  private handle = 0;
  private readonly tasks = new Map<number, { run: () => void; delay: number }>();

  schedule = (run: () => void, delay: number): unknown => {
    this.handle += 1;
    this.tasks.set(this.handle, { run, delay });
    return this.handle;
  };

  cancel = (handle: unknown): void => {
    this.tasks.delete(handle as number);
  };

  /** Odstępy zaplanowanych zadań — zwykle interesuje nas jeden. */
  get delays(): number[] {
    return [...this.tasks.values()].map((task) => task.delay);
  }

  /**
   * Uruchamia wszystkie zaplanowane zadania, tak jakby minął ich czas, i czeka,
   * aż wywołana przez nie wymiana dobiegnie końca. Bez tego drugiego kroku test
   * kończyłby się w trakcie zapisu do bazy, którą zaraz potem zamyka.
   */
  async fire(): Promise<void> {
    const pending = [...this.tasks.values()];
    this.tasks.clear();
    for (const task of pending) task.run();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

const failing = (error: Error): SyncTransport => ({
  push: () => Promise.reject(error),
  pull: () => Promise.reject(error),
});

describe('silnik synchronizacji', () => {
  let local: LocalDatabase;
  let scheduler: ManualScheduler;
  let engine: SyncEngine | null = null;

  const start = (transport: SyncTransport, options = {}) => {
    engine = createSyncEngine({
      db: local.db,
      deviceId: 'device-a',
      transport,
      idleIntervalMs: 60_000,
      retryBaseMs: 1_000,
      retryMaxMs: 8_000,
      schedule: scheduler.schedule,
      cancel: scheduler.cancel,
      ...options,
    });
    return engine;
  };

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
    scheduler = new ManualScheduler();
    clearLogs();
  });

  afterEach(() => {
    engine?.stop();
    engine = null;
    local.close();
  });

  it('po udanej wymianie czeka spokojnie do następnej', async () => {
    const server = new FakeSyncServer({ userId: TEST_USER.id });
    const sync = start(server);

    await sync.syncNow();

    expect(sync.snapshot().phase).toBe('idle');
    expect(sync.snapshot().pending).toBe(0);
    expect(scheduler.delays).toEqual([60_000]);
  });

  it('brak łączności to „offline", a nie błąd', async () => {
    const sync = start(failing(new SyncOfflineError()));

    await sync.syncNow();

    expect(sync.snapshot().phase).toBe('offline');
    // Spokojny stan pracy nie zostawia komunikatu o błędzie.
    expect(sync.snapshot().lastError).toBeNull();
  });

  it('odstęp między próbami rośnie i zatrzymuje się na suficie', async () => {
    const sync = start(failing(new SyncOfflineError()));

    await sync.syncNow();
    expect(scheduler.delays).toEqual([1_000]);

    await sync.syncNow();
    expect(scheduler.delays).toEqual([2_000]);

    await sync.syncNow();
    await sync.syncNow();
    await sync.syncNow();
    expect(scheduler.delays).toEqual([8_000]);
  });

  it('udana wymiana kasuje wycofywanie', async () => {
    const server = new FakeSyncServer({ userId: TEST_USER.id });
    let broken = true;
    const sync = start({
      push: (request) => (broken ? Promise.reject(new SyncOfflineError()) : server.push(request)),
      pull: (since) => (broken ? Promise.reject(new SyncOfflineError()) : server.pull(since)),
    });

    await sync.syncNow();
    await sync.syncNow();
    expect(scheduler.delays).toEqual([2_000]);

    broken = false;
    await sync.syncNow();
    expect(scheduler.delays).toEqual([60_000]);
  });

  it('błąd serwera niesie komunikat', async () => {
    const sync = start(failing(new SyncServerError('Serwer odpowiedział 500', 500)));

    await sync.syncNow();

    expect(sync.snapshot().phase).toBe('error');
    expect(sync.snapshot().lastError).toContain('500');
  });

  it('błąd serwera trafia też do bufora logów — inaczej zgłoszenie zwrotne jedzie pusty', async () => {
    const sync = start(failing(new SyncServerError('Serwer odpowiedział 500', 500)));

    await sync.syncNow();

    expect(recentLogs()).toContainEqual(
      expect.objectContaining({ level: 'error', message: expect.stringContaining('500') }),
    );
  });

  it('offline jest stanem normalnym i nie zaśmieca bufora logów', async () => {
    const sync = start(failing(new SyncOfflineError()));

    await sync.syncNow();

    expect(recentLogs()).toEqual([]);
  });

  it('po wygaśnięciu sesji przestaje próbować', async () => {
    const sync = start(failing(new SyncAuthError()));

    await sync.syncNow();

    expect(sync.snapshot().phase).toBe('signed-out');
    // Ponawianie nie ma tu czego naprawić — czekamy na logowanie.
    expect(scheduler.delays).toEqual([]);
  });

  it('zapisy pod rząd składają się na jedną wysyłkę', async () => {
    const server = new FakeSyncServer({ userId: TEST_USER.id });
    const sync = start(server);

    sync.request();
    sync.request();
    sync.request();

    expect(scheduler.delays).toHaveLength(1);

    await scheduler.fire();

    // Trzy zgłoszenia, jedna wymiana — inaczej zapisanie serii po serii
    // wysyłałoby tyle paczek, ile było naciśnięć.
    expect(server.pullCalls).toBe(1);
  });

  it('pokazuje, ile zmian czeka w kolejce', async () => {
    const server = new FakeSyncServer({ userId: TEST_USER.id });
    server.failWith = new SyncOfflineError();
    const sync = start(server);

    await createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.bench!.id,
      performedOn: '2026-08-11',
      values: {
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

    await sync.syncNow();

    expect(sync.snapshot().phase).toBe('offline');
    expect(sync.snapshot().pending).toBe(1);
  });
});

describe('wycofywanie', () => {
  it('podwaja odstęp do sufitu', () => {
    expect(backoff(1, 1_000, 10_000)).toBe(1_000);
    expect(backoff(2, 1_000, 10_000)).toBe(2_000);
    expect(backoff(3, 1_000, 10_000)).toBe(4_000);
    expect(backoff(9, 1_000, 10_000)).toBe(10_000);
  });
});
