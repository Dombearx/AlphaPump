/**
 * Nic zalogowanego nie ginie — nawet gdy serwer mówi „nie".
 *
 * Trzy scenariusze, z których każdy kiedyś kosztował serie:
 *
 * 1. serwer bez biblioteki wbudowanej — paczka wiezie ze sobą ćwiczenie i tagi,
 *    więc seria nie odbija się o „Ćwiczenie serii nie istnieje",
 * 2. seria zgubiona wcześniej (odrzucona, zdjęta z kolejki, została w bazie bez
 *    `server_seq`) — `reconcile` znajduje ją i dosyła,
 * 3. odmowa, która nie mija — wiersz czeka w kwarantannie, nie kręci kolejką
 *    w kółko i wraca, gdy odstęp minie,
 * 4. wiersz odsiany **przed wysłaniem** — paczka bywa przycięta przy składaniu,
 *    a jego wpis znikał wtedy razem z całym odcinkiem kolejki.
 */

import { builtInExerciseId, SYSTEM_USER_ID } from '@alphapump/core';
import { cycleGoals, cycles, outbox, syncRejections, workoutSets } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createCycle } from '../src/db/cycles';
import { createSet, type SetValues } from '../src/db/sets';
import { stuckRows } from '../src/sync/reconcile';
import { runSync } from '../src/sync/run';
import { FakeSyncServer } from './fake-server';
import { EXERCISES, TEST_USER, createLocalDatabase, insertTestUser } from './local-database';

const DAY = '2026-08-11';
const DEVICE = 'device-a';

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

describe('odzyskiwanie zapisów', () => {
  let local: Awaited<ReturnType<typeof createLocalDatabase>>;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const withServer = (server: FakeSyncServer) => {
    server.seedUser({ id: TEST_USER.id, email: TEST_USER.email, nickname: TEST_USER.nickname });
    return {
      server,
      add: (values: SetValues) =>
        createSet(local.db, {
          userId: TEST_USER.id,
          deviceId: DEVICE,
          exerciseId: EXERCISES.bench!.id,
          performedOn: DAY,
          values,
        }),
      sync: () => runSync({ db: local.db, transport: server, deviceId: DEVICE }),
    };
  };

  it('seria na ćwiczeniu wbudowanym dojeżdża na serwer bez biblioteki', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id, library: 'empty' }));
    await phone.add(reps(80, 8));

    const result = await phone.sync();

    // Kluczowe: ani jednego odrzucenia. Ćwiczenie i jego tagi pojechały w tej
    // samej paczce, przed serią, więc serwer miał na czym ją oprzeć.
    expect(result.rejected).toEqual([]);
    expect(phone.server.storedSets()).toHaveLength(1);

    const bench = phone.server
      .storedExercises()
      .find((row) => row.id === builtInExerciseId('Flat barbell bench press'));
    expect(bench).toBeDefined();
    // Autorem zostaje konto systemowe, a nie właściciel telefonu — inaczej to
    // samo ćwiczenie stałoby w bibliotece raz na osobę.
    expect(bench?.authorId).toBe(SYSTEM_USER_ID);
    expect(phone.server.storedTags().map((tag) => tag.id)).toContain(bench?.primaryTagId);
  });

  it('nie wysyła biblioteki, której serwer już ma', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id }));
    await phone.add(reps(80, 8));

    await phone.sync();

    // Serwer zna bibliotekę z własnego seeda, więc paczka nie ma po co jej
    // powtarzać — a po pullu nic nie zostaje w kolejce.
    expect(await local.db.select().from(outbox)).toHaveLength(0);
    expect(phone.server.storedSets()).toHaveLength(1);
  });

  it('dosyła serię zgubioną przed poprawką', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id }));
    const lost = await phone.add(reps(100, 5));

    // Tak wyglądała baza po odrzuceniu sprzed poprawki: wiersz w bazie, bez
    // `server_seq`, bez wpisu w kolejce i bez czegokolwiek, co by po niego wróciło.
    await local.db.delete(outbox);

    const first = await phone.sync();
    expect(first.requeued).toBe(1);

    const second = await phone.sync();
    expect(second.rejected).toEqual([]);
    expect(phone.server.storedSets().map((row) => row.id)).toEqual([lost.id]);

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, lost.id));
    expect(row?.serverSeq).toBeGreaterThan(0);
  });

  /**
   * Cykl bez pozycji celu nie przejdzie walidacji serwera, więc `payload.ts`
   * odsiewa go już przy składaniu paczki. Wcześniej jego wpis znikał mimo to,
   * bo `clearThrough` kasował cały odcinek kolejki — a `reconcile` po niego nie
   * wracał, bo szuka wyłącznie wierszy z pustym `server_seq`.
   *
   * Cykl **potwierdzony** przez serwer takiego `server_seq` już ma, więc jego
   * edycja przepadała po cichu i na zawsze. Tu jest ten przypadek wprost.
   */
  it('wiersz odsiany przed wysłaniem wraca do kolejki, zamiast przepaść', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id }));

    const cycleId = await createCycle(local.db, {
      userId: TEST_USER.id,
      deviceId: DEVICE,
      name: 'Sierpień',
      startsOn: DAY,
      endsOn: null,
      goals: [{ metric: 'sets', target: 20, exerciseId: EXERCISES.bench!.id, tagId: null }],
    });

    await phone.sync();
    const [confirmed] = await local.db.select().from(cycles).where(eq(cycles.id, cycleId));
    expect(confirmed?.serverSeq).toBeGreaterThan(0);
    expect(await local.db.select().from(outbox)).toHaveLength(0);

    // Stan przejściowy, który `withoutIncompleteRows` odsiewa: cykl bez pozycji
    // celu nie przejdzie walidacji serwera, więc nie ma go po co wysyłać.
    // Powstaje, gdy pull skasuje pozycje tuż przed wysyłką.
    await local.db.delete(cycleGoals).where(eq(cycleGoals.cycleId, cycleId));
    await local.db
      .update(cycles)
      .set({ name: 'Sierpień, poprawiony', updatedAt: new Date() })
      .where(eq(cycles.id, cycleId));
    await local.db.insert(outbox).values({ entity: 'cycle', rowId: cycleId, queuedAt: new Date() });

    const result = await phone.sync();

    // Nic nie pojechało — i to jest w porządku. Nie w porządku było to, że wpis
    // znikał razem z odcinkiem kolejki, a `reconcile` po niego nie wracał, bo
    // wiersz ma już `server_seq`. Edycja cyklu przepadałaby wtedy na zawsze.
    expect(result.pushed).toBe(0);
    expect(await local.db.select().from(outbox)).toHaveLength(1);

    // Gdy pozycje celu wrócą, ta sama edycja wyjeżdża normalnie.
    await local.db.insert(cycleGoals).values({
      id: '00000000-0000-7000-8000-0000000000a1',
      cycleId,
      metric: 'sets',
      target: 20,
      exerciseId: EXERCISES.bench!.id,
      tagId: null,
      position: 0,
    });

    await phone.sync();
    expect(phone.server.storedCycles()[0]?.name).toBe('Sierpień, poprawiony');
    expect(await local.db.select().from(outbox)).toHaveLength(0);
  });

  it('odmowa trafia do kwarantanny, a nie do kosza', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id }));
    const refused = await phone.add(reps(120, 3));
    phone.server.refuse.add(refused.id);

    const first = await phone.sync();
    expect(first.rejected).toHaveLength(1);

    const quarantined = await stuckRows(local.db);
    expect(quarantined).toHaveLength(1);
    expect(quarantined[0]?.reason).toBe('Serwer odmawia');

    // Druga wymiana nie kręci kolejką: odstęp jeszcze nie minął.
    const second = await phone.sync();
    expect(second.requeued).toBe(0);
    expect(second.rejected).toEqual([]);
  });

  it('po upływie odstępu ponawia i przyjmuje wiersz, gdy serwer zmienia zdanie', async () => {
    const phone = withServer(new FakeSyncServer({ userId: TEST_USER.id }));
    const refused = await phone.add(reps(120, 3));
    phone.server.refuse.add(refused.id);
    await phone.sync();

    // Odstęp minął — w produkcji zrobiłby to zegar, w teście data w przeszłości.
    await local.db
      .update(syncRejections)
      .set({ retryAfter: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(syncRejections.rowId, refused.id));
    phone.server.refuse.clear();

    const retry = await phone.sync();
    expect(retry.requeued).toBe(1);

    const delivered = await phone.sync();
    expect(delivered.rejected).toEqual([]);
    expect(phone.server.storedSets().map((row) => row.id)).toEqual([refused.id]);
    // Wiersz przyjęty znika z kwarantanny — licznik pokazuje stan, nie historię.
    expect(await stuckRows(local.db)).toEqual([]);
  });
});
