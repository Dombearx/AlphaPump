/**
 * Kolory tagów.
 *
 * Reguła ze specyfikacji: dopóki tagów jest najwyżej dwadzieścia, żaden kolor
 * nie powtarza się między nimi. Nie da się jej spełnić kolorem policzonym
 * wyłącznie z nazwy — unikalność jest własnością zbioru, więc pilnuje jej ten,
 * kto zna resztę tagów, czyli serwer.
 */

import { TAG_PALETTE, tagId } from '@alphapump/core';
import type { Tag } from '@alphapump/core';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { normalizeTagColors } from '../src/domain/tags.js';
import { tags } from '../src/schema.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

describe('kolory tagów', () => {
  let harness: Harness;
  let author: TestUser;
  let administrator: TestUser;

  beforeAll(async () => {
    harness = await createHarness();
    author = await harness.signUp('autor@example.com');
    administrator = await harness.signUp('admin@example.com');
    await harness.promoteToAdmin(administrator);
  });

  afterAll(async () => {
    await harness.close();
  });

  const createTag = async (name: string): Promise<Tag> => {
    const response = await harness.json<Tag>('POST', '/tags', {
      headers: author.headers,
      body: { name },
    });
    expect(response.status, name).toBe(201);
    return response.body;
  };

  const liveColors = async (): Promise<string[]> => {
    const response = await harness.json<Tag[]>('GET', '/tags', { headers: author.headers });
    return response.body.map((tag) => tag.color);
  };

  it('tagi startowe mają dwadzieścia różnych kolorów z palety', async () => {
    const colors = await liveColors();

    expect(colors.length).toBeGreaterThan(0);
    expect(new Set(colors).size).toBe(colors.length);
    for (const color of colors) expect(TAG_PALETTE).toContain(color);
  });

  it('zmiana nazwy nie rusza koloru — inaczej tag wpadłby na kolor sąsiada', async () => {
    const created = await createTag('Nazwa do poprawienia');

    const renamed = await harness.json<Tag>('PATCH', `/tags/${created.id}`, {
      headers: administrator.headers,
      body: { name: 'Nazwa poprawiona' },
    });

    expect(renamed.status).toBe(200);
    expect(renamed.body.color).toBe(created.color);
  });

  it('wskrzeszony tag dostaje kolor wolny teraz, a nie ten sprzed skasowania', async () => {
    const created = await createTag('Tag na chwilę');
    const removed = await harness.json('DELETE', `/tags/${created.id}`, {
      headers: administrator.headers,
    });
    expect(removed.status).toBe(204);

    // Kolor po skasowanym tagu wrócił do puli i zdążył go przejąć ktoś inny —
    // wskrzeszenie nie może go odzyskać przemocą, bo powstałaby para bliźniaków.
    const [innego] = await harness.db
      .select()
      .from(tags)
      .where(eq(tags.id, tagId('Biceps')));
    await harness.db.update(tags).set({ color: created.color }).where(eq(tags.id, innego!.id));

    const revived = await createTag('Tag na chwilę');
    expect(revived.color).not.toBe(created.color);
    expect(TAG_PALETTE).toContain(revived.color);

    await harness.db.update(tags).set({ color: innego!.color }).where(eq(tags.id, innego!.id));
  });

  it('dopóki tagów jest najwyżej dwadzieścia, kolory się nie powtarzają', async () => {
    // Seed daje dziesięć tagów; dokładamy tyle, żeby wyczerpać paletę co do
    // slotu — to jest granica, o której mówi zgłoszenie.
    const seeded = (await liveColors()).length;
    for (let index = seeded; index < TAG_PALETTE.length; index += 1) {
      await createTag(`Kolorowy ${String(index)}`);
    }

    const colors = await liveColors();
    expect(colors).toHaveLength(TAG_PALETTE.length);
    expect(new Set(colors).size).toBe(TAG_PALETTE.length);
  });

  it('powyżej dwudziestu tagów kolor się powtarza, ale dalej jest z palety', async () => {
    const nadmiarowy = await createTag('Dwudziesty pierwszy');

    expect(TAG_PALETTE).toContain(nadmiarowy.color);
    const colors = await liveColors();
    expect(new Set(colors).size).toBe(TAG_PALETTE.length);
  });

  describe('normalizacja przy starcie serwera', () => {
    it('sprowadza do palety kolory sprzed niej i rozdziela duplikaty', async () => {
      const first = await createTag('Sprzed palety');
      const second = await createTag('Duplikat koloru');

      // Stan, jaki zostawiła stara formuła: kolor spoza palety u jednego tagu
      // i dwa tagi w dokładnie tym samym kolorze u drugiego.
      await harness.db.update(tags).set({ color: '#7b4a12' }).where(eq(tags.id, first.id));
      await harness.db.update(tags).set({ color: TAG_PALETTE[0]! }).where(eq(tags.id, second.id));

      const recolored = await normalizeTagColors(harness.db);
      expect(recolored).toBeGreaterThan(0);

      const colors = await liveColors();
      for (const color of colors) expect(TAG_PALETTE).toContain(color);
      // Tagów jest już ponad dwadzieścia, więc powtórki są dopuszczalne — ale
      // każdy kolor palety ma być wykorzystany, zanim którykolwiek się powtórzy.
      expect(new Set(colors).size).toBe(TAG_PALETTE.length);
    });

    it('drugi przebieg nie ma czego poprawiać', async () => {
      await normalizeTagColors(harness.db);
      expect(await normalizeTagColors(harness.db)).toBe(0);
    });

    it('podbija server_seq, żeby nowy kolor dojechał pullem na telefon', async () => {
      const tag = await createTag('Do przekolorowania');
      const [before] = await harness.db.select().from(tags).where(eq(tags.id, tag.id));

      await harness.db.update(tags).set({ color: '#7b4a12' }).where(eq(tags.id, tag.id));
      expect(await normalizeTagColors(harness.db)).toBe(1);

      const [after] = await harness.db.select().from(tags).where(eq(tags.id, tag.id));
      expect(after!.serverSeq).toBeGreaterThan(before!.serverSeq);
      expect(after!.updatedAt.getTime()).toBeGreaterThanOrEqual(before!.updatedAt.getTime());
    });
  });
});
