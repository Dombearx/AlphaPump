/**
 * Synchronizacja — kryterium ukończenia etapu 4.
 *
 * „Testy integracyjne symulujące dwa urządzenia pracujące offline potwierdzają
 * wszystkie trzy reguły konfliktów, w tym scenariusz «jedno usuwa, drugie
 * edytuje»." Dwa urządzenia są tu odwzorowane dosłownie: dwa różne `deviceId`
 * pchające do jednej bazy własne wersje tych samych wierszy, w obu kolejnościach.
 *
 * Kolejność ma znaczenie osobno, bo rozstrzygnięcie **nie może** od niej
 * zależeć: gdyby zależało, dwa telefony po pełnej synchronizacji miałyby różną
 * treść, a nikt by tego nie zauważył.
 */

import {
  builtInExerciseId,
  exerciseId,
  newCycleGoalId,
  newCycleId,
  newDeviceId,
  newSetId,
  tagId,
  type SyncPullResponse,
  type SyncPushResponse,
} from '@alphapump/core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';
import type { AffectedScope } from '../src/sync/derived.js';

const BENCH = builtInExerciseId('Wyciskanie sztangi leżąc');
const SQUAT = builtInExerciseId('Przysiad ze sztangą');
const PLANK = builtInExerciseId('Deska');

const DAY = '2026-08-10';

const T = {
  early: '2026-08-10T08:00:00.000Z',
  middle: '2026-08-10T09:00:00.000Z',
  late: '2026-08-10T10:00:00.000Z',
} as const;

interface SetPushInput {
  id: string;
  exerciseId?: string;
  performedOn?: string;
  position?: number;
  weightG?: number | null;
  reps?: number | null;
  durationS?: number | null;
  distanceM?: number | null;
  bodyweightG?: number | null;
  note?: string | null;
  createdAt?: string;
  updatedAt?: string;
  deletedAt?: string | null;
}

/** Seria w kształcie paczki pushu; niewypełnione pomiary zostają puste. */
function setPush(input: SetPushInput) {
  return {
    id: input.id,
    exerciseId: input.exerciseId ?? BENCH,
    performedOn: input.performedOn ?? DAY,
    position: input.position ?? 0,
    weightG: input.weightG ?? null,
    reps: input.reps ?? null,
    durationS: input.durationS ?? null,
    distanceM: input.distanceM ?? null,
    bodyweightG: input.bodyweightG ?? null,
    note: input.note ?? null,
    createdAt: input.createdAt ?? T.early,
    updatedAt: input.updatedAt ?? input.createdAt ?? T.early,
    deletedAt: input.deletedAt ?? null,
  };
}

/** Seria typu „ciężar + powtórzenia" — najczęstszy przypadek w tych testach. */
const weightReps = (input: SetPushInput & { kilograms: number; reps: number }) =>
  setPush({ ...input, weightG: input.kilograms * 1000, reps: input.reps });

interface PushBody {
  tags: unknown[];
  exercises: unknown[];
  cycles: unknown[];
  sets: unknown[];
}

/** Jedno urządzenie: własny `deviceId`, własne żądania, wspólne konto. */
function device(harness: Harness, user: TestUser, id = newDeviceId()) {
  return {
    id,
    push: async (changes: Partial<PushBody>) =>
      harness.json<SyncPushResponse>('POST', '/sync/push', {
        headers: user.headers,
        body: { deviceId: id, ...changes },
      }),
    pull: async (since = 0, limit?: number) =>
      harness.json<SyncPullResponse>(
        'GET',
        `/sync/pull?since=${since}${limit === undefined ? '' : `&limit=${limit}`}`,
        { headers: user.headers },
      ),
  };
}

type Device = ReturnType<typeof device>;

describe('synchronizacja', () => {
  let harness: Harness;
  let user: TestUser;
  let phone: Device;
  let tablet: Device;

  beforeEach(async () => {
    harness = await createHarness();
    user = await harness.signUp('sync@example.com');
    // Identyfikatory dobrane tak, by remis rozstrzygał się na korzyść tabletu.
    phone = device(harness, user, '00000000-0000-7000-8000-0000000000a1');
    tablet = device(harness, user, '00000000-0000-7000-8000-0000000000b2');
  });

  afterEach(async () => {
    await harness.close();
  });

  /* ------------------------------------------------------------------- suma */

  describe('dwa urządzenia dodają różne serie', () => {
    it('zachowuje obie serie i nie tworzy duplikatów', async () => {
      const fromPhone = newSetId();
      const fromTablet = newSetId();

      await phone.push({ sets: [weightReps({ id: fromPhone, kilograms: 80, reps: 8 })] });
      await tablet.push({
        sets: [weightReps({ id: fromTablet, kilograms: 82.5, reps: 6, position: 1 })],
      });

      const pulled = await phone.pull();
      const ids = pulled.body.changes.sets.map((set) => set.id).sort();
      expect(ids).toEqual([fromPhone, fromTablet].sort());
    });

    it('ta sama seria wysłana dwa razy nie tworzy drugiego wiersza', async () => {
      // Zerwane połączenie po zapisie na serwerze, a przed potwierdzeniem:
      // outbox wyśle wpis jeszcze raz i to jest normalna sytuacja, nie błąd.
      const id = newSetId();
      const payload = { sets: [weightReps({ id, kilograms: 80, reps: 8 })] };

      const first = await phone.push(payload);
      const second = await phone.push(payload);

      expect(first.body.results[0]?.decision).toBe('insert');
      expect(second.body.results[0]?.decision).toBe('stale');

      const pulled = await phone.pull();
      expect(pulled.body.changes.sets).toHaveLength(1);
    });
  });

  /* -------------------------------------------------------------------- LWW */

  describe('dwa urządzenia edytują tę samą serię', () => {
    const id = newSetId();

    beforeEach(async () => {
      await phone.push({ sets: [weightReps({ id, kilograms: 80, reps: 8 })] });
    });

    it('obowiązuje wersja zapisana później', async () => {
      await phone.push({
        sets: [weightReps({ id, kilograms: 80, reps: 9, updatedAt: T.middle })],
      });
      const response = await tablet.push({
        sets: [weightReps({ id, kilograms: 80, reps: 12, updatedAt: T.late })],
      });

      expect(response.body.results[0]?.decision).toBe('update');
      expect(response.body.changes.sets[0]?.reps).toBe(12);
    });

    it('daje ten sam wynik przy odwrotnej kolejności pushy', async () => {
      // Najpierw dojeżdża wersja późniejsza, potem wcześniejsza — telefon,
      // który miał gorszy zasięg, nie może cofnąć cudzej edycji.
      await tablet.push({
        sets: [weightReps({ id, kilograms: 80, reps: 12, updatedAt: T.late })],
      });
      const response = await phone.push({
        sets: [weightReps({ id, kilograms: 80, reps: 9, updatedAt: T.middle })],
      });

      expect(response.body.results[0]?.decision).toBe('stale');
      // Przegrany dostaje w odpowiedzi wersję serwerową — inaczej zostałby ze
      // swoją na zawsze, bo jej `server_seq` jest już za jego kursorem.
      expect(response.body.changes.sets[0]?.reps).toBe(12);
    });

    it('przy remisie czasu rozstrzyga identyfikator urządzenia', async () => {
      await phone.push({ sets: [weightReps({ id, kilograms: 80, reps: 9, updatedAt: T.late })] });
      const response = await tablet.push({
        sets: [weightReps({ id, kilograms: 80, reps: 11, updatedAt: T.late })],
      });

      expect(response.body.results[0]?.decision).toBe('update');
      expect(response.body.changes.sets[0]?.reps).toBe(11);
    });

    it('przycina znacznik z przyszłości do „teraz" serwera', async () => {
      const future = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
      const response = await phone.push({
        sets: [weightReps({ id, kilograms: 80, reps: 15, updatedAt: future })],
      });

      const stored = response.body.changes.sets[0];
      expect(stored?.reps).toBe(15);
      // Bez przycięcia telefon z przestawionym zegarem wygrywałby każdy kolejny
      // konflikt aż do chwili, w której reszta świata by go dogoniła.
      expect(new Date(stored!.updatedAt).getTime()).toBeLessThanOrEqual(Date.now() + 1000);
    });
  });

  /* -------------------------------------------------------- usunięcie wygrywa */

  describe('jedno urządzenie usuwa, drugie edytuje', () => {
    const id = newSetId();

    beforeEach(async () => {
      await phone.push({ sets: [weightReps({ id, kilograms: 80, reps: 8 })] });
    });

    it('usunięcie wygrywa z późniejszą edycją', async () => {
      await phone.push({
        sets: [
          weightReps({ id, kilograms: 80, reps: 8, updatedAt: T.middle, deletedAt: T.middle }),
        ],
      });
      const response = await tablet.push({
        sets: [weightReps({ id, kilograms: 80, reps: 12, updatedAt: T.late })],
      });

      expect(response.body.results[0]?.decision).toBe('deleted');
      expect(response.body.changes.sets[0]?.deletedAt).not.toBeNull();
      expect(response.body.changes.sets[0]?.reps).toBe(8);
    });

    it('usunięcie wygrywa także wtedy, gdy dojeżdża po edycji', async () => {
      await tablet.push({
        sets: [weightReps({ id, kilograms: 80, reps: 12, updatedAt: T.late })],
      });
      const response = await phone.push({
        sets: [
          weightReps({ id, kilograms: 80, reps: 8, updatedAt: T.middle, deletedAt: T.middle }),
        ],
      });

      expect(response.body.results[0]?.decision).toBe('delete');
      expect(response.body.changes.sets[0]?.deletedAt).not.toBeNull();
    });

    it('usunięcie dojeżdża na drugie urządzenie jako tombstone', async () => {
      const beforeDelete = await tablet.pull();
      await phone.push({
        sets: [
          weightReps({ id, kilograms: 80, reps: 8, updatedAt: T.middle, deletedAt: T.middle }),
        ],
      });

      const afterDelete = await tablet.pull(beforeDelete.body.cursor);
      expect(afterDelete.body.changes.sets).toHaveLength(1);
      expect(afterDelete.body.changes.sets[0]?.deletedAt).not.toBeNull();
    });
  });

  /* ------------------------------------------------------- paczka mieszana */

  describe('paczka z wieloma encjami', () => {
    it('przyjmuje nowy tag, ćwiczenie i serię naraz', async () => {
      // Scenariusz „wymyśliłem nowe ćwiczenie na siłowni bez zasięgu": nic
      // z tej paczki nie istnieje jeszcze na serwerze i wszystko zależy od
      // czegoś, co jedzie tą samą paczką.
      const tagName = 'Odważnik kulowy';
      const exerciseName = 'Wymach odważnikiem';
      const newTagId = tagId(tagName);
      const newExerciseId = exerciseId(user.id, exerciseName);
      const id = newSetId();

      const response = await phone.push({
        tags: [
          { id: newTagId, name: tagName, createdAt: T.early, updatedAt: T.early, deletedAt: null },
        ],
        exercises: [
          {
            id: newExerciseId,
            name: exerciseName,
            authorId: user.id,
            loggingType: 'weight_reps',
            primaryTagId: newTagId,
            additionalTagIds: [],
            note: null,
            createdAt: T.early,
            updatedAt: T.early,
            deletedAt: null,
          },
        ],
        sets: [weightReps({ id, exerciseId: newExerciseId, kilograms: 24, reps: 20 })],
      });

      expect(response.status).toBe(200);
      expect(response.body.results.map((result) => result.decision)).toEqual([
        'insert',
        'insert',
        'insert',
      ]);
      expect(response.body.cursor).toBeGreaterThan(0);
    });

    it('odrzucony wiersz nie zatrzymuje reszty paczki', async () => {
      // Gdyby jedna zatruta mutacja kończyła całe żądanie błędem, outbox
      // urządzenia stanąłby na niej na zawsze.
      const good = newSetId();
      const bad = newSetId();

      const response = await phone.push({
        sets: [
          weightReps({ id: good, kilograms: 80, reps: 8 }),
          // Dystans przy wyciskaniu sztangi — pomiar spoza typu logowania.
          setPush({ id: bad, distanceM: 5000, durationS: 1800 }),
        ],
      });

      const byId = new Map(response.body.results.map((result) => [result.id, result]));
      expect(byId.get(good)?.decision).toBe('insert');
      expect(byId.get(bad)?.decision).toBe('rejected');
      expect(byId.get(bad)?.reason).toContain('weight_reps');

      const pulled = await phone.pull();
      expect(pulled.body.changes.sets.map((set) => set.id)).toEqual([good]);
    });

    it('odrzuca serię wskazującą na nieistniejące ćwiczenie', async () => {
      const response = await phone.push({
        sets: [weightReps({ id: newSetId(), exerciseId: newSetId(), kilograms: 80, reps: 8 })],
      });
      expect(response.body.results[0]?.decision).toBe('rejected');
      expect(response.body.results[0]?.reason).toContain('Ćwiczenie');
    });

    it('przyjmuje cykl razem z pozycjami celu', async () => {
      const id = newCycleId();
      const response = await phone.push({
        cycles: [
          {
            id,
            name: 'Sierpień na nogi',
            startsOn: '2026-08-01',
            endsOn: '2026-08-31',
            archivedAt: null,
            goals: [
              { id: newCycleGoalId(), metric: 'sets', target: 12, exerciseId: SQUAT, tagId: null },
              {
                id: newCycleGoalId(),
                metric: 'duration',
                target: 600,
                exerciseId: PLANK,
                tagId: null,
              },
            ],
            createdAt: T.early,
            updatedAt: T.early,
            deletedAt: null,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('insert');
      expect(response.body.changes.cycles[0]?.goals).toHaveLength(2);
    });
  });

  /* ------------------------------------------------------------ odtworzenie */

  describe('odtworzenie skasowanej encji', () => {
    it('ćwiczenie utworzone po usunięciu wraca do życia', async () => {
      // Identyfikator ćwiczenia jest deterministyczny, więc bez tej furtki
      // skasowany „Wymach odważnikiem" nie dałby się już nigdy dodać z powrotem.
      const name = 'Wymach odważnikiem';
      const id = exerciseId(user.id, name);
      const tagName = 'Odważnik kulowy';
      const newTagId = tagId(tagName);

      const base = {
        id,
        name,
        authorId: user.id,
        loggingType: 'weight_reps' as const,
        primaryTagId: newTagId,
        additionalTagIds: [],
        note: null,
      };

      await phone.push({
        tags: [
          { id: newTagId, name: tagName, createdAt: T.early, updatedAt: T.early, deletedAt: null },
        ],
        exercises: [{ ...base, createdAt: T.early, updatedAt: T.early, deletedAt: null }],
      });
      await phone.push({
        exercises: [{ ...base, createdAt: T.early, updatedAt: T.middle, deletedAt: T.middle }],
      });

      const recreated = await phone.push({
        exercises: [{ ...base, createdAt: T.late, updatedAt: T.late, deletedAt: null }],
      });

      expect(recreated.body.results[0]?.decision).toBe('insert');
      expect(recreated.body.changes.exercises[0]?.deletedAt).toBeNull();
    });

    it('spóźniona edycja skasowanego ćwiczenia dalej przegrywa', async () => {
      const name = 'Wymach odważnikiem';
      const id = exerciseId(user.id, name);
      const tagName = 'Odważnik kulowy';
      const newTagId = tagId(tagName);
      const base = {
        id,
        name,
        authorId: user.id,
        loggingType: 'weight_reps' as const,
        primaryTagId: newTagId,
        additionalTagIds: [],
        note: null,
      };

      await phone.push({
        tags: [
          { id: newTagId, name: tagName, createdAt: T.early, updatedAt: T.early, deletedAt: null },
        ],
        exercises: [{ ...base, createdAt: T.early, updatedAt: T.early, deletedAt: null }],
      });
      await phone.push({
        exercises: [{ ...base, createdAt: T.early, updatedAt: T.middle, deletedAt: T.middle }],
      });

      // Tablet edytuje ćwiczenie utworzone **przed** usunięciem — to jest
      // spóźniona edycja, a nie świadome odtworzenie.
      const late = await tablet.push({
        exercises: [{ ...base, name, createdAt: T.early, updatedAt: T.late, deletedAt: null }],
      });

      expect(late.body.results[0]?.decision).toBe('deleted');
      expect(late.body.changes.exercises[0]?.deletedAt).not.toBeNull();
    });
  });

  /* -------------------------------------------------------------- uprawnienia */

  describe('uprawnienia', () => {
    it('nie pozwala wypchnąć zmiany w cudzej serii', async () => {
      const intruder = await harness.signUp('intruz@example.com');
      const id = newSetId();
      await phone.push({ sets: [weightReps({ id, kilograms: 80, reps: 8 })] });

      const response = await device(harness, intruder).push({
        sets: [weightReps({ id, kilograms: 200, reps: 30, updatedAt: T.late })],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');

      const mine = await phone.pull();
      expect(mine.body.changes.sets[0]?.weightG).toBe(80_000);
    });

    it('nie pozwala zwykłemu użytkownikowi zmienić cudzego ćwiczenia', async () => {
      const author = await harness.signUp('autor@example.com');
      const name = 'Wymach odważnikiem';
      const id = exerciseId(author.id, name);
      const tagName = 'Odważnik kulowy';
      const newTagId = tagId(tagName);
      const base = {
        id,
        name,
        authorId: author.id,
        loggingType: 'weight_reps' as const,
        primaryTagId: newTagId,
        additionalTagIds: [],
        note: null,
      };

      await device(harness, author).push({
        tags: [
          { id: newTagId, name: tagName, createdAt: T.early, updatedAt: T.early, deletedAt: null },
        ],
        exercises: [{ ...base, createdAt: T.early, updatedAt: T.early, deletedAt: null }],
      });

      const response = await phone.push({
        exercises: [
          { ...base, note: 'moje teraz', createdAt: T.early, updatedAt: T.late, deletedAt: null },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');
      expect(response.body.changes.exercises[0]?.note).toBeNull();
    });

    it('nie pozwala zwykłemu użytkownikowi zmienić tagu', async () => {
      const response = await phone.push({
        tags: [
          {
            id: tagId('Biceps'),
            name: 'Bicepsy',
            createdAt: T.early,
            updatedAt: T.late,
            deletedAt: null,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');
      expect(response.body.results[0]?.reason).toContain('administrator');
    });

    it('odrzuca tag o identyfikatorze niewynikającym z nazwy', async () => {
      // Deduplikacja tagów stoi na tym, że id wylicza się ze sluga nazwy.
      const response = await phone.push({
        tags: [
          {
            id: newSetId(),
            name: 'Kettlebell',
            createdAt: T.early,
            updatedAt: T.early,
            deletedAt: null,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');
    });

    it('przyjmuje zmianę nazwy tagu, choć jego id wynika z nazwy poprzedniej', async () => {
      // Identyfikator tagu wylicza się z nazwy **przy tworzeniu** i po zmianie
      // nazwy przestaje jej odpowiadać — celowo, bo inaczej poprawienie literówki
      // osierociłoby wszystkie ćwiczenia z tym tagiem. Gdyby sprawdzenie „id
      // wynika z nazwy" obejmowało też edycję, raz przemianowany tag nie dałby
      // się już nigdy zsynchronizować.
      await harness.promoteToAdmin(user);

      const response = await phone.push({
        tags: [
          {
            id: tagId('Biceps'),
            name: 'Bicepsy',
            createdAt: T.early,
            updatedAt: T.late,
            deletedAt: null,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('update');
      expect(response.body.changes.tags[0]?.name).toBe('Bicepsy');
    });

    it('nie pozwala usunąć tagu używanego przez ćwiczenia', async () => {
      // Ta sama reguła co przy `DELETE /tags/:id`. Push nie może być wejściem,
      // przez które ćwiczenia tracą tag główny — nawet dla administratora.
      await harness.promoteToAdmin(user);

      const response = await phone.push({
        tags: [
          {
            id: tagId('Biceps'),
            name: 'Biceps',
            createdAt: T.early,
            updatedAt: T.late,
            deletedAt: T.late,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');
      expect(response.body.results[0]?.reason).toContain('używany');
      // Odpowiedź niesie stan serwerowy, więc telefon nie zostaje z tombstonem,
      // który przegrał.
      expect(response.body.changes.tags[0]?.deletedAt).toBeNull();
    });

    it('odmawia zmiany typu logowania ćwiczenia', async () => {
      const name = 'Wymach odważnikiem';
      const id = exerciseId(user.id, name);
      const tagName = 'Odważnik kulowy';
      const newTagId = tagId(tagName);
      const base = {
        id,
        name,
        authorId: user.id,
        primaryTagId: newTagId,
        additionalTagIds: [],
        note: null,
      };

      await phone.push({
        tags: [
          { id: newTagId, name: tagName, createdAt: T.early, updatedAt: T.early, deletedAt: null },
        ],
        exercises: [
          {
            ...base,
            loggingType: 'weight_reps',
            createdAt: T.early,
            updatedAt: T.early,
            deletedAt: null,
          },
        ],
      });

      const response = await phone.push({
        exercises: [
          {
            ...base,
            loggingType: 'distance_time',
            createdAt: T.early,
            updatedAt: T.late,
            deletedAt: null,
          },
        ],
      });

      expect(response.body.results[0]?.decision).toBe('rejected');
      expect(response.body.results[0]?.reason).toContain('nieedytowalny');
    });
  });

  /* --------------------------------------------------------------- pobieranie */

  describe('pobieranie zmian', () => {
    it('pierwszy pull przywozi seed i konto właściciela', async () => {
      const pulled = await phone.pull();
      expect(pulled.body.changes.tags.length).toBeGreaterThan(0);
      expect(pulled.body.changes.exercises.length).toBeGreaterThan(0);
      expect(pulled.body.changes.users.map((row) => row.id)).toContain(user.id);
    });

    it('adres e-mail schodzi wyłącznie do właściciela konta', async () => {
      const other = await harness.signUp('inny@example.com');
      const pulled = await phone.pull();

      const byId = new Map(pulled.body.changes.users.map((row) => [row.id, row]));
      expect(byId.get(user.id)?.email).toBe(user.email);
      expect(byId.get(other.id)?.email).toBeNull();
      expect(byId.get(other.id)?.nickname).toBeTruthy();
    });

    it('nie przywozi cudzych serii ani cykli', async () => {
      const other = await harness.signUp('obcy@example.com');
      await device(harness, other).push({
        sets: [weightReps({ id: newSetId(), kilograms: 100, reps: 5 })],
      });

      const pulled = await phone.pull();
      expect(pulled.body.changes.sets).toHaveLength(0);
    });

    it('kursor przesuwa się i drugi pull nie powtarza wierszy', async () => {
      const first = await phone.pull();
      expect(first.body.cursor).toBeGreaterThan(0);

      const second = await phone.pull(first.body.cursor);
      expect(second.body.changes.sets).toHaveLength(0);
      expect(second.body.changes.tags).toHaveLength(0);
      expect(second.body.cursor).toBe(first.body.cursor);
    });

    it('sygnalizuje, że paczka została ucięta limitem', async () => {
      const small = await phone.pull(0, 5);
      expect(small.body.hasMore).toBe(true);

      // Kompletność mimo cięcia: pobieranie kolejnych paczek dowozi wszystko.
      let cursor = small.body.cursor;
      let guard = 0;
      let hasMore = small.body.hasMore;
      while (hasMore && guard < 50) {
        const next = await phone.pull(cursor, 5);
        cursor = next.body.cursor;
        hasMore = next.body.hasMore;
        guard += 1;
      }
      expect(hasMore).toBe(false);
    });

    it('wiersze w paczce są posortowane po kursorze', async () => {
      const pulled = await phone.pull(0, 50);
      const sequences = [
        ...pulled.body.changes.users.map((row) => row.serverSeq),
        ...pulled.body.changes.tags.map((row) => row.serverSeq),
        ...pulled.body.changes.exercises.map((row) => row.serverSeq),
      ];
      expect(Math.max(...sequences)).toBeLessThanOrEqual(pulled.body.cursor);
    });
  });

  /* ---------------------------------------------------------- dane pochodne */

  describe('przeliczanie danych pochodnych', () => {
    it('dostaje dokładnie te ćwiczenia, których dotknął push', async () => {
      const scopes: AffectedScope[] = [];
      const spy = await createHarness({
        derived: [
          async (_db, scope) => {
            scopes.push(scope);
          },
        ],
      });
      const owner = await spy.signUp('pochodne@example.com');
      const spyDevice = device(spy, owner);

      await spyDevice.push({
        sets: [
          weightReps({ id: newSetId(), kilograms: 80, reps: 8 }),
          weightReps({ id: newSetId(), exerciseId: SQUAT, kilograms: 100, reps: 5, position: 1 }),
        ],
      });

      expect(scopes).toHaveLength(1);
      expect([...(scopes[0]?.exercisesByUser.get(owner.id) ?? [])].sort()).toEqual(
        [BENCH, SQUAT].sort(),
      );

      // Push bez serii nie ma czego przeliczać — rekordy są funkcją serii.
      await spyDevice.push({
        tags: [
          {
            id: tagId('Odważnik kulowy'),
            name: 'Odważnik kulowy',
            createdAt: T.early,
            updatedAt: T.early,
            deletedAt: null,
          },
        ],
      });
      expect(scopes).toHaveLength(1);

      await spy.close();
    });
  });

  /* ------------------------------------------------------------- tombstone'y */

  describe('porządkowanie tombstone’ów', () => {
    it('zdejmuje stare tombstone’y, a świeże zostawia', async () => {
      const old = newSetId();
      const fresh = newSetId();
      const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();

      await phone.push({
        sets: [
          weightReps({ id: old, kilograms: 80, reps: 8, createdAt: longAgo, updatedAt: longAgo }),
          weightReps({ id: fresh, kilograms: 82, reps: 8, position: 1 }),
        ],
      });
      await phone.push({
        sets: [
          weightReps({
            id: old,
            kilograms: 80,
            reps: 8,
            createdAt: longAgo,
            updatedAt: longAgo,
            deletedAt: longAgo,
          }),
          weightReps({
            id: fresh,
            kilograms: 82,
            reps: 8,
            position: 1,
            updatedAt: T.late,
            deletedAt: T.late,
          }),
        ],
      });

      await harness.promoteToAdmin(user);
      const pruned = await harness.json<{ removed: { sets: number } }>(
        'POST',
        '/sync/tombstones/prune',
        { headers: user.headers, body: { olderThanDays: 90 } },
      );

      expect(pruned.status).toBe(200);
      expect(pruned.body.removed.sets).toBe(1);

      const remaining = await phone.pull();
      expect(remaining.body.changes.sets.map((set) => set.id)).toEqual([fresh]);
    });

    it('nie rusza ćwiczenia, na które wskazuje jakakolwiek seria', async () => {
      // Usunięcie miękkie utrzymuje spójność; twarde by ją złamało i seria
      // straciłaby to, na co wskazuje.
      const longAgo = new Date(Date.now() - 200 * 24 * 3600 * 1000).toISOString();
      const name = 'Wymach odważnikiem';
      const id = exerciseId(user.id, name);
      const newTagId = tagId('Odważnik kulowy');
      const base = {
        id,
        name,
        authorId: user.id,
        loggingType: 'weight_reps' as const,
        primaryTagId: newTagId,
        additionalTagIds: [],
        note: null,
      };

      await phone.push({
        tags: [
          {
            id: newTagId,
            name: 'Odważnik kulowy',
            createdAt: longAgo,
            updatedAt: longAgo,
            deletedAt: null,
          },
        ],
        exercises: [{ ...base, createdAt: longAgo, updatedAt: longAgo, deletedAt: null }],
        sets: [weightReps({ id: newSetId(), exerciseId: id, kilograms: 24, reps: 20 })],
      });
      await phone.push({
        exercises: [{ ...base, createdAt: longAgo, updatedAt: longAgo, deletedAt: longAgo }],
      });

      await harness.promoteToAdmin(user);
      const pruned = await harness.json<{ removed: { exercises: number } }>(
        'POST',
        '/sync/tombstones/prune',
        { headers: user.headers, body: { olderThanDays: 90 } },
      );

      expect(pruned.body.removed.exercises).toBe(0);
    });

    it('jest zastrzeżone dla administratora', async () => {
      const response = await harness.json('POST', '/sync/tombstones/prune', {
        headers: user.headers,
        body: {},
      });
      expect(response.status).toBe(403);
    });
  });

  /* ------------------------------------------------------------ dwa urządzenia */

  it('po pełnej synchronizacji oba urządzenia widzą to samo', async () => {
    // Kryterium akceptacyjne ze specyfikacji: „równoległa praca na dwóch
    // urządzeniach offline nie powoduje po synchronizacji ani utraty serii,
    // ani duplikatów".
    const offlineOnPhone = [newSetId(), newSetId()];
    const offlineOnTablet = [newSetId()];
    const contested = newSetId();

    await phone.push({
      sets: [
        weightReps({ id: offlineOnPhone[0]!, kilograms: 80, reps: 8 }),
        weightReps({ id: offlineOnPhone[1]!, kilograms: 80, reps: 7, position: 1 }),
        weightReps({ id: contested, exerciseId: SQUAT, kilograms: 100, reps: 5 }),
      ],
    });
    await tablet.push({
      sets: [
        setPush({ id: offlineOnTablet[0]!, exerciseId: PLANK, durationS: 90 }),
        weightReps({
          id: contested,
          exerciseId: SQUAT,
          kilograms: 105,
          reps: 5,
          updatedAt: T.late,
        }),
      ],
    });

    const fromPhone = await phone.pull(0, 500);
    const fromTablet = await tablet.pull(0, 500);

    const ids = (response: SyncPullResponse) =>
      response.changes.sets
        .filter((set) => set.deletedAt === null)
        .map((set) => set.id)
        .sort();

    // Serie dodane niezależnie sumują się, sporny wiersz jest jeden — żadna
    // seria nie zginęła i żadna nie zdublowała się.
    expect(ids(fromPhone.body)).toEqual(ids(fromTablet.body));
    expect(ids(fromPhone.body)).toEqual([...offlineOnPhone, ...offlineOnTablet, contested].sort());

    const contestedRow = fromPhone.body.changes.sets.find((set) => set.id === contested);
    expect(contestedRow?.weightG).toBe(105_000);
  });
});
