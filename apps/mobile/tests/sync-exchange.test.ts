/**
 * Wymiana danych z serwerem: push, pull i kursor.
 *
 * Najważniejszy test to ten na końcu: dwa urządzenia pracujące offline, po
 * synchronizacji ani jednej zgubionej serii i ani jednego duplikatu. Reszta
 * sprawdza kolejkę wysyłki, kursor i rozstrzyganie konfliktów po stronie
 * telefonu.
 */

import { outbox, workoutSets } from '@alphapump/db/sqlite';
import { eq, isNull } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet, deleteSet, updateSet, type SetValues } from '../src/db/sets';
import { runSync } from '../src/sync/run';
import { readSyncState } from '../src/sync/state';
import { takeBatch } from '../src/sync/outbox';
import { FakeSyncServer } from './fake-server';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

function device(local: LocalDatabase, server: FakeSyncServer, deviceId: string) {
  const author = { userId: TEST_USER.id, deviceId };

  return {
    author,
    add: (values: SetValues, day = DAY) =>
      createSet(local.db, { ...author, exerciseId: EXERCISES.bench!.id, performedOn: day, values }),
    sync: () => runSync({ db: local.db, transport: server, deviceId }),
    liveSets: () => local.db.select().from(workoutSets).where(isNull(workoutSets.deletedAt)),
  };
}

describe('wymiana danych', () => {
  let local: LocalDatabase;
  let server: FakeSyncServer;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
    server = new FakeSyncServer({ userId: TEST_USER.id });
    server.seedUser({ id: TEST_USER.id, email: TEST_USER.email, nickname: TEST_USER.nickname });
  });

  afterEach(() => local.close());

  it('wysyła serię, przyjmuje numer sekwencji i czyści kolejkę', async () => {
    const phone = device(local, server, 'device-a');
    const saved = await phone.add(reps(80, 8));

    const result = await phone.sync();

    expect(result.pushed).toBe(1);
    expect(server.storedSets()).toHaveLength(1);
    expect(await local.db.select().from(outbox)).toHaveLength(0);

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, saved.id));
    expect(row?.serverSeq).toBeGreaterThan(0);
  });

  it('nie rusza sieci, gdy nie ma nic do wysłania poza pullem', async () => {
    const phone = device(local, server, 'device-a');
    await phone.sync();

    expect(server.pushCalls).toBe(0);
    expect(server.pullCalls).toBe(1);
  });

  it('trzy edycje tej samej serii jadą jako jeden wiersz', async () => {
    const phone = device(local, server, 'device-a');
    const saved = await phone.add(reps(80, 8));
    await updateSet(local.db, { ...phone.author, setId: saved.id, values: reps(85, 8) });
    await updateSet(local.db, { ...phone.author, setId: saved.id, values: reps(90, 8) });

    const batch = await takeBatch(local.db);
    expect(batch.rows).toHaveLength(1);

    await phone.sync();
    expect(server.storedSets()[0]?.weightG).toBe(90_000);
  });

  it('zapamiętuje kursor między wymianami', async () => {
    const phone = device(local, server, 'device-a');
    await phone.add(reps(80, 8));
    await phone.sync();

    const after = await readSyncState(local.db);
    expect(after.cursor).toBeGreaterThan(0);

    await phone.sync();
    expect((await readSyncState(local.db)).cursor).toBe(after.cursor);
  });

  it('zmiana zapisana w trakcie wysyłki nie ginie razem z potwierdzoną paczką', async () => {
    const phone = device(local, server, 'device-a');
    const saved = await phone.add(reps(80, 8));

    // Paczka jest już zabrana, ale jeszcze niepotwierdzona — dokładnie ten
    // moment, w którym użytkownik poprawia właśnie zapisaną serię.
    const batch = await takeBatch(local.db);
    await updateSet(local.db, { ...phone.author, setId: saved.id, values: reps(85, 8) });

    const remaining = await takeBatch(local.db);
    expect(remaining.highWater).toBeGreaterThan(batch.highWater);
  });

  it('nie nadpisuje lokalnej edycji starszą wersją z serwera', async () => {
    const phone = device(local, server, 'device-a');
    const saved = await phone.add(reps(80, 8));
    await phone.sync();

    // Serwer zna wersję 80 kg; telefon idzie dalej i zapisuje 100 kg.
    await updateSet(local.db, { ...phone.author, setId: saved.id, values: reps(100, 8) });

    // Pull od zera przywozi wersję serwerową — i musi przegrać z lokalną.
    await runSync({
      db: local.db,
      transport: { push: server.push.bind(server), pull: async () => server.pull(0) },
      deviceId: 'device-a',
    });

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, saved.id));
    expect(row?.weightG).toBe(100_000);
  });

  describe('dwa urządzenia offline', () => {
    let second: LocalDatabase;

    beforeEach(async () => {
      second = await createLocalDatabase();
      await insertTestUser(second.db);
    });

    afterEach(() => second.close());

    it('nie gubi serii i nie tworzy duplikatów', async () => {
      const a = device(local, server, 'device-a');
      const b = device(second, server, 'device-b');

      // Obie strony pracują bez sieci: A zapisuje dwie serie, B trzy.
      await a.add(reps(80, 8));
      await a.add(reps(80, 7));
      await b.add(reps(60, 12));
      await b.add(reps(60, 11));
      await b.add(reps(60, 10));

      // Łączność wraca — najpierw jednemu, potem drugiemu.
      await a.sync();
      await b.sync();
      await a.sync();

      expect(server.storedSets()).toHaveLength(5);
      expect(await a.liveSets()).toHaveLength(5);
      expect(await b.liveSets()).toHaveLength(5);
    });

    it('przy edycji tej samej serii zostaje wersja zapisana później', async () => {
      const a = device(local, server, 'device-a');
      const b = device(second, server, 'device-b');

      const saved = await a.add(reps(80, 8));
      await a.sync();
      await b.sync();

      await updateSet(second.db, { ...b.author, setId: saved.id, values: reps(90, 8) });
      await wait();
      await updateSet(local.db, { ...a.author, setId: saved.id, values: reps(100, 8) });

      await b.sync();
      await a.sync();
      await b.sync();

      expect(server.storedSets()[0]?.weightG).toBe(100_000);
      const [row] = await second.db.select().from(workoutSets).where(eq(workoutSets.id, saved.id));
      expect(row?.weightG).toBe(100_000);
    });

    it('usunięcie wygrywa z równoległą edycją', async () => {
      const a = device(local, server, 'device-a');
      const b = device(second, server, 'device-b');

      const saved = await a.add(reps(80, 8));
      await a.sync();
      await b.sync();

      // A kasuje, B edytuje — niezależnie i bez sieci.
      await deleteSet(local.db, saved.id, a.author);
      await updateSet(second.db, { ...b.author, setId: saved.id, values: reps(95, 8) });

      await b.sync();
      await a.sync();
      await b.sync();

      expect(server.storedSets()[0]?.deletedAt).not.toBeNull();
      expect(await b.liveSets()).toHaveLength(0);
      expect(await a.liveSets()).toHaveLength(0);
    });
  });
});

/** Zegar telefonu ma rozdzielczość milisekundy — bez przerwy edycje są remisem. */
const wait = () => new Promise((resolve) => setTimeout(resolve, 2));
