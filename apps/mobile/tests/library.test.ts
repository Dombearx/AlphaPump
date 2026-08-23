/**
 * Biblioteka i tagi, w całości offline.
 *
 * Testy jadą po prawdziwym schemacie lokalnym i **nigdy nie dotykają sieci**.
 * To jest sedno biblioteki: przepływ „wybierz tag, zobacz ćwiczenia, dodaj nowe"
 * ma działać w trybie samolotowym, razem z ostrzeżeniem o duplikacie. Gdyby
 * cokolwiek tutaj wymagało serwera, test by nie przeszedł.
 */

import {
  TAG_PALETTE,
  exerciseId as computeExerciseId,
  findSimilarExercises,
  tagId,
} from '@alphapump/core';
import { exerciseTags, exercises, outbox, tags } from '@alphapump/db/sqlite';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  NameTakenError,
  NotAllowedError,
  RepeatedTagError,
  TagNotFoundError,
  createExercise,
  createTag,
  deleteExercise,
  updateExercise,
} from '../src/db/library';
import { additionalTagsOf, exerciseLibrary, tagLibrary } from '../src/db/queries';
import { createSet, deleteSet } from '../src/db/sets';
import {
  EXERCISES,
  TAGS,
  TEST_USER,
  createLocalDatabase,
  insertTestUser,
  type LocalDatabase,
} from './local-database';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a', role: 'user' } as const;
const OTHER = { userId: '22222222-2222-4222-8222-222222222222', deviceId: 'device-b' } as const;

describe('tagi w bazie lokalnej', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  it('tworzy tag z identyfikatorem i kolorem z palety', async () => {
    const saved = await createTag(local.db, { ...AUTHOR, name: 'Kark' });

    expect(saved).toEqual({ id: tagId('Kark'), created: true });

    const [row] = await local.db.select().from(tags).where(eq(tags.id, saved.id));
    expect(row).toMatchObject({ name: 'Kark', slug: 'kark', deviceId: 'device-a' });
    expect(TAG_PALETTE).toContain(row?.color);
    expect(row?.serverSeq).toBeNull();
  });

  it('nie powtarza koloru, dopóki tagów jest najwyżej dwadzieścia', async () => {
    // Seed daje dziesięć tagów; dokładamy tyle, żeby wyczerpać paletę co do
    // slotu — offline, bez pytania serwera o cokolwiek.
    const seeded = await local.db.select().from(tags);
    for (let index = seeded.length; index < TAG_PALETTE.length; index += 1) {
      await createTag(local.db, { ...AUTHOR, name: `Kolorowy ${String(index)}` });
    }

    const colors = (await local.db.select().from(tags)).map((row) => row.color);
    expect(colors).toHaveLength(TAG_PALETTE.length);
    expect(new Set(colors).size).toBe(TAG_PALETTE.length);
  });

  it('kolejkuje nowy tag do wysłania', async () => {
    const saved = await createTag(local.db, { ...AUTHOR, name: 'Kark' });

    const queued = await local.db.select().from(outbox);
    expect(queued).toEqual([expect.objectContaining({ entity: 'tag', rowId: saved.id })]);
  });

  it('ta sama nazwa trafia w istniejący tag zamiast tworzyć drugi', async () => {
    const first = await createTag(local.db, { ...AUTHOR, name: 'Biceps' });
    const second = await createTag(local.db, { ...AUTHOR, name: 'biceps' });

    expect(second).toEqual({ id: first.id, created: false });
    // Tag ze seeda już istniał, więc nic nie poszło do kolejki.
    expect(await local.db.select().from(outbox)).toHaveLength(0);
  });

  it('odrzuca nazwę, z której nie da się wyliczyć identyfikatora', async () => {
    await expect(createTag(local.db, { ...AUTHOR, name: '???' })).rejects.toThrow();
  });

  it('licznik przy tagu zgadza się z tym, co pokaże filtr', async () => {
    const biceps = await createTag(local.db, { ...AUTHOR, name: 'Biceps' });
    await createExercise(local.db, {
      ...AUTHOR,
      name: 'Wyciskanie wąskim chwytem',
      loggingType: 'weight_reps',
      primaryTagId: TAGS.chest,
      additionalTagIds: [biceps.id],
      note: null,
      gym: null,
    });

    const rows = await tagLibrary(local.db);
    const chest = rows.find((row) => row.id === TAGS.chest);
    const filtered = await exerciseLibrary(local.db, TEST_USER.id, { tagId: TAGS.chest });

    expect(chest?.exerciseCount).toBeGreaterThan(0);
    expect(chest?.exerciseCount).toBe(filtered.length);

    // Tag dodatkowy też liczy się do licznika — inaczej chips obiecywałby mniej,
    // niż pokazuje po naciśnięciu.
    const bicepsRow = rows.find((row) => row.id === biceps.id);
    const bicepsFiltered = await exerciseLibrary(local.db, TEST_USER.id, { tagId: biceps.id });
    expect(bicepsRow?.exerciseCount).toBe(bicepsFiltered.length);
  });
});

describe('ćwiczenia w bazie lokalnej', () => {
  let local: LocalDatabase;

  beforeEach(async () => {
    local = await createLocalDatabase();
    await insertTestUser(local.db);
  });

  afterEach(() => local.close());

  const add = (name: string, extra: Partial<Parameters<typeof createExercise>[1]> = {}) =>
    createExercise(local.db, {
      ...AUTHOR,
      name,
      loggingType: 'weight_reps',
      primaryTagId: TAGS.chest,
      additionalTagIds: [],
      note: null,
      gym: null,
      ...extra,
    });

  it('tworzy ćwiczenie z identyfikatorem wyliczonym z autora i nazwy', async () => {
    const saved = await add('Wyciskanie francuskie');

    expect(saved).toEqual({
      id: computeExerciseId(TEST_USER.id, 'Wyciskanie francuskie'),
      created: true,
    });

    const [row] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
    expect(row).toMatchObject({
      name: 'Wyciskanie francuskie',
      slug: 'wyciskanie-francuskie',
      authorId: TEST_USER.id,
      loggingType: 'weight_reps',
      primaryTagId: TAGS.chest,
      deviceId: 'device-a',
    });
    expect(row?.serverSeq).toBeNull();

    const queued = await local.db.select().from(outbox);
    expect(queued).toEqual([expect.objectContaining({ entity: 'exercise', rowId: saved.id })]);
  });

  it('ta sama nazwa u tego samego autora trafia w istniejący wiersz', async () => {
    const first = await add('Wyciskanie francuskie');
    const second = await add('wyciskanie FRANCUSKIE');

    // Deterministyczne id sprawia, że duplikat z drugiego urządzenia po prostu
    // się zsumuje — nie ma czego remapować ani przepinać.
    expect(second).toEqual({ id: first.id, created: false });
    expect(await local.db.select().from(outbox)).toHaveLength(1);
  });

  it('zapisuje tagi dodatkowe w podanej kolejności', async () => {
    const biceps = await createTag(local.db, { ...AUTHOR, name: 'Biceps' });
    const triceps = await createTag(local.db, { ...AUTHOR, name: 'Triceps' });

    const saved = await add('Wyciskanie wąskim chwytem', {
      additionalTagIds: [triceps.id, biceps.id],
    });

    const links = await additionalTagsOf(local.db, saved.id);
    expect(links.map((tag) => tag.id)).toEqual([triceps.id, biceps.id]);
  });

  it('nie pozwala powtórzyć tagu głównego wśród dodatkowych', async () => {
    await expect(add('Rozpiętki', { additionalTagIds: [TAGS.chest] })).rejects.toThrow(
      RepeatedTagError,
    );
    expect(await local.db.select().from(outbox)).toHaveLength(0);
  });

  it('nie pozwala wskazać tagu, którego nie ma w bazie lokalnej', async () => {
    await expect(
      add('Rozpiętki', { primaryTagId: '33333333-3333-4333-8333-333333333333' }),
    ).rejects.toThrow(TagNotFoundError);
  });

  it('nowe ćwiczenie jest od razu w bibliotece i pod swoim tagiem', async () => {
    const saved = await add('Wyciskanie francuskie');

    const all = await exerciseLibrary(local.db, TEST_USER.id);
    expect(all.map((row) => row.id)).toContain(saved.id);

    const tagged = await exerciseLibrary(local.db, TEST_USER.id, { tagId: TAGS.chest });
    expect(tagged.map((row) => row.id)).toContain(saved.id);
  });

  it('filtr biblioteki rozróżnia ćwiczenia wbudowane i dodane', async () => {
    const saved = await add('Wyciskanie francuskie');

    const builtIn = await exerciseLibrary(local.db, TEST_USER.id, { source: 'built-in' });
    const community = await exerciseLibrary(local.db, TEST_USER.id, { source: 'community' });

    expect(builtIn.map((row) => row.id)).toContain(EXERCISES.bench!.id);
    expect(builtIn.map((row) => row.id)).not.toContain(saved.id);
    expect(community.map((row) => row.id)).toEqual([saved.id]);
  });

  it('filtr po tagu widzi także tag dodatkowy', async () => {
    const biceps = await createTag(local.db, { ...AUTHOR, name: 'Biceps' });
    const saved = await add('Wyciskanie wąskim chwytem', { additionalTagIds: [biceps.id] });

    const tagged = await exerciseLibrary(local.db, TEST_USER.id, { tagId: biceps.id });
    expect(tagged.map((row) => row.id)).toContain(saved.id);
  });

  describe('ostrzeżenie o duplikacie', () => {
    it('działa na danych z bazy lokalnej, bez sieci', async () => {
      await add('Wyciskanie francuskie');
      const library = await exerciseLibrary(local.db, TEST_USER.id);

      const similar = findSimilarExercises('Wyciskanie francuskie sztangielkami', library);
      expect(similar.map((match) => match.exercise.name)).toContain('Wyciskanie francuskie');
    });

    it('nie zapala się przy nazwie z innego obszaru', async () => {
      const library = await exerciseLibrary(local.db, TEST_USER.id);
      expect(findSimilarExercises('Kajakarstwo górskie', library)).toEqual([]);
    });

    it('nie blokuje zapisu', async () => {
      await add('Wyciskanie francuskie');
      const saved = await add('Wyciskanie francuskie sztangielkami');

      expect(saved.created).toBe(true);
    });
  });

  describe('edycja i usuwanie', () => {
    it('zmienia nazwę, zachowując identyfikator', async () => {
      const saved = await add('Wyciskanie francuzkie');
      await updateExercise(local.db, {
        ...AUTHOR,
        exerciseId: saved.id,
        name: 'Wyciskanie francuskie',
      });

      const [row] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
      // Identyfikator liczy się wyłącznie przy tworzeniu — inaczej poprawienie
      // literówki osierociłoby serie wskazujące na stare id.
      expect(row).toMatchObject({ id: saved.id, name: 'Wyciskanie francuskie' });
    });

    it('podmienia komplet tagów dodatkowych', async () => {
      const biceps = await createTag(local.db, { ...AUTHOR, name: 'Biceps' });
      const triceps = await createTag(local.db, { ...AUTHOR, name: 'Triceps' });
      const saved = await add('Wyciskanie wąskim chwytem', { additionalTagIds: [biceps.id] });

      await updateExercise(local.db, {
        ...AUTHOR,
        exerciseId: saved.id,
        additionalTagIds: [triceps.id],
      });

      const links = await local.db
        .select()
        .from(exerciseTags)
        .where(eq(exerciseTags.exerciseId, saved.id));
      expect(links.map((link) => link.tagId)).toEqual([triceps.id]);
    });

    it('nie pozwala autorowi mieć dwóch ćwiczeń o tej samej nazwie', async () => {
      await add('Rozpiętki');
      const second = await add('Rozpiętki na maszynie');

      await expect(
        updateExercise(local.db, { ...AUTHOR, exerciseId: second.id, name: 'Rozpiętki' }),
      ).rejects.toThrow(NameTakenError);
    });

    it('cudzego ćwiczenia nie zmienia ani nie usuwa zwykły użytkownik', async () => {
      const bench = EXERCISES.bench!.id;

      await expect(
        updateExercise(local.db, { ...AUTHOR, exerciseId: bench, name: 'Moja nazwa' }),
      ).rejects.toThrow(NotAllowedError);
      await expect(deleteExercise(local.db, bench, AUTHOR)).rejects.toThrow(NotAllowedError);
    });

    it('administrator zmienia cudze ćwiczenie', async () => {
      const bench = EXERCISES.bench!.id;
      await updateExercise(local.db, {
        ...AUTHOR,
        role: 'admin',
        exerciseId: bench,
        note: 'Uwaga na łokcie',
      });

      const [row] = await local.db.select().from(exercises).where(eq(exercises.id, bench));
      expect(row?.note).toBe('Uwaga na łokcie');
    });

    it('usunięcie jest miękkie, kolejkowane i znika z biblioteki', async () => {
      const saved = await add('Wyciskanie francuskie');
      await deleteExercise(local.db, saved.id, AUTHOR);

      const [row] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
      expect(row?.deletedAt).not.toBeNull();

      const library = await exerciseLibrary(local.db, TEST_USER.id);
      expect(library.map((entry) => entry.id)).not.toContain(saved.id);

      const queued = await local.db.select().from(outbox);
      expect(queued.at(-1)).toMatchObject({ entity: 'exercise', rowId: saved.id });
    });

    it('ćwiczenia z zapisaną serią nie da się usunąć', async () => {
      const saved = await add('Wyciskanie francuskie');
      const set = await createSet(local.db, {
        userId: AUTHOR.userId,
        deviceId: AUTHOR.deviceId,
        exerciseId: saved.id,
        performedOn: '2026-08-11',
        values: {
          weightG: 30_000,
          reps: 10,
          durationS: null,
          distanceM: null,
          bodyweightG: null,
          note: null,
        },
      });

      // Usunięcie miękkie zostawiało serię z ćwiczeniem, którego dla właściciela
      // już nie ma — czyli z wpisem bez nazwy w dniu treningowym. Duplikat scala
      // administrator w panelu, a pomyłkę kasuje się razem z jej serią.
      await expect(deleteExercise(local.db, saved.id, AUTHOR)).rejects.toThrow(/logged sets/);

      const [row] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
      expect(row?.deletedAt).toBeNull();

      await deleteSet(local.db, set.id, AUTHOR);
      await deleteExercise(local.db, saved.id, AUTHOR);

      const [removed] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
      expect(removed?.deletedAt).not.toBeNull();
    });

    it('utworzenie po usunięciu przywraca ten sam wiersz', async () => {
      const saved = await add('Wyciskanie francuskie');
      await deleteExercise(local.db, saved.id, AUTHOR);
      const again = await add('Wyciskanie francuskie');

      expect(again).toEqual({ id: saved.id, created: true });

      const [row] = await local.db.select().from(exercises).where(eq(exercises.id, saved.id));
      expect(row?.deletedAt).toBeNull();
    });

    it('nie da się edytować ćwiczenia, którego już nie ma', async () => {
      const saved = await add('Wyciskanie francuskie');
      await deleteExercise(local.db, saved.id, AUTHOR);

      await expect(
        updateExercise(local.db, { ...AUTHOR, exerciseId: saved.id, name: 'Cokolwiek' }),
      ).rejects.toThrow(/No exercise with ID/);
    });
  });

  it('ćwiczenie innego autora o tej samej nazwie dostaje inny identyfikator', () => {
    // Nie przez bazę, bo drugiego konta nie ma w cache'u — reguła jest w rdzeniu.
    expect(computeExerciseId(TEST_USER.id, 'Rozpiętki')).not.toBe(
      computeExerciseId(OTHER.userId, 'Rozpiętki'),
    );
  });
});
