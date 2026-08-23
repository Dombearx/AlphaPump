/**
 * Tłumaczenie nazw tagów i ćwiczeń — cała droga, na prawdziwym Postgresie.
 *
 * Zgłoszenie ma tu dwie połowy i obie są sprawdzane:
 *
 * 1. **Nazwa podana w jednym języku dostaje resztę z modelu.** Dotyczy to
 *    wszystkich trzech dróg zapisu: REST-a (panel), pushu (telefon, także po
 *    pracy offline) i przebiegu uzupełniającego dla wierszy, które powstały,
 *    zanim tłumaczenie w ogóle istniało.
 * 2. **Błąd modelu nie blokuje zapisu.** Zgłoszenie tego nie ustaliło,
 *    a rozstrzygnięcie jest takie samo jak przy warstwie 3 wykrywania
 *    duplikatów: wiersz zapisuje się bez tłumaczenia i wygląda dokładnie tak,
 *    jak wyglądał przed dodaniem języków. To jest najważniejszy test w tym
 *    pliku — reszta opisuje wygodę, ten opisuje warunek, że aplikacja działa
 *    przy niedostępnym dostawcy modeli.
 *
 * Atrapa zamiast Haiku jest decyzją, nie skrótem: CI nie może zależeć od cudzego
 * serwisu ani od klucza w sekretach, a sprawdzić trzeba nasz kod — kolejność
 * zapisu, domykanie zestawu i to, co się dzieje przy odmowie.
 */

import { exerciseId, type Exercise, type Tag, type Translations } from '@alphapump/core';
import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it } from 'vitest';
import { exercises, tags } from '../src/schema.js';
import { exportArchive, importArchive } from '../src/transfer/index.js';
import type { Translator } from '../src/translation/index.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

/** Atrapa modelu o zadanym słowniku: nazwa kanoniczna → nazwy w innych językach. */
function fakeTranslator(dictionary: Record<string, Translations>) {
  const calls: { name: string; kind: string; missing: string[]; context: string | null }[] = [];

  const translator: Translator = {
    model: 'atrapa-haiku',
    translate(request) {
      calls.push({
        name: request.name,
        kind: request.kind,
        missing: [...request.missing],
        context: request.context ?? null,
      });

      const known = dictionary[request.name] ?? {};
      // Model odpowiada wyłącznie o języki, o które pytano — tak jak prawdziwy,
      // któremu podajemy listę braków.
      return Promise.resolve(
        Object.fromEntries(
          Object.entries(known).filter(([language]) =>
            request.missing.includes(language as 'pl' | 'en'),
          ),
        ),
      );
    },
  };

  return { translator, calls };
}

/** Atrapa, która zawsze odmawia — tak wygląda awaria dostawcy i przekroczony limit czasu. */
const brokenTranslator: Translator = {
  model: 'atrapa-niedostepna',
  translate: () => Promise.reject(new Error('Model nie odpowiedział')),
};

let harness: Harness | null = null;

async function start(translator?: Translator): Promise<Harness> {
  const created = await createHarness(translator === undefined ? {} : { translator });
  harness = created;
  return created;
}

afterEach(async () => {
  await harness?.close();
  harness = null;
});

const signedIn = async (app: Harness): Promise<TestUser> =>
  app.signUp(`ktos-${String(Date.now())}-${String(Math.random()).slice(2)}@example.com`);

describe('tworzenie z tłumaczeniem', () => {
  it('dokłada brakującą nazwę tagu z modelu', async () => {
    const { translator, calls } = fakeTranslator({
      Forearms: { pl: 'Przedramiona', en: 'Forearms' },
    });
    const app = await start(translator);
    const user = await signedIn(app);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });
    expect(created.status).toBe(201);
    // Zapis nie czeka na model — w odpowiedzi tłumaczenia jeszcze nie ma i to
    // jest właściwe zachowanie, a nie brak.
    expect(created.body.translations).toBeNull();

    await app.drainTranslations();

    const [row] = await app.db.select().from(tags).where(eq(tags.id, created.body.id));
    expect(row?.translations).toEqual({ en: 'Forearms', pl: 'Przedramiona' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.missing.sort()).toEqual(['en', 'pl']);
  });

  it('nie rusza nazwy wpisanej ręcznie, dokłada wyłącznie brakującą', async () => {
    const { translator, calls } = fakeTranslator({
      Forearms: { pl: 'Coś zupełnie innego', en: 'Something else' },
    });
    const app = await start(translator);
    const user = await signedIn(app);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms', translations: { pl: 'Przedramiona' } },
      headers: user.headers,
    });
    expect(created.body.translations).toEqual({ pl: 'Przedramiona' });

    await app.drainTranslations();

    const [row] = await app.db.select().from(tags).where(eq(tags.id, created.body.id));
    // Nazwa wpisana ręcznie zostaje, a model dołożył wyłącznie tę, której nie było.
    expect(row?.translations).toEqual({ pl: 'Przedramiona', en: 'Something else' });
    expect(calls[0]?.missing).toEqual(['en']);
  });

  it('tłumaczy ćwiczenie razem z jego partią jako kontekstem', async () => {
    const { translator, calls } = fakeTranslator({
      'Skull crushers': { pl: 'Wyciskanie francuskie', en: 'Skull crushers' },
    });
    const app = await start(translator);
    const user = await signedIn(app);

    const tag = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Triceps' },
      headers: user.headers,
    });
    const exercise = await app.json<Exercise>('POST', '/exercises', {
      body: {
        name: 'Skull crushers',
        loggingType: 'weight_reps',
        primaryTagId: tag.body.id,
      },
      headers: user.headers,
    });
    expect(exercise.status).toBe(201);

    await app.drainTranslations();

    const [row] = await app.db.select().from(exercises).where(eq(exercises.id, exercise.body.id));
    expect(row?.translations).toEqual({ en: 'Skull crushers', pl: 'Wyciskanie francuskie' });

    const call = calls.find((entry) => entry.name === 'Skull crushers');
    expect(call?.kind).toBe('exercise');
    expect(call?.context).toBe(tag.body.name);
  });

  it('powtórzony formularz dokłada nazwę do tagu, który już istnieje', async () => {
    const app = await start();
    const user = await signedIn(app);

    const first = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });
    const second = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms', translations: { pl: 'Przedramiona' } },
      headers: user.headers,
    });

    expect(second.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(second.body.translations).toEqual({ pl: 'Przedramiona' });
  });
});

describe('błąd modelu', () => {
  it('nie blokuje zapisu tagu — zostaje nazwa kanoniczna', async () => {
    const app = await start(brokenTranslator);
    const user = await signedIn(app);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });

    expect(created.status).toBe(201);
    await app.drainTranslations();

    const [row] = await app.db.select().from(tags).where(eq(tags.id, created.body.id));
    expect(row?.name).toBe('Forearms');
    expect(row?.translations).toBeNull();
  });

  it('nie blokuje zapisu ćwiczenia — zostaje nazwa kanoniczna', async () => {
    const app = await start(brokenTranslator);
    const user = await signedIn(app);

    const tag = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Triceps' },
      headers: user.headers,
    });
    const created = await app.json<Exercise>('POST', '/exercises', {
      body: { name: 'Skull crushers', loggingType: 'weight_reps', primaryTagId: tag.body.id },
      headers: user.headers,
    });

    expect(created.status).toBe(201);
    await app.drainTranslations();

    const [row] = await app.db.select().from(exercises).where(eq(exercises.id, created.body.id));
    expect(row?.name).toBe('Skull crushers');
    expect(row?.translations).toBeNull();

    // I — co ważniejsze — ćwiczenie jest w bibliotece jak każde inne.
    const listed = await app.json<Exercise[]>('GET', '/exercises', { headers: user.headers });
    expect(listed.body.some((entry) => entry.id === created.body.id)).toBe(true);
  });

  it('wyłączone tłumaczenie zostawia zapis nietknięty', async () => {
    const app = await start();
    const user = await signedIn(app);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });

    expect(created.status).toBe(201);
    await app.drainTranslations();

    const [row] = await app.db.select().from(tags).where(eq(tags.id, created.body.id));
    expect(row?.translations).toBeNull();
  });
});

describe('zmiana nazwy', () => {
  it('tłumaczy od nowa po zmianie nazwy tagu', async () => {
    const { translator } = fakeTranslator({
      Forearms: { pl: 'Przedramiona', en: 'Forearms' },
      Grip: { pl: 'Chwyt', en: 'Grip' },
    });
    const app = await start(translator);
    const user = await signedIn(app);
    await app.promoteToAdmin(user);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });
    await app.drainTranslations();

    // Zmiana nazwy z pustym kompletem tłumaczeń: administrator kasuje te, które
    // przestały pasować, a model dokłada nowe.
    const renamed = await app.json<Tag>('PATCH', `/tags/${created.body.id}`, {
      body: { name: 'Grip', translations: null },
      headers: user.headers,
    });
    expect(renamed.status).toBe(200);
    expect(renamed.body.translations).toBeNull();

    await app.drainTranslations();
    const [row] = await app.db.select().from(tags).where(eq(tags.id, created.body.id));
    expect(row?.translations).toEqual({ en: 'Grip', pl: 'Chwyt' });
  });

  it('pominięte tłumaczenia zostają nietknięte przy zmianie samej pisowni', async () => {
    const app = await start();
    const user = await signedIn(app);
    await app.promoteToAdmin(user);

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms', translations: { pl: 'Przedramiona' } },
      headers: user.headers,
    });

    const renamed = await app.json<Tag>('PATCH', `/tags/${created.body.id}`, {
      body: { name: 'Fore arms' },
      headers: user.headers,
    });

    expect(renamed.body.translations).toEqual({ pl: 'Przedramiona' });
  });
});

describe('push z telefonu', () => {
  it('tłumaczy tag i ćwiczenie utworzone offline', async () => {
    const { translator } = fakeTranslator({
      Forearms: { pl: 'Przedramiona', en: 'Forearms' },
      'Wrist curl': { pl: 'Zginanie nadgarstków', en: 'Wrist curl' },
    });
    const app = await start(translator);
    const user = await signedIn(app);

    const now = new Date().toISOString();

    const created = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });
    await app.drainTranslations();

    // Identyfikator liczy telefon, z pary autor + nazwa — inaczej push odrzuci
    // wiersz jako zbudowany nie z nazwy.
    const pushedId = exerciseId(user.id, 'Wrist curl', null);

    const push = await app.json<{ results: { decision: string }[] }>('POST', '/sync/push', {
      body: {
        deviceId: '0f3f9b1c-4f2a-4f0b-9a4e-2d6c5b1a7e01',
        tags: [],
        exercises: [
          {
            id: pushedId,
            name: 'Wrist curl',
            authorId: user.id,
            loggingType: 'weight_reps',
            primaryTagId: created.body.id,
            additionalTagIds: [],
            note: null,
            gym: null,
            createdAt: now,
            updatedAt: now,
            deletedAt: null,
          },
        ],
        cycles: [],
        sets: [],
      },
      headers: user.headers,
    });
    expect(push.status).toBe(200);

    await app.drainTranslations();

    const [row] = await app.db.select().from(exercises).where(eq(exercises.id, pushedId));
    expect(row?.translations).toEqual({ en: 'Wrist curl', pl: 'Zginanie nadgarstków' });
  });
});

describe('uzupełnienie wierszy, które już były w bazie', () => {
  it('przebiegiem z panelu, bez ruszania nazw wpisanych ręcznie', async () => {
    const { translator } = fakeTranslator({
      Forearms: { pl: 'Przedramiona', en: 'Forearms' },
      Grip: { pl: 'Chwyt', en: 'Grip' },
    });
    const app = await start(translator);
    const user = await signedIn(app);
    await app.promoteToAdmin(user);

    // Dwa tagi w stanie sprzed tłumaczenia: jeden bez niczego, drugi z nazwą
    // wpisaną ręcznie, której przebieg nie ma prawa podmienić.
    const first = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms' },
      headers: user.headers,
    });
    const second = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Grip', translations: { pl: 'Chwyt ręczny' } },
      headers: user.headers,
    });
    await app.drainTranslations();

    await app.db.update(tags).set({ translations: null }).where(eq(tags.id, first.body.id));
    await app.db
      .update(tags)
      .set({ translations: { pl: 'Chwyt ręczny' } })
      .where(eq(tags.id, second.body.id));

    const report = await app.json<{ enabled: boolean; queued: number }>(
      'POST',
      '/admin/library/translations/refresh',
      { headers: user.headers },
    );
    expect(report.status).toBe(202);
    expect(report.body.enabled).toBe(true);
    expect(report.body.queued).toBeGreaterThanOrEqual(2);

    await app.drainTranslations();

    const [filled] = await app.db.select().from(tags).where(eq(tags.id, first.body.id));
    expect(filled?.translations).toEqual({ en: 'Forearms', pl: 'Przedramiona' });

    const [kept] = await app.db.select().from(tags).where(eq(tags.id, second.body.id));
    expect(kept?.translations).toEqual({ pl: 'Chwyt ręczny', en: 'Grip' });
  });

  it('bez tłumacza mówi wprost, że nie ma czym — zamiast udawać przebieg', async () => {
    const app = await start();
    const user = await signedIn(app);
    await app.promoteToAdmin(user);

    const report = await app.json<{ enabled: boolean; status: string }>(
      'POST',
      '/admin/library/translations/refresh',
      { headers: user.headers },
    );

    expect(report.status).toBe(200);
    expect(report.body).toMatchObject({ enabled: false, status: 'disabled', queued: 0 });
  });
});

describe('kopia zapasowa', () => {
  it('odtworzenie z archiwum zachowuje nazwy w pozostałych językach', async () => {
    // Archiwum niosło tłumaczenia od początku (jadą przez ten sam schemat, co
    // odpowiedzi API), ale import ich nie zapisywał — więc odtworzenie z kopii
    // po cichu kasowało nazwy, których nikt już potem nie odtworzy.
    const app = await start();
    const user = await signedIn(app);
    await app.promoteToAdmin(user);

    const tag = await app.json<Tag>('POST', '/tags', {
      body: { name: 'Forearms', translations: { pl: 'Przedramiona' } },
      headers: user.headers,
    });
    await app.json<Exercise>('POST', '/exercises', {
      body: {
        name: 'Wrist curl',
        loggingType: 'weight_reps',
        primaryTagId: tag.body.id,
        translations: { pl: 'Zginanie nadgarstków' },
      },
      headers: user.headers,
    });

    // Archiwum konta, a nie systemowe: tłumaczenia jadą w obu tak samo, a to
    // pierwsze nie niesie poświadczeń, więc test nie zależy od kolejności
    // wstawiania kont i haseł.
    const archive = await exportArchive(app.db, { kind: 'user', userId: user.id });

    const target = await createHarness();
    try {
      // Docelowa baza zna tego samego człowieka — tak jak przy odtworzeniu po
      // ponownym założeniu konta. Bez tego import nie ma na kogo przepisać
      // ćwiczeń i wywraca się na kluczu obcym.
      const reborn = await target.signUp(user.email);
      await importArchive(target.db, archive, {
        actor: { id: reborn.id, email: reborn.email, role: 'user' },
      });

      const [restoredTag] = await target.db.select().from(tags).where(eq(tags.id, tag.body.id));
      expect(restoredTag?.translations).toEqual({ pl: 'Przedramiona' });

      const [restoredExercise] = await target.db
        .select()
        .from(exercises)
        .where(eq(exercises.name, 'Wrist curl'));
      expect(restoredExercise?.translations).toEqual({ pl: 'Zginanie nadgarstków' });
    } finally {
      await target.close();
    }
  });
});
