/**
 * Zapisywanie serii — kryterium ukończenia etapu 6.
 *
 * Testy jadą po prawdziwym schemacie lokalnym i **nigdy nie dotykają sieci**.
 * To jest sedno: cały przepływ ma działać w trybie samolotowym, łącznie
 * z informacją o rekordzie. Gdyby cokolwiek tutaj wymagało serwera, test by nie
 * przeszedł — i o to chodzi.
 */

import { outbox, workoutSets } from '@alphapump/db/sqlite';
import { asc, eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSet, deleteSet, moveSet, updateSet, type SetValues } from '../src/db/sets';
import { daySets, groupDaySets } from '../src/db/queries';
import {
  EXERCISES,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';
const AUTHOR = { userId: '11111111-1111-4111-8111-111111111111', deviceId: 'device-a' };

const reps = (weightKg: number, count: number): SetValues => ({
  weightG: weightKg * 1000,
  reps: count,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
});

describe('serie w bazie lokalnej', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const add = (values: SetValues, day = DAY) =>
    createSet(local.db, {
      ...AUTHOR,
      exerciseId: EXERCISES.bench!.id,
      performedOn: day,
      values,
    });

  it('zapisuje serię i kolejkuje ją do wysłania', async () => {
    const saved = await add(reps(80, 8));

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, saved.id));
    expect(row).toMatchObject({ weightG: 80_000, reps: 8, position: 0, deviceId: 'device-a' });
    // Wiersz utworzony offline nie ma jeszcze numeru z sekwencji serwera.
    expect(row?.serverSeq).toBeNull();

    const queued = await local.db.select().from(outbox);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ entity: 'set', rowId: saved.id });
  });

  it('kolejne serie tego dnia dostają rosnące pozycje', async () => {
    await add(reps(80, 8));
    await add(reps(80, 7));
    const third = await add(reps(80, 6));

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, third.id));
    expect(row?.position).toBe(2);
  });

  it('odrzuca pomiary spoza typu logowania ćwiczenia', async () => {
    await expect(add({ ...reps(80, 8), distanceM: 1000 })).rejects.toThrow();
    // Nieudany zapis nie zostawia po sobie wpisu w kolejce wysyłki.
    expect(await local.db.select().from(outbox)).toHaveLength(0);
  });

  describe('informacja o rekordzie', () => {
    it('pierwsza kompletna seria jest rekordem', async () => {
      const saved = await add(reps(80, 8));
      expect(saved.record.outcome).toBe('new');
      expect(saved.record.isRecord).toBe(true);
    });

    it('cięższa seria na tyle samo powtórzeń poprawia rekord', async () => {
      await add(reps(80, 8));
      const saved = await add(reps(85, 8));

      expect(saved.record.outcome).toBe('improved');
      expect(saved.record.beaten).toHaveLength(1);
    });

    it('lżejsza seria na więcej powtórzeń też jest rekordem', async () => {
      await add(reps(80, 8));
      const saved = await add(reps(60, 20));

      // Front Pareto: żaden z tych punktów nie dominuje drugiego.
      expect(saved.record.outcome).toBe('new');
    });

    it('dokładny remis nie jest rekordem', async () => {
      await add(reps(80, 8));
      const saved = await add(reps(80, 8));

      expect(saved.record.outcome).toBe('tie');
      expect(saved.record.isRecord).toBe(false);
    });

    it('seria słabsza od rekordu nie jest rekordem', async () => {
      await add(reps(100, 10));
      const saved = await add(reps(80, 8));

      expect(saved.record.outcome).toBe('none');
    });

    it('seria dopisana wstecz liczy się tak samo jak dzisiejsza', async () => {
      await add(reps(80, 8));
      const saved = await add(reps(120, 10), '2026-07-01');

      expect(saved.record.outcome).toBe('improved');
    });
  });

  describe('edycja i usuwanie', () => {
    it('edycja zmienia wiersz, kolejkuje go i ocenia rekord na nowo', async () => {
      const created = await add(reps(80, 8));
      const updated = await updateSet(local.db, {
        ...AUTHOR,
        setId: created.id,
        values: reps(120, 8),
      });

      const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, created.id));
      expect(row?.weightG).toBe(120_000);
      expect(updated.record.outcome).toBe('new');

      // Dwa wpisy w kolejce: utworzenie i edycja — push zredukuje je do jednego wiersza.
      expect(await local.db.select().from(outbox)).toHaveLength(2);
    });

    it('edycja nie porównuje serii samej ze sobą', async () => {
      const created = await add(reps(80, 8));
      const updated = await updateSet(local.db, {
        ...AUTHOR,
        setId: created.id,
        values: reps(80, 8),
      });

      // Gdyby edytowana seria trafiła do własnej historii, wynikiem byłby remis.
      expect(updated.record.outcome).toBe('new');
    });

    it('usunięcie jest miękkie i zostawia tombstone do wysłania', async () => {
      const created = await add(reps(80, 8));
      await deleteSet(local.db, created.id, AUTHOR);

      const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, created.id));
      expect(row?.deletedAt).not.toBeNull();

      const queued = await local.db.select().from(outbox);
      expect(queued.at(-1)).toMatchObject({ entity: 'set', rowId: created.id });
    });

    it('usunięta seria znika z historii i z rekordów', async () => {
      const record = await add(reps(150, 10));
      await add(reps(80, 8));
      await deleteSet(local.db, record.id, AUTHOR);

      const saved = await add(reps(100, 9));
      expect(saved.record.isRecord).toBe(true);
    });

    it('nie da się edytować serii, której już nie ma', async () => {
      const created = await add(reps(80, 8));
      await deleteSet(local.db, created.id, AUTHOR);

      await expect(
        updateSet(local.db, { ...AUTHOR, setId: created.id, values: reps(90, 8) }),
      ).rejects.toThrow(/Nie ma serii/);
    });
  });

  describe('kolejność serii', () => {
    const positions = async () =>
      (
        await local.db
          .select({ id: workoutSets.id, position: workoutSets.position })
          .from(workoutSets)
          .orderBy(asc(workoutSets.position))
      ).map((row) => row.id);

    it('przesuwa serię w górę', async () => {
      const first = await add(reps(80, 8));
      const second = await add(reps(80, 7));

      expect(await moveSet(local.db, second.id, 'up', AUTHOR)).toBe(true);
      expect(await positions()).toEqual([second.id, first.id]);
    });

    it('przesuwa serię w dół', async () => {
      const first = await add(reps(80, 8));
      const second = await add(reps(80, 7));

      expect(await moveSet(local.db, first.id, 'down', AUTHOR)).toBe(true);
      expect(await positions()).toEqual([second.id, first.id]);
    });

    it('nie robi nic na skraju listy', async () => {
      const first = await add(reps(80, 8));
      await add(reps(80, 7));

      expect(await moveSet(local.db, first.id, 'up', AUTHOR)).toBe(false);
    });

    it('przesuwa tylko wewnątrz jednego dnia', async () => {
      const yesterday = await add(reps(80, 8), '2026-08-10');
      const today = await add(reps(80, 7), DAY);

      expect(await moveSet(local.db, today.id, 'up', AUTHOR)).toBe(false);
      expect(await moveSet(local.db, yesterday.id, 'down', AUTHOR)).toBe(false);
    });

    it('kolejkuje wyłącznie wiersze, których numer się zmienił', async () => {
      const first = await add(reps(80, 8));
      const second = await add(reps(80, 7));
      await add(reps(80, 6));

      await local.db.delete(outbox);
      await moveSet(local.db, second.id, 'up', AUTHOR);

      const queued = await local.db.select().from(outbox);
      expect(queued.map((row) => row.rowId).sort()).toEqual([first.id, second.id].sort());
    });
  });

  describe('widok dnia', () => {
    it('grupuje serie po ćwiczeniu w kolejności ich rozpoczęcia', async () => {
      await createSet(local.db, {
        ...AUTHOR,
        exerciseId: EXERCISES.bench!.id,
        performedOn: DAY,
        values: reps(80, 8),
      });
      await createSet(local.db, {
        ...AUTHOR,
        exerciseId: EXERCISES.pullUps!.id,
        performedOn: DAY,
        values: {
          weightG: null,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: 78_000,
          note: null,
        },
      });
      await createSet(local.db, {
        ...AUTHOR,
        exerciseId: EXERCISES.bench!.id,
        performedOn: DAY,
        values: reps(80, 7),
      });

      const groups = groupDaySets(await daySets(local.db, AUTHOR.userId, DAY));

      expect(groups.map((group) => group.exerciseId)).toEqual([
        EXERCISES.bench!.id,
        EXERCISES.pullUps!.id,
      ]);
      expect(groups[0]?.sets).toHaveLength(2);
    });

    it('nie pokazuje serii usuniętych ani z innych dni', async () => {
      const removed = await add(reps(80, 8));
      await deleteSet(local.db, removed.id, AUTHOR);
      await add(reps(80, 8), '2026-08-10');

      expect(await daySets(local.db, AUTHOR.userId, DAY)).toHaveLength(0);
    });
  });
});
