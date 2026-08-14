/**
 * Zapisywanie paczki zmian do bazy lokalnej.
 *
 * Dwie rzeczy są tu sprawdzane naprawdę: że paczka wchodzi mimo kluczy obcych
 * rozstrzyganych dopiero przy `COMMIT`, i że paczka **niespójna** nie wchodzi
 * wcale. Pierwsza pozwala pullowi jechać kolejnością serwera, druga pilnuje,
 * żeby ta swoboda nie zamieniła się w bazę pełną wskaźników donikąd.
 */

import { exerciseId, tagId, type SyncChanges } from '@alphapump/core';
import { exerciseTags, exercises, tags, workoutSets } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { withTransaction } from '../src/db/transaction';
import { createSet } from '../src/db/sets';
import { applyChanges } from '../src/sync/apply';
import {
  EXERCISES,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const DAY = '2026-08-11';
const EARLIER = '2026-08-01T10:00:00.000Z';
const LATER = '2026-08-02T10:00:00.000Z';

const empty = (): SyncChanges => ({ users: [], tags: [], exercises: [], cycles: [], sets: [] });

const apply = (local: LocalDatabase, changes: SyncChanges) =>
  withTransaction(local.db, () => applyChanges(local.db, changes), { deferForeignKeys: true });

describe('paczka zmian', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  it('przyjmuje ćwiczenie razem z serią, która na nie wskazuje', async () => {
    const newExerciseId = exerciseId(TEST_USER.id, 'Wiosłowanie w podporze');

    const outcome = await apply(local, {
      ...empty(),
      exercises: [
        {
          id: newExerciseId,
          name: 'Wiosłowanie w podporze',
          slug: 'wioslowanie-w-podporze',
          authorId: TEST_USER.id,
          loggingType: 'weight_reps',
          primaryTagId: tagId('Back'),
          additionalTagIds: [tagId('Biceps')],
          note: null,
          gym: null,
          createdAt: EARLIER,
          updatedAt: EARLIER,
          deletedAt: null,
          serverSeq: 10,
        },
      ],
      sets: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          userId: TEST_USER.id,
          exerciseId: newExerciseId,
          performedOn: DAY,
          position: 0,
          weightG: 60_000,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
          createdAt: EARLIER,
          updatedAt: EARLIER,
          deletedAt: null,
          serverSeq: 11,
        },
      ],
    });

    expect(outcome.written).toBe(2);
    expect(await local.db.select().from(workoutSets)).toHaveLength(1);

    const links = await local.db
      .select()
      .from(exerciseTags)
      .where(eq(exerciseTags.exerciseId, newExerciseId));
    expect(links.map((link) => link.tagId)).toEqual([tagId('Biceps')]);
  });

  it('odrzuca w całości paczkę wskazującą na wiersz, którego nie ma', async () => {
    await expect(
      apply(local, {
        ...empty(),
        sets: [
          {
            id: '33333333-3333-4333-8333-333333333333',
            userId: TEST_USER.id,
            exerciseId: '44444444-4444-4444-8444-444444444444',
            performedOn: DAY,
            position: 0,
            weightG: 60_000,
            reps: 10,
            durationS: null,
            distanceM: null,
            bodyweightG: null,
            note: null,
            createdAt: EARLIER,
            updatedAt: EARLIER,
            deletedAt: null,
            serverSeq: 12,
          },
        ],
      }),
    ).rejects.toThrow();

    // Wycofanie musi zabrać całą paczkę — inaczej w bazie zostaje seria
    // wskazująca na ćwiczenie, którego nie ma.
    expect(await local.db.select().from(workoutSets)).toHaveLength(0);
  });

  it('tombstone z serwera usuwa serię lokalnie', async () => {
    const saved = await createSet(local.db, {
      userId: TEST_USER.id,
      deviceId: 'device-a',
      exerciseId: EXERCISES.bench!.id,
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

    await apply(local, {
      ...empty(),
      sets: [
        {
          id: saved.id,
          userId: TEST_USER.id,
          exerciseId: EXERCISES.bench!.id,
          performedOn: DAY,
          position: 0,
          weightG: 80_000,
          reps: 8,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
          createdAt: EARLIER,
          updatedAt: LATER,
          deletedAt: LATER,
          serverSeq: 20,
        },
      ],
    });

    const [row] = await local.db.select().from(workoutSets).where(eq(workoutSets.id, saved.id));
    expect(row?.deletedAt).not.toBeNull();
  });

  it('podmienia tagi dodatkowe ćwiczenia w całości', async () => {
    const id = EXERCISES.bench!.id;
    const base = {
      id,
      name: 'Barbell bench press',
      slug: 'barbell-bench-press',
      authorId: '73d7cbab-d3b4-549a-8d8f-9de36dbaae82',
      loggingType: 'weight_reps' as const,
      primaryTagId: tagId('Chest'),
      note: null,
      gym: null,
      createdAt: EARLIER,
      deletedAt: null,
    };

    await apply(local, {
      ...empty(),
      exercises: [
        {
          ...base,
          additionalTagIds: [tagId('Triceps'), tagId('Shoulders')],
          updatedAt: LATER,
          serverSeq: 30,
        },
      ],
    });

    await apply(local, {
      ...empty(),
      exercises: [
        {
          ...base,
          additionalTagIds: [tagId('Shoulders')],
          updatedAt: '2026-08-03T10:00:00.000Z',
          serverSeq: 31,
        },
      ],
    });

    const links = await local.db.select().from(exerciseTags).where(eq(exerciseTags.exerciseId, id));
    expect(links.map((link) => link.tagId)).toEqual([tagId('Shoulders')]);
  });

  it('zapisuje numer sekwencji także wierszowi, który przegrał rozstrzygnięcie', async () => {
    const [tag] = await local.db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId('Back')));

    await apply(local, {
      ...empty(),
      tags: [
        {
          id: tagId('Back'),
          name: 'Back',
          slug: 'back',
          color: tag?.color ?? '#000000',
          // Wersja starsza niż lokalna — treść zostaje, numer wchodzi.
          createdAt: '2020-01-01T00:00:00.000Z',
          updatedAt: '2020-01-01T00:00:00.000Z',
          deletedAt: null,
          serverSeq: 40,
        },
      ],
    });

    const [after] = await local.db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId('Back')));
    expect(after?.serverSeq).toBe(40);
    expect(after?.updatedAt.toISOString()).toBe(tag?.updatedAt.toISOString());
  });

  it('nie dubluje ćwiczeń wbudowanych przywiezionych pullem', async () => {
    const before = await local.db.select().from(exercises);

    await apply(local, {
      ...empty(),
      exercises: [
        {
          id: EXERCISES.bench!.id,
          name: 'Barbell bench press',
          slug: 'barbell-bench-press',
          authorId: '73d7cbab-d3b4-549a-8d8f-9de36dbaae82',
          loggingType: 'weight_reps',
          primaryTagId: tagId('Chest'),
          additionalTagIds: [],
          note: null,
          gym: null,
          createdAt: EARLIER,
          updatedAt: LATER,
          deletedAt: null,
          serverSeq: 50,
        },
      ],
    });

    // Identyfikatory ćwiczeń wbudowanych są deterministyczne i identyczne po obu
    // stronach — pull nie ma jak dołożyć drugiego wiersza.
    expect(await local.db.select().from(exercises)).toHaveLength(before.length);
  });
});
