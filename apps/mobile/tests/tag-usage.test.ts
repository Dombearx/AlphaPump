/**
 * Kolejność i widoczność tagów w rzędzie chipsów.
 *
 * Dwie warstwy, dwa zestawy: licznik serii na tag jedzie po **prawdziwym**
 * schemacie lokalnym (tak samo jak reszta testów biblioteki, bez sieci),
 * a podział rzędu na tagi widoczne i schowane jest czystą funkcją i sprawdza się
 * na gotowych liczbach.
 */

import { users } from '@alphapump/db/sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { tagSetCounts } from '../src/db/queries';
import { createSet, deleteSet } from '../src/db/sets';
import { splitTagsByUsage, tagSetCountMap } from '../src/tag-usage';
import {
  EXERCISES,
  TAGS,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a' } as const;
const DAY = '2026-08-11';

describe('liczba własnych serii na tag', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const addSet = (exerciseId: string, userId: string = TEST_USER.id) =>
    createSet(local.db, {
      ...AUTHOR,
      userId,
      exerciseId,
      performedOn: DAY,
      values: {
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightG: null,
        note: null,
      },
    });

  const counts = async (userId: string = TEST_USER.id) =>
    tagSetCountMap(await tagSetCounts(local.db, userId));

  it('liczy serie tagu głównego, a tagów bez serii nie wymienia wcale', async () => {
    await addSet(EXERCISES.bench!.id);
    await addSet(EXERCISES.bench!.id);

    const byTag = await counts();
    expect(byTag.get(TAGS.chest)).toBe(2);
    expect(byTag.has(TAGS.biceps)).toBe(false);
  });

  it('seria liczy się także do tagów dodatkowych swojego ćwiczenia', async () => {
    // Dipy mają tag główny „chest" i dodatkowy „triceps", a filtr po tagu
    // obejmuje jedno i drugie — więc licznik też musi, inaczej „triceps"
    // schowałby się w rzędzie, choć po naciśnięciu pokazuje zrobioną robotę.
    await addSet(EXERCISES.dips!.id);

    const byTag = await counts();
    expect(byTag.get(TAGS.chest)).toBe(1);
    expect(byTag.get(TAGS.triceps)).toBe(1);
  });

  it('nie liczy serii usuniętej', async () => {
    const saved = await addSet(EXERCISES.bench!.id);
    await deleteSet(local.db, saved.id, AUTHOR);

    expect((await counts()).has(TAGS.chest)).toBe(false);
  });

  it('nie liczy serii innego konta', async () => {
    const other = '22222222-2222-4222-8222-222222222222';
    await local.db.insert(users).values({
      id: other,
      email: 'ktos@example.com',
      nickname: 'Ktoś',
      role: 'user',
      createdAt: new Date('2026-08-01T08:00:00Z'),
      updatedAt: new Date('2026-08-01T08:00:00Z'),
    });
    await addSet(EXERCISES.bench!.id, other);

    expect((await counts()).has(TAGS.chest)).toBe(false);
    expect((await counts(other)).get(TAGS.chest)).toBe(1);
  });
});

describe('podział rzędu tagów', () => {
  // Kolejność wejściowa jest alfabetyczna — taką oddaje `tagLibrary`.
  const TAG_ROW = [{ id: 'abs' }, { id: 'biceps' }, { id: 'chest' }, { id: 'triceps' }];

  it('układa używane tagi malejąco po liczbie serii', () => {
    const split = splitTagsByUsage(
      TAG_ROW,
      new Map([
        ['abs', 2],
        ['biceps', 7],
        ['chest', 4],
      ]),
    );

    expect(split.shown.map((tag) => tag.id)).toEqual(['biceps', 'chest', 'abs']);
  });

  it('remis rozstrzyga alfabet, czyli kolejność z zapytania', () => {
    const split = splitTagsByUsage(
      TAG_ROW,
      new Map([
        ['chest', 3],
        ['biceps', 3],
        ['abs', 3],
      ]),
    );

    expect(split.shown.map((tag) => tag.id)).toEqual(['abs', 'biceps', 'chest']);
  });

  it('chowa tagi bez ani jednej serii, zachowując ich kolejność', () => {
    const split = splitTagsByUsage(TAG_ROW, new Map([['chest', 1]]));

    expect(split.shown.map((tag) => tag.id)).toEqual(['chest']);
    expect(split.hidden.map((tag) => tag.id)).toEqual(['abs', 'biceps', 'triceps']);
  });

  it('bez ani jednej serii schowane są wszystkie tagi', () => {
    const split = splitTagsByUsage(TAG_ROW, new Map());

    expect(split.shown).toEqual([]);
    expect(split.hidden).toHaveLength(TAG_ROW.length);
  });

  it('przypięty tag zostaje widoczny, choć serii z niego nie ma', () => {
    const split = splitTagsByUsage(TAG_ROW, new Map([['chest', 1]]), new Set(['abs']));

    expect(split.shown.map((tag) => tag.id)).toEqual(['chest', 'abs']);
    expect(split.hidden.map((tag) => tag.id)).toEqual(['biceps', 'triceps']);
  });
});
