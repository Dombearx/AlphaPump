/**
 * Kiedy wygrywa wersja serwera, a kiedy lokalna.
 *
 * Wszystkie cztery przypadki kończyły się wcześniej tak samo: baza telefonu
 * i baza serwera trzymały **różną treść tego samego wiersza**, żadna kolejna
 * wymiana tego nie naprawiała i nikt tego nie widział. Tak wyglądało ćwiczenie
 * z tagiem głównym „legs" na telefonie i „quads" w panelu administracyjnym.
 */

import { builtInExerciseId, tagId } from '@alphapump/core';
import { exercises, outbox, syncRejections } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTag, updateExercise } from '../src/db/library';
import { authorityAfterPull } from '../src/sync/authority';
import { runSync } from '../src/sync/run';
import { FakeSyncServer } from './fake-server';
import {
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DEVICE = 'device-a';
/** Wbudowane, z tagiem głównym „quads" i dodatkowym „glutes" — patrz seed. */
const LEG_PRESS = builtInExerciseId('Leg press');

describe('rozstrzyganie po wymianie', () => {
  let local: LocalDatabase;
  let server: FakeSyncServer;

  const author = { userId: TEST_USER.id, deviceId: DEVICE, role: 'admin' } as const;
  const sync = () => runSync({ db: local.db, transport: server, deviceId: DEVICE });

  const legPress = async () => {
    const [row] = await local.db.select().from(exercises).where(eq(exercises.id, LEG_PRESS));
    return row!;
  };

  const onServer = () => server.storedExercises().find((row) => row.id === LEG_PRESS)!;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
    server = new FakeSyncServer({ userId: TEST_USER.id });
    server.seedUser({ id: TEST_USER.id, email: TEST_USER.email, nickname: TEST_USER.nickname });
    // Pierwsza wymiana: telefon i serwer stoją na tym samym seedzie.
    await sync();
  });

  afterEach(() => local.close());

  it('odrzucona zmiana tagu głównego wraca do wersji serwerowej', async () => {
    // Tag założony offline, którego serwer nie przyjmie (u niego ten slug zajmuje
    // już inny wiersz). Ćwiczenie z takim tagiem odbija się o „missing_tag".
    const legs = await createTag(local.db, { ...author, name: 'legs' });
    server.refuse.add(legs.id);

    await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, primaryTagId: legs.id });
    expect((await legPress()).primaryTagId).toBe(legs.id);

    await sync();

    expect(onServer().primaryTagId).toBe(tagId('quads'));
    // Bez tego telefon pokazywałby „legs" po wsze czasy: jego wiersz jest
    // nowszy, więc wygrywał każde kolejne rozstrzygnięcie, a numer wiersza
    // serwerowego stoi za kursorem, więc pull już go nie przywozi.
    expect((await legPress()).primaryTagId).toBe(tagId('quads'));
  });

  it('odmowa dotycząca biblioteki jest widoczna w kwarantannie', async () => {
    const legs = await createTag(local.db, { ...author, name: 'legs' });
    server.refuse.add(legs.id);
    await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, primaryTagId: legs.id });

    await sync();

    const held = await local.db.select().from(syncRejections);
    // Wcześniej ten sam przebieg, który wpis tworzył, kasował go jako „rozliczony",
    // bo ćwiczenie ma `server_seq`. Odmowa nie zdążyła nigdy trafić do pigułki.
    expect(held.map((row) => [row.entity, row.reason])).toContainEqual([
      'exercise',
      'missing_tags',
    ]);
  });

  it('edycja zrobiona w trakcie wymiany nie jest cofana odpowiedzią pushu', async () => {
    await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, note: 'pierwsza' });

    // Druga edycja ląduje w kolejce, gdy paczka z pierwszą jest już w drodze.
    server.beforePush = async () => {
      await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, note: 'druga' });
    };

    await sync();

    expect((await legPress()).note).toBe('druga');
    const queued = await local.db.select().from(outbox);
    expect(queued.map((row) => row.rowId)).toContain(LEG_PRESS);

    server.beforePush = null;
    await sync();
    expect(onServer().note).toBe('druga');
    expect((await legPress()).note).toBe('druga');
  });

  it('znacznik przycięty przez serwer wchodzi na telefon, więc zegar do przodu nie blokuje pulla', async () => {
    const future = new Date(Date.now() + 3 * 3_600_000);
    await updateExercise(
      local.db,
      { ...author, exerciseId: LEG_PRESS, note: 'z telefonu' },
      future,
    );

    await sync();

    // Serwer przyciął znacznik do swojego „teraz". Gdy telefon zostawał przy
    // swoim, każda późniejsza zmiana z panelu przegrywała LWW przez najbliższe
    // trzy godziny — mimo że nikt o żadnym konflikcie nie wiedział.
    expect((await legPress()).updatedAt.toISOString()).toBe(onServer().updatedAt);

    server.editExercise(LEG_PRESS, { primaryTagId: tagId('hamstrings') });
    await sync();

    expect((await legPress()).primaryTagId).toBe(tagId('hamstrings'));
  });

  it('wersja serwera nie jest rozstrzygająca dla wiersza czekającego na wysłanie', async () => {
    const changes = { users: [], tags: [], exercises: [onServer()], cycles: [], sets: [] };

    // Nic nie czeka — wiersz serwera wchodzi bez rozstrzygania.
    expect([...(await authorityAfterPull(local.db, changes))]).toEqual([`exercise:${LEG_PRESS}`]);

    // Zmiana w kolejce broni wersji lokalnej: to ona pojedzie następną paczką,
    // a nadpisanie jej pullem byłoby cichą stratą pracy zrobionej offline.
    server.failWith = new Error('brak sieci');
    await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, note: 'offline' });
    await expect(sync()).rejects.toThrow('brak sieci');

    expect([...(await authorityAfterPull(local.db, changes))]).toEqual([]);
  });

  it('odmowa dotycząca wiersza znanego serwerowi znika po upływie odstępu', async () => {
    const legs = await createTag(local.db, { ...author, name: 'legs' });
    server.refuse.add(legs.id);
    await updateExercise(local.db, { ...author, exerciseId: LEG_PRESS, primaryTagId: legs.id });
    await sync();

    // Odstęp minął — w produkcji zrobiłby to zegar, w teście data w przeszłości.
    await local.db
      .update(syncRejections)
      .set({ retryAfter: new Date('2026-01-01T00:00:00.000Z') })
      .where(eq(syncRejections.entity, 'exercise'));

    await sync();

    // Ćwiczenie stoi już na wersji serwerowej, więc nie ma czego ponawiać —
    // licznik ma pokazywać stan, a nie historię. Tag, o którym serwer wciąż nie
    // wie, zostaje w kwarantannie: on jedyny ma jeszcze po co wrócić.
    const held = await local.db.select().from(syncRejections);
    expect(held.map((row) => row.entity)).toEqual(['tag']);
    expect((await legPress()).primaryTagId).toBe(tagId('quads'));
  });
});
