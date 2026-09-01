/**
 * Porządkowanie biblioteki z panelu administracyjnego.
 *
 * Wszystko tutaj kręci się wokół jednej reguły: **nic z zalogowanego nie ginie**.
 * Z niej wynikają obie połowy tego pliku — blokady (ćwiczenia i tagu, na którym
 * coś wisi, nie da się usunąć żadnym z dwóch wejść) i wyjście z sytuacji, którą
 * te blokady tworzą (scalenie przenosi serie, zanim cokolwiek zniknie).
 *
 * Scenariusz przewodni jest ten, dla którego to powstało: to samo ćwiczenie
 * trafiło do bazy dwa razy, w obu wersjach leżą serie, i trzeba z tego zrobić
 * jeden wiersz bez utraty ani jednej serii.
 */

import { EMBEDDING_DIMENSIONS } from '@alphapump/db';
import { builtInExerciseId, tagId } from '@alphapump/core';
import type {
  EmbeddingRefreshReport,
  Exercise,
  ExerciseMergeReport,
  LibraryExercise,
  LibraryTag,
  Tag,
  TagMergeReport,
  WorkoutSet,
} from '@alphapump/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Embedder } from '../src/duplicates/layers.js';
import { exerciseEmbeddings, exerciseRecords, workoutSets } from '../src/schema.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

/**
 * Wektor bez znaczenia, byle stabilny i różny dla różnych tekstów. Ten test
 * sprawdza **kiedy** wektory powstają, a nie co znaczą.
 */
function countingEmbedder(): Embedder {
  return {
    model: 'atrapa-liczaca',
    embed(text) {
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
      let hash = 7;
      for (const character of text) hash = (hash * 31 + character.charCodeAt(0)) % 900;
      vector[hash] = 1;
      return Promise.resolve(vector);
    },
  };
}

const BICEPS = tagId('biceps');
const CHEST = tagId('chest');
const BENCH = builtInExerciseId('Flat barbell bench press');

/** Ćwiczenie o podanej nazwie, utworzone przez wskazane konto. */
async function createExercise(
  harness: Harness,
  user: TestUser,
  name: string,
  extra: Record<string, unknown> = {},
): Promise<Exercise> {
  const response = await harness.json<Exercise>('POST', '/exercises', {
    headers: user.headers,
    body: { name, loggingType: 'weight_reps', primaryTagId: BICEPS, ...extra },
  });
  return response.body;
}

async function logSet(
  harness: Harness,
  user: TestUser,
  exerciseId: string,
  performedOn: string,
  weightG: number,
): Promise<WorkoutSet> {
  const response = await harness.json<WorkoutSet>('POST', '/sets', {
    headers: user.headers,
    body: { exerciseId, performedOn, weightG, reps: 8, durationS: null, distanceM: null },
  });
  return response.body;
}

describe('panel: porządkowanie biblioteki', () => {
  let harness: Harness;
  let admin: TestUser;
  let member: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    admin = await harness.signUp('szef@example.com', 'haslo-testowe-123', 'Szef');
    member = await harness.signUp('kuba@example.com', 'haslo-testowe-123', 'Kuba');
    await harness.promoteToAdmin(admin);
  });

  afterAll(async () => {
    await harness.close();
  });

  it('zastrzega cały zakres dla administratora', async () => {
    for (const path of ['/admin/library/exercises', '/admin/library/tags']) {
      const denied = await harness.json('GET', path, { headers: member.headers });
      expect(denied.status).toBe(403);
    }
  });

  describe('widok użycia', () => {
    it('niesie przy ćwiczeniu liczby, po których widać, co na nim wisi', async () => {
      const exercise = await createExercise(harness, member, 'Uginanie ze sztangielkami');
      await logSet(harness, member, exercise.id, '2026-03-01', 20_000);
      await logSet(harness, member, exercise.id, '2026-03-08', 22_000);

      const response = await harness.json<{ exercises: LibraryExercise[] }>(
        'GET',
        '/admin/library/exercises',
        { headers: admin.headers },
      );
      expect(response.status).toBe(200);

      const row = response.body.exercises.find((entry) => entry.exercise.id === exercise.id);
      expect(row).toMatchObject({
        authorNickname: 'Kuba',
        builtIn: false,
        usage: { sets: 2, deletedSets: 0, users: 1, goals: 0, lastPerformedOn: '2026-03-08' },
      });

      // Ćwiczenia wbudowane są w tej samej liście i widać po nich, że są z seeda —
      // to jest ta informacja, której brakowało przy sprzątaniu po nieudanym
      // wgraniu startowej listy ćwiczeń.
      const bench = response.body.exercises.find((entry) => entry.exercise.id === BENCH);
      expect(bench?.builtIn).toBe(true);
      expect(bench?.usage.sets).toBe(0);
    });

    it('niesie przy tagu ćwiczenia główne, dodatkowe i serie', async () => {
      const response = await harness.json<{ tags: LibraryTag[] }>('GET', '/admin/library/tags', {
        headers: admin.headers,
      });
      expect(response.status).toBe(200);

      const biceps = response.body.tags.find((entry) => entry.tag.id === BICEPS);
      expect(biceps?.builtIn).toBe(true);
      expect(biceps?.usage.primaryExercises).toBeGreaterThan(0);
      expect(biceps?.usage.sets).toBeGreaterThan(0);
    });
  });

  describe('blokada usunięcia', () => {
    it('odmawia usunięcia ćwiczenia z zapisanymi seriami — obu wejściom', async () => {
      const exercise = await createExercise(harness, member, 'Z serią w środku');
      await logSet(harness, member, exercise.id, '2026-03-02', 30_000);

      // Wejście pierwsze: zwykły CRUD, także dla administratora.
      const byAdmin = await harness.json<{ error: { message: string } }>(
        'DELETE',
        `/exercises/${exercise.id}`,
        { headers: admin.headers },
      );
      expect(byAdmin.status).toBe(409);
      expect(byAdmin.body.error.message).toContain('logged sets');

      // Wejście drugie: tombstone w paczce synchronizacji. Bez tej blokady push
      // byłby drogą, przez którą reguła nie obowiązuje.
      const push = await harness.json<{ results: { entity: string; decision: string }[] }>(
        'POST',
        '/sync/push',
        {
          headers: member.headers,
          body: {
            deviceId: '00000000-0000-7000-8000-0000000000c1',
            tags: [],
            exercises: [
              {
                ...exercise,
                deletedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              },
            ],
            cycles: [],
            sets: [],
          },
        },
      );
      const decision = push.body.results.find((result) => result.entity === 'exercise');
      expect(decision?.decision).toBe('rejected');

      // Ćwiczenie dalej stoi w bibliotece — a więc seria dalej ma na co wskazywać.
      const library = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: member.headers,
      });
      expect(library.body.map((entry) => entry.id)).toContain(exercise.id);
    });

    it('pozwala usunąć ćwiczenie, z którego serie zdjęto', async () => {
      const exercise = await createExercise(harness, member, 'Pomyłka bez historii');
      const set = await logSet(harness, member, exercise.id, '2026-03-03', 10_000);

      const blocked = await harness.json('DELETE', `/exercises/${exercise.id}`, {
        headers: member.headers,
      });
      expect(blocked.status).toBe(409);

      await harness.json('DELETE', `/sets/${set.id}`, { headers: member.headers });

      const removed = await harness.json('DELETE', `/exercises/${exercise.id}`, {
        headers: member.headers,
      });
      expect(removed.status).toBe(204);
    });

    it('odmawia usunięcia ćwiczenia, na które wskazuje cel cyklu', async () => {
      // Bez serii, więc pierwsza połowa reguły tu nie działa. Cel, którego
      // ćwiczenie zniknęło, nigdy nic nie naliczy i nie powie o tym ani słowa.
      const exercise = await createExercise(harness, member, 'Cel cyklu bez serii');

      await harness.json('POST', '/cycles', {
        headers: member.headers,
        body: {
          name: 'Marzec',
          startsOn: '2026-03-01',
          goals: [{ metric: 'sets', target: 30, exerciseId: exercise.id, tagId: null }],
        },
      });

      const denied = await harness.json<{ error: { message: string } }>(
        'DELETE',
        `/exercises/${exercise.id}`,
        { headers: admin.headers },
      );
      expect(denied.status).toBe(409);
      expect(denied.body.error.message).toContain('cycle goals');
    });

    it('odmawia usunięcia tagu wskazanego przez cel cyklu', async () => {
      const created = await harness.json<Tag>('POST', '/tags', {
        headers: admin.headers,
        body: { name: 'Rotatory' },
      });

      await harness.json('POST', '/cycles', {
        headers: member.headers,
        body: {
          name: 'Barki',
          startsOn: '2026-03-01',
          goals: [{ metric: 'sets', target: 20, exerciseId: null, tagId: created.body.id }],
        },
      });

      const denied = await harness.json('DELETE', `/tags/${created.body.id}`, {
        headers: admin.headers,
      });
      expect(denied.status).toBe(409);
    });
  });

  describe('scalenie ćwiczeń', () => {
    it('przenosi serie obu użytkowników i zdejmuje dopiero puste źródło', async () => {
      // Dokładnie ta sytuacja, dla której to powstało: ten sam ruch wpisany
      // dwa razy, serie w obu wierszach.
      const first = await createExercise(harness, member, 'Wyciskanie hantli');
      const second = await createExercise(harness, admin, 'Wyciskanie hantli ');

      await logSet(harness, member, first.id, '2026-04-01', 30_000);
      await logSet(harness, member, first.id, '2026-04-08', 32_000);
      await logSet(harness, admin, second.id, '2026-04-02', 34_000);

      const merged = await harness.json<ExerciseMergeReport>(
        'POST',
        `/admin/library/exercises/${first.id}/merge`,
        { headers: admin.headers, body: { targetId: second.id } },
      );
      expect(merged.status).toBe(200);
      expect(merged.body).toMatchObject({ movedSets: 2, movedDeletedSets: 0, movedGoals: 0 });

      // Serie właściciela zostają jego — zmienia się wyłącznie ćwiczenie.
      const mine = await harness.json<WorkoutSet[]>('GET', `/sets?exerciseId=${second.id}`, {
        headers: member.headers,
      });
      expect(mine.body).toHaveLength(2);

      const library = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: admin.headers,
      });
      const ids = library.body.map((entry) => entry.id);
      expect(ids).toContain(second.id);
      expect(ids).not.toContain(first.id);

      // Rekordy globalne są funkcją całego zbioru serii ćwiczenia, więc muszą
      // ruszyć się po obu stronach scalenia.
      const onSource = await harness.db
        .select()
        .from(exerciseRecords)
        .where(eq(exerciseRecords.exerciseId, first.id));
      expect(onSource).toHaveLength(0);

      const onTarget = await harness.db
        .select()
        .from(exerciseRecords)
        .where(eq(exerciseRecords.exerciseId, second.id));
      expect(onTarget.length).toBeGreaterThan(0);
    });

    it('przenosi także serie z tombstonem', async () => {
      const source = await createExercise(harness, member, 'Ze skasowaną serią');
      const target = await createExercise(harness, member, 'Cel skasowanej serii');
      const set = await logSet(harness, member, source.id, '2026-04-10', 20_000);
      await harness.json('DELETE', `/sets/${set.id}`, { headers: member.headers });

      const merged = await harness.json<ExerciseMergeReport>(
        'POST',
        `/admin/library/exercises/${source.id}/merge`,
        { headers: admin.headers, body: { targetId: target.id } },
      );
      expect(merged.body).toMatchObject({ movedSets: 0, movedDeletedSets: 1 });

      const [row] = await harness.db
        .select()
        .from(workoutSets)
        .where(eq(workoutSets.id, set.id))
        .limit(1);
      expect(row?.exerciseId).toBe(target.id);
    });

    it('odmawia scalenia ćwiczeń o różnych typach logowania', async () => {
      const weights = await createExercise(harness, member, 'Na ciężar');
      const plank = await createExercise(harness, member, 'Na czas', {
        loggingType: 'bodyweight_time',
      });

      const response = await harness.json<{ error: { message: string } }>(
        'POST',
        `/admin/library/exercises/${weights.id}/merge`,
        { headers: admin.headers, body: { targetId: plank.id } },
      );
      expect(response.status).toBe(409);
      expect(response.body.error.message).toContain('log different measurements');
    });

    it('odmawia scalenia ćwiczenia z samym sobą', async () => {
      const response = await harness.json('POST', `/admin/library/exercises/${BENCH}/merge`, {
        headers: admin.headers,
        body: { targetId: BENCH },
      });
      expect(response.status).toBe(409);
    });
  });

  describe('przywracanie', () => {
    it('zdejmuje tombstone ćwiczenia i wraca ono do biblioteki', async () => {
      const exercise = await createExercise(harness, member, 'Do przywrócenia');
      await harness.json('DELETE', `/exercises/${exercise.id}`, { headers: member.headers });

      const hidden = await harness.json<{ exercises: LibraryExercise[] }>(
        'GET',
        '/admin/library/exercises',
        { headers: admin.headers },
      );
      expect(hidden.body.exercises.map((entry) => entry.exercise.id)).not.toContain(exercise.id);

      const visible = await harness.json<{ exercises: LibraryExercise[] }>(
        'GET',
        '/admin/library/exercises?includeDeleted=true',
        { headers: admin.headers },
      );
      expect(visible.body.exercises.map((entry) => entry.exercise.id)).toContain(exercise.id);

      const restored = await harness.json<Exercise>(
        'POST',
        `/admin/library/exercises/${exercise.id}/restore`,
        { headers: admin.headers },
      );
      expect(restored.status).toBe(200);
      expect(restored.body.deletedAt).toBeNull();

      const library = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: member.headers,
      });
      expect(library.body.map((entry) => entry.id)).toContain(exercise.id);
    });

    it('odmawia przywrócenia ćwiczenia, którego nazwa zdążyła się zajmować', async () => {
      const exercise = await createExercise(harness, member, 'Nazwa do zajęcia');
      await harness.json('DELETE', `/exercises/${exercise.id}`, { headers: member.headers });
      // Ten sam autor i ta sama nazwa: `POST` trafia w wiersz z tombstonem i go
      // wskrzesza, więc do kolizji potrzebny jest wiersz o innym identyfikatorze
      // — czyli ta sama nazwa w innej siłowni nie wystarczy. Wskrzeszenie samo
      // w sobie jest tu wystarczającym powodem odmowy przywracania.
      const again = await createExercise(harness, member, 'Nazwa do zajęcia');
      expect(again.id).toBe(exercise.id);

      const denied = await harness.json('POST', `/admin/library/exercises/${exercise.id}/restore`, {
        headers: admin.headers,
      });
      expect(denied.status).toBe(409);
    });

    it('przywraca tag', async () => {
      const created = await harness.json<Tag>('POST', '/tags', {
        headers: admin.headers,
        body: { name: 'Do przywrócenia' },
      });
      await harness.json('DELETE', `/tags/${created.body.id}`, { headers: admin.headers });

      const restored = await harness.json<Tag>(
        'POST',
        `/admin/library/tags/${created.body.id}/restore`,
        { headers: admin.headers },
      );
      expect(restored.status).toBe(200);
      expect(restored.body.deletedAt).toBeNull();

      const list = await harness.json<Tag[]>('GET', '/tags', { headers: admin.headers });
      expect(list.body.map((tag) => tag.id)).toContain(created.body.id);
    });
  });

  describe('scalenie tagów', () => {
    it('przepina ćwiczenia i cele, a ćwiczeniu z oboma tagami zostaje jeden', async () => {
      const duplicate = await harness.json<Tag>('POST', '/tags', {
        headers: admin.headers,
        body: { name: 'Klata' },
      });
      const sourceId = duplicate.body.id;

      // Ćwiczenie, dla którego tag pomyłkowy jest **główny**.
      const primary = await createExercise(harness, member, 'Z tagiem głównym do scalenia', {
        primaryTagId: sourceId,
      });
      // Ćwiczenie, które ma pomyłkowy jako dodatkowy — i docelowy już jako główny.
      const both = await createExercise(harness, member, 'Z oboma tagami', {
        primaryTagId: CHEST,
        additionalTagIds: [sourceId],
      });

      const merged = await harness.json<TagMergeReport>(
        'POST',
        `/admin/library/tags/${sourceId}/merge`,
        { headers: admin.headers, body: { targetId: CHEST } },
      );
      expect(merged.status).toBe(200);
      expect(merged.body).toMatchObject({ movedPrimary: 1, mergedAdditional: 1 });

      const library = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: admin.headers,
      });
      const movedPrimary = library.body.find((entry) => entry.id === primary.id);
      expect(movedPrimary?.primaryTagId).toBe(CHEST);

      // Tag główny nie może powtórzyć się wśród dodatkowych — inaczej ćwiczenie
      // liczyłoby się do celu cyklu dwa razy.
      const hadBoth = library.body.find((entry) => entry.id === both.id);
      expect(hadBoth?.additionalTagIds).not.toContain(CHEST);

      const tags = await harness.json<Tag[]>('GET', '/tags', { headers: admin.headers });
      expect(tags.body.map((tag) => tag.id)).not.toContain(sourceId);
    });

    it('zdejmuje dodatkowy tag, który po scaleniu powtórzyłby nowy tag główny', async () => {
      const duplicate = await harness.json<Tag>('POST', '/tags', {
        headers: admin.headers,
        body: { name: 'Klata bis' },
      });
      const sourceId = duplicate.body.id;

      // Tag główny tego ćwiczenia jest tagiem pomyłkowym, a tag docelowy
      // scalenia jest już wśród jego tagów dodatkowych.
      const exercise = await createExercise(harness, member, 'Z tagiem docelowym jako dodatkowy', {
        primaryTagId: sourceId,
        additionalTagIds: [CHEST],
      });

      const merged = await harness.json<TagMergeReport>(
        'POST',
        `/admin/library/tags/${sourceId}/merge`,
        { headers: admin.headers, body: { targetId: CHEST } },
      );
      expect(merged.status).toBe(200);
      expect(merged.body).toMatchObject({ movedPrimary: 1, mergedAdditional: 1 });

      const library = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: admin.headers,
      });
      const row = library.body.find((entry) => entry.id === exercise.id);
      expect(row?.primaryTagId).toBe(CHEST);
      expect(row?.additionalTagIds).not.toContain(CHEST);
    });

    it('odmawia scalenia tagu z samym sobą', async () => {
      const response = await harness.json('POST', `/admin/library/tags/${BICEPS}/merge`, {
        headers: admin.headers,
        body: { targetId: BICEPS },
      });
      expect(response.status).toBe(409);
    });
  });

  describe('podobne ćwiczenia', () => {
    it('znajduje wiersz o zbliżonej nazwie i pomija pytany', async () => {
      await createExercise(harness, member, 'Wyciskanie francuskie');
      const twin = await createExercise(harness, admin, 'Wyciskanie francuskie sztangielką');

      const response = await harness.json<{
        query: string;
        layer: string;
        candidates: { exerciseId: string; name: string }[];
      }>('GET', `/admin/library/exercises/${twin.id}/similar`, { headers: admin.headers });

      expect(response.status).toBe(200);
      expect(response.body.layer).toBe('lexical');
      expect(response.body.candidates.map((candidate) => candidate.exerciseId)).not.toContain(
        twin.id,
      );
      expect(response.body.candidates.map((candidate) => candidate.name)).toContain(
        'Wyciskanie francuskie',
      );
    });
  });

  describe('przeliczenie wektorów', () => {
    it('mówi wprost, że warstwa semantyczna jest wyłączona, zamiast udawać sukces', async () => {
      const response = await harness.json<EmbeddingRefreshReport>(
        'POST',
        '/admin/library/embeddings/refresh',
        { headers: admin.headers },
      );
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ enabled: false, status: 'disabled', queued: 0 });
    });

    /**
     * Odpowiedź jest potwierdzeniem przyjęcia zlecenia, nie wynikiem pracy.
     * Wcześniej handler liczył wektory w środku żądania — do ośmiu sekund na
     * ćwiczenie — i przy większej bibliotece nie mieścił się w limicie czasu
     * warstwy wejściowej, więc panel dostawał błąd bramy, a zadanie leciało
     * dalej. Ponowne kliknięcie startowało wtedy drugi przebieg obok pierwszego.
     */
    it('przyjmuje zlecenie od razu i liczy wektory poza żądaniem', async () => {
      const local = await createHarness({
        duplicates: { embedder: countingEmbedder(), reranker: null },
      });
      const owner = await local.signUp('wektory@example.com');
      await local.promoteToAdmin(owner);

      const response = await local.json<EmbeddingRefreshReport>(
        'POST',
        '/admin/library/embeddings/refresh',
        { headers: owner.headers },
      );

      expect(response.status).toBe(202);
      expect(response.body.enabled).toBe(true);
      expect(response.body.status).toBe('started');
      // Biblioteka wbudowana wchodzi do kolejki w całości.
      expect(response.body.queued).toBeGreaterThan(10);

      // Dopiero teraz wektory są policzone — o to w tej zmianie chodzi.
      await local.drainEmbeddings();
      const rows = await local.db.select().from(exerciseEmbeddings);
      expect(rows.length).toBe(response.body.queued);

      await local.close();
    });
  });
});
