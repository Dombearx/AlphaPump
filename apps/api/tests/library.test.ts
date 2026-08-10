/**
 * Biblioteka: tagi i ćwiczenia — z naciskiem na uprawnienia.
 *
 * Reguła ze specyfikacji, której pilnuje ten plik: **ćwiczenie może zmieniać
 * i usuwać wyłącznie jego autor albo administrator**. Bez niej wspólna
 * biblioteka wchodzi w problemy rodem z wiki, a LWW przestaje wystarczać do
 * rozstrzygania konfliktów synchronizacji.
 */

import { builtInExerciseId, exerciseId, tagId } from '@alphapump/core';
import type { Exercise, Tag } from '@alphapump/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BICEPS = tagId('Biceps');
const PLECY = tagId('Plecy');

describe('biblioteka', () => {
  let harness: Harness;
  let author: TestUser;
  let outsider: TestUser;
  let administrator: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    author = await harness.signUp('autor@example.com');
    outsider = await harness.signUp('obcy@example.com');
    administrator = await harness.signUp('admin@example.com');
    await harness.promoteToAdmin(administrator);
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('tagi', () => {
    it('zwraca tagi startowe z seeda', async () => {
      const response = await harness.json<Tag[]>('GET', '/tags', { headers: author.headers });
      expect(response.status).toBe(200);
      expect(response.body.map((tag) => tag.id)).toContain(BICEPS);
    });

    it('tworzy tag i dedupikuje po slugu niezależnie od wielkości liter', async () => {
      const first = await harness.json<Tag>('POST', '/tags', {
        headers: author.headers,
        body: { name: 'Rotatory' },
      });
      expect(first.status).toBe(201);
      expect(first.body.id).toBe(tagId('Rotatory'));

      // „rotatory", „Rotatory" i „ROTATORY" to jeden tag — id wynika ze sluga.
      const again = await harness.json<Tag>('POST', '/tags', {
        headers: outsider.headers,
        body: { name: 'ROTATORY' },
      });
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
    });

    it('nadaje kolor deterministycznie, bez rundy do serwera', async () => {
      const response = await harness.json<Tag>('POST', '/tags', {
        headers: author.headers,
        body: { name: 'Przywodziciele' },
      });
      // Telefon offline policzy dokładnie ten sam kolor tą samą funkcją.
      expect(response.body.color).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('nie pozwala zwykłemu użytkownikowi zmieniać ani usuwać tagów', async () => {
      const patched = await harness.json<{ error: { code: string } }>('PATCH', `/tags/${BICEPS}`, {
        headers: author.headers,
        body: { name: 'Bicepsy' },
      });
      expect(patched.status).toBe(403);
      expect(patched.body.error.code).toBe('forbidden');

      const removed = await harness.json('DELETE', `/tags/${BICEPS}`, { headers: author.headers });
      expect(removed.status).toBe(403);
    });

    it('pozwala administratorowi zmienić nazwę tagu, zachowując identyfikator', async () => {
      const created = await harness.json<Tag>('POST', '/tags', {
        headers: author.headers,
        body: { name: 'Sotkowe' },
      });

      const renamed = await harness.json<Tag>('PATCH', `/tags/${created.body.id}`, {
        headers: administrator.headers,
        body: { name: 'Skośne' },
      });
      expect(renamed.status).toBe(200);
      // Identyfikator zostaje: gdyby się zmienił, ćwiczenia z tym tagiem
      // wskazywałyby w próżnię po poprawieniu literówki.
      expect(renamed.body.id).toBe(created.body.id);
      expect(renamed.body.slug).toBe('skosne');
    });

    it('odmawia usunięcia tagu używanego przez ćwiczenie', async () => {
      const response = await harness.json<{ error: { code: string } }>(
        'DELETE',
        `/tags/${BICEPS}`,
        { headers: administrator.headers },
      );
      expect(response.status).toBe(409);
      expect(response.body.error.code).toBe('conflict');
    });

    it('pozwala administratorowi usunąć tag nieużywany', async () => {
      const created = await harness.json<Tag>('POST', '/tags', {
        headers: author.headers,
        body: { name: 'Tag do skasowania' },
      });
      const response = await harness.json('DELETE', `/tags/${created.body.id}`, {
        headers: administrator.headers,
      });
      expect(response.status).toBe(204);
    });
  });

  describe('ćwiczenia', () => {
    it('zwraca ćwiczenia wbudowane z seeda', async () => {
      const response = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: author.headers,
      });
      expect(response.status).toBe(200);
      expect(response.body.map((exercise) => exercise.id)).toContain(
        builtInExerciseId('Martwy ciąg'),
      );
    });

    it('filtruje po tagu, uwzględniając tagi dodatkowe', async () => {
      const response = await harness.json<Exercise[]>(`GET`, `/exercises?tagId=${PLECY}`, {
        headers: author.headers,
      });
      const names = response.body.map((exercise) => exercise.name);
      expect(names).toContain('Wiosłowanie sztangą');
      expect(names).not.toContain('Bieg');
    });

    it('odróżnia ćwiczenia wbudowane od dodanych przez użytkowników', async () => {
      await harness.json('POST', '/exercises', {
        headers: author.headers,
        body: {
          name: 'Uginanie na modlitewniku',
          loggingType: 'weight_reps',
          primaryTagId: BICEPS,
        },
      });

      const builtIn = await harness.json<Exercise[]>('GET', '/exercises?builtIn=true', {
        headers: author.headers,
      });
      const authored = await harness.json<Exercise[]>('GET', '/exercises?builtIn=false', {
        headers: author.headers,
      });

      expect(builtIn.body.map((exercise) => exercise.name)).toContain('Martwy ciąg');
      expect(authored.body.map((exercise) => exercise.name)).toEqual(['Uginanie na modlitewniku']);
    });

    it('wylicza identyfikator z pary autor + nazwa', async () => {
      const response = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body: {
          name: 'Wyciskanie hantli stojąc',
          loggingType: 'weight_reps',
          primaryTagId: BICEPS,
          additionalTagIds: [PLECY],
        },
      });
      expect(response.status).toBe(201);
      expect(response.body.id).toBe(exerciseId(author.id, 'Wyciskanie hantli stojąc'));
      expect(response.body.additionalTagIds).toEqual([PLECY]);
    });

    it('powtórzone utworzenie zwraca istniejące ćwiczenie zamiast duplikatu', async () => {
      const body = {
        name: 'Scyzoryki',
        loggingType: 'bodyweight_reps' as const,
        primaryTagId: BICEPS,
      };
      const first = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body,
      });
      const again = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body,
      });

      expect(first.status).toBe(201);
      expect(again.status).toBe(200);
      expect(again.body.id).toBe(first.body.id);
    });

    it('dwie osoby mogą mieć ćwiczenie o tej samej nazwie', async () => {
      const body = {
        name: 'Autorski wynalazek',
        loggingType: 'weight_reps' as const,
        primaryTagId: BICEPS,
      };
      const mine = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body,
      });
      const theirs = await harness.json<Exercise>('POST', '/exercises', {
        headers: outsider.headers,
        body,
      });

      expect(mine.body.id).not.toBe(theirs.body.id);
      expect(theirs.status).toBe(201);
    });

    it('odmawia edycji komuś, kto nie jest autorem', async () => {
      const created = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body: { name: 'Cudze ćwiczenie', loggingType: 'weight_reps', primaryTagId: BICEPS },
      });

      const response = await harness.json<{ error: { code: string } }>(
        'PATCH',
        `/exercises/${created.body.id}`,
        { headers: outsider.headers, body: { name: 'Przejęte' } },
      );
      expect(response.status).toBe(403);
      expect(response.body.error.code).toBe('forbidden');
    });

    it('pozwala edytować autorowi i administratorowi', async () => {
      const created = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body: { name: 'Ćwiczenie z literównką', loggingType: 'weight_reps', primaryTagId: BICEPS },
      });

      const byAuthor = await harness.json<Exercise>('PATCH', `/exercises/${created.body.id}`, {
        headers: author.headers,
        body: { name: 'Ćwiczenie z literówką' },
      });
      expect(byAuthor.status).toBe(200);
      // Poprawienie literówki nie może przenieść ćwiczenia pod nowy identyfikator,
      // bo serie wskazujące na stary zostałyby osierocone.
      expect(byAuthor.body.id).toBe(created.body.id);

      const byAdmin = await harness.json<Exercise>('PATCH', `/exercises/${created.body.id}`, {
        headers: administrator.headers,
        body: { note: 'poprawione przez administratora' },
      });
      expect(byAdmin.status).toBe(200);
      expect(byAdmin.body.note).toBe('poprawione przez administratora');
    });

    it('nie pozwala zmienić typu logowania', async () => {
      const created = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body: { name: 'Typ na zawsze', loggingType: 'weight_reps', primaryTagId: BICEPS },
      });

      const response = await harness.json<Exercise>('PATCH', `/exercises/${created.body.id}`, {
        headers: author.headers,
        body: { loggingType: 'distance_time' },
      });
      // Pole spoza schematu edycji jest po prostu ignorowane — typ zostaje.
      expect(response.body.loggingType).toBe('weight_reps');
    });

    it('odmawia usunięcia komuś, kto nie jest autorem, i pozwala autorowi', async () => {
      const created = await harness.json<Exercise>('POST', '/exercises', {
        headers: author.headers,
        body: { name: 'Do skasowania', loggingType: 'weight_reps', primaryTagId: BICEPS },
      });

      const byOutsider = await harness.json('DELETE', `/exercises/${created.body.id}`, {
        headers: outsider.headers,
      });
      expect(byOutsider.status).toBe(403);

      const byAuthor = await harness.json('DELETE', `/exercises/${created.body.id}`, {
        headers: author.headers,
      });
      expect(byAuthor.status).toBe(204);

      const list = await harness.json<Exercise[]>('GET', '/exercises', {
        headers: author.headers,
      });
      expect(list.body.map((exercise) => exercise.id)).not.toContain(created.body.id);
    });

    it('odrzuca ćwiczenie ze wskazaniem na nieistniejący tag', async () => {
      const response = await harness.json<{ error: { code: string } }>('POST', '/exercises', {
        headers: author.headers,
        body: {
          name: 'Ćwiczenie bez tagu',
          loggingType: 'weight_reps',
          primaryTagId: '0198f0a0-1c2d-7e3f-8a9b-000000000000',
        },
      });
      expect(response.status).toBe(404);
    });

    it('odrzuca powtórzenie tagu głównego wśród dodatkowych', async () => {
      const response = await harness.json<{ error: { code: string } }>('POST', '/exercises', {
        headers: author.headers,
        body: {
          name: 'Podwójny tag',
          loggingType: 'weight_reps',
          primaryTagId: BICEPS,
          additionalTagIds: [BICEPS],
        },
      });
      expect(response.status).toBe(409);
    });
  });
});
