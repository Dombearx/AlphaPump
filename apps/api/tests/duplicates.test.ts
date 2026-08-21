/**
 * Wykrywanie duplikatów — trzy warstwy w całości, na prawdziwym Postgresie.
 *
 * Wymaganie ma dwie połowy i obie są tu sprawdzane:
 *
 * 1. **„martwy ciąg" znajduje „deadlift".** Tego warstwa leksykalna nie potrafi
 *    i nie ma potrafić — te nazwy nie dzielą ani jednego trigramu. Test podstawia
 *    atrapę embeddingów, w której oba wyrażenia leżą blisko siebie, i sprawdza,
 *    że przez wyszukiwanie wektorowe, scalenie RRF i ocenę modelu przechodzą aż
 *    do odpowiedzi.
 * 2. **Wyłączenie warstwy nie psuje tworzenia ćwiczeń.** Bez warstw odpowiedź
 *    wraca na `layer: 'lexical'`, a `POST /exercises` działa bez zmian — bo to
 *    dwie niezależne ścieżki i endpoint tworzenia nigdy nie pyta o duplikaty.
 *
 * Atrapy zamiast OpenRoutera są tu decyzją, nie skrótem: CI nie może zależeć od
 * cudzego serwisu ani od klucza w sekretach, a to, co trzeba sprawdzić, siedzi
 * w naszym kodzie — w zapytaniach, scalaniu i cache'u.
 */

import { EMBEDDING_DIMENSIONS } from '@alphapump/db';
import { slug, type DuplicateCheckResponse, type RerankVerdict } from '@alphapump/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { DuplicateLayers, Embedder, RerankCandidate } from '../src/duplicates/layers.js';
import { duplicateCheckCache, exerciseEmbeddings } from '../src/schema.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

/**
 * Atrapa embeddingów o zadanym słowniku znaczeń.
 *
 * Każde „znaczenie" to jeden wymiar wektora — nazwy przypisane do tego samego
 * znaczenia dostają więc wektory identyczne, a do różnych: ortogonalne. Daje to
 * dokładnie tę własność, której warstwa 2 ma dowieść: bliskość **po znaczeniu**,
 * niezależnie od pisowni. Nazwa nieznana słownikowi dostaje wektor wyliczony
 * z jej sluga, czyli jest daleko od wszystkiego.
 */
function fakeEmbedder(meanings: Record<string, number>, model = 'atrapa-embeddingow'): Embedder {
  return {
    model,
    embed(text) {
      const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0);
      const key = slug(text).split('-')[0] ?? '';
      const meaning = meanings[slug(text)] ?? meanings[key];

      if (meaning === undefined) {
        // Coś stabilnego i różnego od znaczeń ze słownika.
        let hash = 7;
        for (const character of slug(text)) hash = (hash * 31 + character.charCodeAt(0)) % 500;
        vector[100 + (hash % 400)] = 1;
      } else {
        vector[meaning] = 1;
      }

      return Promise.resolve(vector);
    },
  };
}

/** Atrapa re-rankera: uznaje za duplikat pozycje, których nazwa jest na liście. */
function fakeReranker(duplicates: readonly string[], model = 'atrapa-rerankera') {
  const calls: { query: string; candidates: RerankCandidate[] }[] = [];

  return {
    calls,
    reranker: {
      model,
      rank(query: string, candidates: readonly RerankCandidate[]) {
        calls.push({ query, candidates: [...candidates] });
        const verdicts: RerankVerdict[] = candidates.map((candidate, index) => ({
          index,
          duplicate: duplicates.includes(candidate.name),
          reason: duplicates.includes(candidate.name)
            ? `„${candidate.name}" to ten sam ruch`
            : 'Inny ruch',
        }));
        return Promise.resolve(verdicts);
      },
    },
  };
}

interface Fixture {
  harness: Harness;
  user: TestUser;
  tagId: string;
}

async function fixture(layers?: DuplicateLayers): Promise<Fixture> {
  const harness = await createHarness({ duplicates: layers });
  const user = await harness.signUp('kuba@example.com');

  const tag = await harness.json<{ id: string }>('POST', '/tags', {
    body: { name: 'Plecy' },
    headers: user.headers,
  });

  return { harness, user, tagId: tag.body.id };
}

async function addExercise(fixture: Fixture, name: string): Promise<string> {
  const response = await fixture.harness.json<{ id: string }>('POST', '/exercises', {
    body: { name, loggingType: 'weight_reps', primaryTagId: fixture.tagId },
    headers: fixture.user.headers,
  });
  expect(response.status).toBe(201);
  return response.body.id;
}

const similar = (fixture: Fixture, name: string, query = '') =>
  fixture.harness.json<DuplicateCheckResponse>(
    'GET',
    `/exercises/similar?name=${encodeURIComponent(name)}${query}`,
    { headers: fixture.user.headers },
  );

describe('warstwa leksykalna (warstwa wyłączona)', () => {
  let context: Fixture;

  beforeAll(async () => {
    context = await fixture();
    await addExercise(context, 'Wyciskanie sztangi leżąc');
    await addExercise(context, 'Deadlift');
    // Ten sam ruch, inna pisownia — samodzielny fixture zamiast polegania na
    // tym, że akurat tak nazywa się jakieś ćwiczenie wbudowane z seeda.
    await addExercise(context, 'Martwy ciąg');
  });

  afterAll(async () => {
    await context.harness.close();
  });

  it('odpowiedź zostaje na warstwie leksykalnej', async () => {
    const response = await similar(context, 'wyciskanie sztangi');

    expect(response.status).toBe(200);
    expect(response.body.layer).toBe('lexical');
    expect(response.body.candidates[0]).toMatchObject({
      name: 'Wyciskanie sztangi leżąc',
      sources: ['lexical'],
      duplicate: null,
    });
  });

  it('łapie literówkę i odmianę, bo to jest praca trigramów', async () => {
    const response = await similar(context, 'wyciskanei sztangi lezac');
    expect(response.body.candidates.map((candidate) => candidate.name)).toContain(
      'Wyciskanie sztangi leżąc',
    );
  });

  it('nie łączy nazw o wspólnym znaczeniu, ale różnej pisowni', async () => {
    const response = await similar(context, 'Martwy ciąg');
    const names = response.body.candidates.map((candidate) => candidate.name);

    // Ćwiczenie o tej samej pisowni znajduje się bez trudu…
    expect(names).toContain('Martwy ciąg');
    // …a „Deadlift", czyli ten sam ruch pod inną nazwą, nie — te dwa napisy nie
    // dzielą ani jednego trigramu. To jest granica warstwy 1 i dokładnie ta
    // granica, po którą wchodzi warstwa semantyczna.
    expect(names).not.toContain('Deadlift');
  });

  it('rozpoznaje nazwę, która trafi w istniejący wiersz autora', async () => {
    const response = await similar(context, 'DEADLIFT');
    expect(response.body.candidates[0]).toMatchObject({ name: 'Deadlift', identical: true });
  });

  it('tworzenie ćwiczeń działa bez warstwy semantycznej i nie zapisuje wektorów', async () => {
    const id = await addExercise(context, 'Podciąganie nachwytem');

    const embeddings = await context.harness.db
      .select()
      .from(exerciseEmbeddings)
      .where(eq(exerciseEmbeddings.exerciseId, id));
    expect(embeddings).toEqual([]);
  });

  it('pomija ćwiczenie wskazane jako wykluczone', async () => {
    const id = await addExercise(context, 'Wiosłowanie sztangą');
    const response = await similar(context, 'Wiosłowanie sztangą', `&excludeId=${id}`);

    expect(response.body.candidates.map((candidate) => candidate.exerciseId)).not.toContain(id);
  });
});

describe('warstwa hybrydowa i re-ranker', () => {
  let context: Fixture;
  let rerankerCalls: { query: string; candidates: RerankCandidate[] }[];

  beforeAll(async () => {
    // „martwy ciąg" i „deadlift" mają w atrapie to samo znaczenie, „wyciskanie"
    // — inne. Pisownia nie łączy ich w żaden sposób.
    const embedder = fakeEmbedder({ 'martwy-ciag': 3, deadlift: 3, wyciskanie: 9 });
    const fake = fakeReranker(['Deadlift']);
    rerankerCalls = fake.calls;

    context = await fixture({ embedder, reranker: fake.reranker });
    await addExercise(context, 'Deadlift');
    await addExercise(context, 'Wyciskanie sztangi leżąc');
  });

  afterAll(async () => {
    await context.harness.close();
  });

  it('zapis ćwiczenia liczy embedding od razu', async () => {
    const rows = await context.harness.db.select().from(exerciseEmbeddings);

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ model: 'atrapa-embeddingow' });
    // Źródłem wektora jest nazwa **z tagiem głównym** — sama nazwa bywa dwuznaczna.
    expect(rows.map((row) => row.source).sort()).toEqual([
      'Deadlift (Plecy)',
      'Wyciskanie sztangi leżąc (Plecy)',
    ]);
  });

  it('„martwy ciąg" znajduje „deadlift" — sedno warstwy semantycznej', async () => {
    const response = await similar(context, 'Martwy ciąg');

    expect(response.status).toBe(200);
    expect(response.body.layer).toBe('llm');

    // Werdykt modelu wypycha uznane duplikaty na początek listy, więc „Deadlift"
    // stoi przed „Martwym ciągiem", którego model nie ocenił jako duplikatu —
    // mimo że tamten jest bliżej w warstwie leksykalnej.
    expect(response.body.candidates[0]).toMatchObject({
      name: 'Deadlift',
      sources: ['semantic'],
      duplicate: true,
      reason: '„Deadlift" to ten sam ruch',
    });
  });

  it('wpis znaleziony obiema warstwami niesie oba źródła', async () => {
    const response = await similar(context, 'Deadlift powoli');
    const candidate = response.body.candidates.find((entry) => entry.name === 'Deadlift');

    expect(candidate?.sources.sort()).toEqual(['lexical', 'semantic']);
  });

  it('werdykty modelu trafiają do cache’u i drugie pytanie go nie woła', async () => {
    const before = rerankerCalls.length;
    await similar(context, 'Martwy ciąg');
    expect(rerankerCalls.length).toBe(before);

    const cached = await context.harness.db.select().from(duplicateCheckCache);
    expect(cached.length).toBeGreaterThan(0);
    expect(cached[0]).toMatchObject({ model: 'atrapa-rerankera', querySlug: 'martwy-ciag' });
  });

  it('kandydaci jadą do modelu z autorem i partią, bez identyfikatorów', () => {
    const candidates = rerankerCalls.flatMap((call) => call.candidates);
    expect(candidates.length).toBeGreaterThan(0);

    // Model odpowiada werdyktami po indeksach, więc identyfikatorów nie dostaje
    // w ogóle — UUID przepisany z błędem trafiałby w cudzy wiersz.
    for (const candidate of candidates) {
      expect(Object.keys(candidate).sort()).toEqual(['authorNickname', 'name', 'primaryTagName']);
    }

    expect(candidates).toEqual(
      expect.arrayContaining([
        { name: 'Deadlift', authorNickname: 'Testowy', primaryTagName: 'Plecy' },
      ]),
    );
  });

  it('edycja nazwy przelicza wektor, a powtórzony zapis już nie', async () => {
    const id = await addExercise(context, 'Przysiad ze sztangą');
    const [first] = await context.harness.db
      .select()
      .from(exerciseEmbeddings)
      .where(eq(exerciseEmbeddings.exerciseId, id));

    await context.harness.json('PATCH', `/exercises/${id}`, {
      body: { name: 'Przysiad przedni' },
      headers: context.user.headers,
    });

    const [afterRename] = await context.harness.db
      .select()
      .from(exerciseEmbeddings)
      .where(eq(exerciseEmbeddings.exerciseId, id));
    expect(afterRename?.source).toBe('Przysiad przedni (Plecy)');
    expect(afterRename?.computedAt.getTime()).toBeGreaterThanOrEqual(
      first?.computedAt.getTime() ?? 0,
    );

    // Edycja notatki nie rusza tekstu źródłowego, więc nie ma po co pytać modelu.
    await context.harness.json('PATCH', `/exercises/${id}`, {
      body: { note: 'kolano' },
      headers: context.user.headers,
    });
    const [afterNote] = await context.harness.db
      .select()
      .from(exerciseEmbeddings)
      .where(eq(exerciseEmbeddings.exerciseId, id));
    expect(afterNote?.computedAt.getTime()).toBe(afterRename?.computedAt.getTime());
  });
});

describe('odporność warstw', () => {
  it('awaria dostawcy embeddingów cofa odpowiedź na warstwę leksykalną', async () => {
    const failing: Embedder = {
      model: 'atrapa-padnieta',
      embed: () => Promise.reject(new Error('OpenRouter nie odpowiada')),
    };

    const context = await fixture({ embedder: failing, reranker: null });
    // Ćwiczenie powstaje mimo tego, że wektora nie da się policzyć — zapisu nie
    // wolno zablokować.
    await addExercise(context, 'Deadlift');

    const response = await similar(context, 'deadlift');
    expect(response.status).toBe(200);
    expect(response.body.layer).toBe('lexical');
    expect(response.body.candidates[0]?.name).toBe('Deadlift');

    await context.harness.close();
  });

  it('model zwracający wektor o złym wymiarze nie trafia do bazy', async () => {
    const wrongSize: Embedder = {
      model: 'atrapa-zlego-wymiaru',
      embed: () => Promise.resolve([1, 2, 3]),
    };

    const context = await fixture({ embedder: wrongSize, reranker: null });
    const id = await addExercise(context, 'Deadlift');

    const rows = await context.harness.db
      .select()
      .from(exerciseEmbeddings)
      .where(eq(exerciseEmbeddings.exerciseId, id));
    expect(rows).toEqual([]);

    await context.harness.close();
  });

  it('awaria re-rankera zostawia kandydatów bez oceny', async () => {
    const embedder = fakeEmbedder({ 'martwy-ciag': 3, deadlift: 3 });
    const context = await fixture({
      embedder,
      reranker: {
        model: 'atrapa-padnieta',
        rank: () => Promise.reject(new Error('limit czasu')),
      },
    });
    await addExercise(context, 'Deadlift');

    const response = await similar(context, 'Martwy ciąg');
    expect(response.body.layer).toBe('hybrid');

    const candidate = response.body.candidates.find((entry) => entry.name === 'Deadlift');
    expect(candidate).toMatchObject({ duplicate: null, reason: null, sources: ['semantic'] });

    await context.harness.close();
  });

  it('nazwa bez ani jednej litery nie pyta bazy ani modelu', async () => {
    const context = await fixture();
    const response = await similar(context, '???');

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ layer: 'lexical', candidates: [] });

    await context.harness.close();
  });
});

describe('push i porządkowanie', () => {
  it('ćwiczenie przywiezione pushem dostaje wektor na serwerze', async () => {
    const embedder = fakeEmbedder({ deadlift: 3 });
    const context = await fixture({ embedder, reranker: null });

    const now = new Date().toISOString();
    const push = await context.harness.json<{ results: { decision: string }[] }>(
      'POST',
      '/sync/push',
      {
        headers: context.user.headers,
        body: {
          deviceId: '11111111-1111-4111-8111-111111111111',
          tags: [],
          exercises: [
            {
              id: '00000000-0000-4000-8000-000000000000',
              name: 'Deadlift',
              authorId: context.user.id,
              loggingType: 'weight_reps',
              primaryTagId: context.tagId,
              additionalTagIds: [],
              note: null,
              createdAt: now,
              updatedAt: now,
              deletedAt: null,
            },
          ],
          cycles: [],
          sets: [],
        },
      },
    );

    // Identyfikator w paczce nie wynika z pary autor + nazwa, więc push go
    // odrzuci — i tak ma być. Sprawdzamy, że odrzucenie nie zostawia wektora.
    expect(push.body.results[0]?.decision).toBe('rejected');
    expect(await context.harness.db.select().from(exerciseEmbeddings)).toEqual([]);

    await context.harness.close();
  });

  it('administrator porządkuje cache re-rankera', async () => {
    const embedder = fakeEmbedder({ deadlift: 3 });
    const fake = fakeReranker(['Deadlift']);
    const context = await fixture({ embedder, reranker: fake.reranker });
    await addExercise(context, 'Deadlift');
    await similar(context, 'deadlift');

    const forbidden = await context.harness.json('POST', '/admin/duplicate-cache/prune', {
      body: { olderThanDays: 1 },
      headers: context.user.headers,
    });
    expect(forbidden.status).toBe(403);

    await context.harness.promoteToAdmin(context.user);
    const kept = await context.harness.json<{ removed: number }>(
      'POST',
      '/admin/duplicate-cache/prune',
      { body: { olderThanDays: 30 }, headers: context.user.headers },
    );
    expect(kept.body.removed).toBe(0);

    await context.harness.close();
  });
});
