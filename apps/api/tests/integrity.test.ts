/**
 * Konflikty w bazie: przegląd, naprawa i to, co dzieje się z odczytem.
 *
 * Scenariusz przewodni jest ten, przez który ten mechanizm powstał. W bazie leży
 * ćwiczenie, którego tag główny powtarza się wśród tagów dodatkowych — bo tak
 * zostawiła je ścieżka zapisu naprawiona dopiero później albo ręczna zmiana
 * w psql. Taki wiersz nie przechodzi przez `exerciseSchema`, a ćwiczenia są
 * globalne, więc jedzie w **każdej** odpowiedzi: panel przestawał się otwierać
 * („response has an unknown shape"), a telefony stawały na pullu. I zostawało
 * tak, bo jedynym narzędziem do poprawienia tego wiersza był ten sam panel.
 *
 * Testy niżej pilnują obu połówek rozwiązania: odczyt takiego wiersza **działa**
 * (bo serializacja go czyści), a konflikt mimo to jest **widoczny** i da się go
 * rozstrzygnąć — zamiast zostać zamaskowanym do następnej awarii.
 */

import { builtInExerciseId, tagId, type Exercise, type IntegrityReport } from '@alphapump/core';
import type { SyncPullResponse } from '@alphapump/core';
import { eq, and } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { exerciseTags, exercises, tags } from '../src/schema.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BICEPS = tagId('biceps');
const CHEST = tagId('chest');
const BENCH = builtInExerciseId('Flat barbell bench press');

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

/**
 * Wstawia wprost do bazy wiersz powiązania, którego API by nie przyjęło.
 *
 * To nie jest obejście testu — to jest odtworzenie stanu, w którym baza
 * naprawdę bywa. Walidacja stoi przy zapisie, a wiersze bywają starsze niż
 * reguła albo pochodzą spoza aplikacji; gdyby dało się je zrobić przez API,
 * nie byłoby o czym mówić.
 */
async function repeatPrimaryTag(harness: Harness, exerciseId: string, tag: string): Promise<void> {
  await harness.db.insert(exerciseTags).values({ exerciseId, tagId: tag, position: 9 });
}

describe('panel: konflikty w bazie', () => {
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

  it('zastrzega przegląd i naprawę dla administratora', async () => {
    const denied = await harness.json('GET', '/admin/integrity', { headers: member.headers });
    expect(denied.status).toBe(403);

    const deniedRepair = await harness.json('POST', '/admin/integrity/repair', {
      headers: member.headers,
      body: { ids: ['cokolwiek'] },
    });
    expect(deniedRepair.status).toBe(403);
  });

  it('na zdrowej bazie nie znajduje nic', async () => {
    const report = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
      headers: admin.headers,
    });
    expect(report.status).toBe(200);
    expect(report.body.issues).toEqual([]);
  });

  describe('tag główny powtórzony wśród dodatkowych', () => {
    let broken: Exercise;

    beforeAll(async () => {
      broken = await createExercise(harness, member, 'Uginanie z powtórzonym tagiem', {
        additionalTagIds: [CHEST],
      });
      await repeatPrimaryTag(harness, broken.id, BICEPS);
    });

    /**
     * Najważniejszy test w tym pliku. Zanim serializacja zaczęła czyścić zestaw
     * tagów, ta lista wracała z wierszem, którego panel nie umiał wczytać —
     * i przestawał działać cały ekran biblioteki.
     */
    it('nie psuje odczytu: lista biblioteki dalej jest w umówionym kształcie', async () => {
      const response = await harness.json<{ exercises: { exercise: Exercise }[] }>(
        'GET',
        '/admin/library/exercises',
        { headers: admin.headers },
      );
      expect(response.status).toBe(200);

      const row = response.body.exercises.find((entry) => entry.exercise.id === broken.id);
      expect(row?.exercise.primaryTagId).toBe(BICEPS);
      expect(row?.exercise.additionalTagIds).toEqual([CHEST]);
    });

    it('nie psuje pullu, po którym stawała synchronizacja telefonów', async () => {
      const pull = await harness.json<SyncPullResponse>('GET', '/sync/pull?since=0', {
        headers: member.headers,
      });
      expect(pull.status).toBe(200);

      const row = pull.body.changes.exercises.find((entry) => entry.id === broken.id);
      expect(row?.additionalTagIds).toEqual([CHEST]);
    });

    it('zgłasza konflikt razem z tym, co zrobi naprawa', async () => {
      const report = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
        headers: admin.headers,
      });

      const issue = report.body.issues.find(
        (entry) => entry.kind === 'exercise_tag_repeats_primary',
      );
      expect(issue).toBeDefined();
      expect(issue?.entityId).toBe(broken.id);
      expect(issue?.entityName).toBe('Uginanie z powtórzonym tagiem');
      // Odczyt to obchodzi, więc nikt tego nie zobaczy w aplikacji — i właśnie
      // dlatego musi być wypisane tutaj.
      expect(issue?.maskedOnRead).toBe(true);
      expect(issue?.repair).not.toBeNull();
    });

    it('naprawa zdejmuje wpis dodatkowy i podbija wiersz, żeby pojechał na telefony', async () => {
      const before = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
        headers: admin.headers,
      });
      const issue = before.body.issues.find(
        (entry) => entry.kind === 'exercise_tag_repeats_primary',
      );
      const [row] = await harness.db
        .select({ serverSeq: exercises.serverSeq })
        .from(exercises)
        .where(eq(exercises.id, broken.id));

      const repaired = await harness.json<{
        repaired: string[];
        skipped: string[];
        issues: IntegrityReport['issues'];
      }>('POST', '/admin/integrity/repair', {
        headers: admin.headers,
        body: { ids: [issue?.id] },
      });

      expect(repaired.status).toBe(200);
      expect(repaired.body.repaired).toEqual([issue?.id]);
      expect(
        repaired.body.issues.some((entry) => entry.kind === 'exercise_tag_repeats_primary'),
      ).toBe(false);

      // Wpisu nie ma już w bazie, a nie tylko w odpowiedzi.
      const links = await harness.db
        .select()
        .from(exerciseTags)
        .where(and(eq(exerciseTags.exerciseId, broken.id), eq(exerciseTags.tagId, BICEPS)));
      expect(links).toEqual([]);

      // Bez podbicia `server_seq` poprawka zostałaby na serwerze: telefony mają
      // kursor za starą wartością i po prostu by jej nie zobaczyły.
      const [after] = await harness.db
        .select({ serverSeq: exercises.serverSeq })
        .from(exercises)
        .where(eq(exercises.id, broken.id));
      expect(after?.serverSeq).toBeGreaterThan(row?.serverSeq ?? 0);
    });

    it('naprawa zgłoszenia, którego już nie ma, jest pominięciem, a nie błędem', async () => {
      const response = await harness.json<{ repaired: string[]; skipped: string[] }>(
        'POST',
        '/admin/integrity/repair',
        {
          headers: admin.headers,
          body: { ids: [`exercise_tag_repeats_primary:${broken.id}:${BICEPS}`] },
        },
      );

      expect(response.status).toBe(200);
      expect(response.body.repaired).toEqual([]);
      expect(response.body.skipped).toHaveLength(1);
    });
  });

  describe('pozostałe rodzaje konfliktów', () => {
    it('widzi tłumaczenia, których nie przyjmie schemat, i czyści je naprawą', async () => {
      await harness.db
        .update(tags)
        .set({ translations: { pl: '—', en: 'Chest' } })
        .where(eq(tags.id, CHEST));

      const report = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
        headers: admin.headers,
      });
      const issue = report.body.issues.find((entry) => entry.kind === 'tag_translations_invalid');
      expect(issue?.entityId).toBe(CHEST);

      const repaired = await harness.json<{ repaired: string[] }>(
        'POST',
        '/admin/integrity/repair',
        { headers: admin.headers, body: { ids: [issue?.id] } },
      );
      expect(repaired.body.repaired).toEqual([issue?.id]);

      const [row] = await harness.db
        .select({ translations: tags.translations })
        .from(tags)
        .where(eq(tags.id, CHEST));
      expect(row?.translations).toEqual({ en: 'Chest' });
    });

    it('widzi żywe ćwiczenie pod usuniętym tagiem głównym i przywraca ten tag', async () => {
      // Tag zdjęty wprost w bazie: API broni usunięcia tagu, na którym coś wisi,
      // a właśnie ten stan jest tu przedmiotem sprawdzenia.
      await harness.db.update(tags).set({ deletedAt: new Date() }).where(eq(tags.id, BICEPS));

      const report = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
        headers: admin.headers,
      });
      const issue = report.body.issues.find(
        (entry) => entry.kind === 'exercise_primary_tag_deleted',
      );
      expect(issue).toBeDefined();
      // Ten widać w aplikacji: ćwiczenie stoi w bibliotece bez kategorii.
      expect(issue?.maskedOnRead).toBe(false);

      const repaired = await harness.json<{ repaired: string[] }>(
        'POST',
        '/admin/integrity/repair',
        { headers: admin.headers, body: { ids: [issue?.id] } },
      );
      expect(repaired.body.repaired).toEqual([issue?.id]);

      const [row] = await harness.db
        .select({ deletedAt: tags.deletedAt })
        .from(tags)
        .where(eq(tags.id, BICEPS));
      expect(row?.deletedAt).toBeNull();
    });

    it('nazwy poza schematem zgłasza bez naprawy — zgadywać jej nie ma jak', async () => {
      await harness.db.update(exercises).set({ name: '???' }).where(eq(exercises.id, BENCH));

      const report = await harness.json<IntegrityReport>('GET', '/admin/integrity', {
        headers: admin.headers,
      });
      const issue = report.body.issues.find((entry) => entry.kind === 'exercise_name_invalid');
      expect(issue?.entityId).toBe(BENCH);
      expect(issue?.repair).toBeNull();

      // Prośba o naprawę takiego zgłoszenia nie jest błędem, ale i nic nie robi:
      // poprawka nazwy należy do człowieka.
      const attempted = await harness.json<{ repaired: string[]; skipped: string[] }>(
        'POST',
        '/admin/integrity/repair',
        { headers: admin.headers, body: { ids: [issue?.id] } },
      );
      expect(attempted.body.repaired).toEqual([]);
      expect(attempted.body.skipped).toHaveLength(1);

      await harness.db
        .update(exercises)
        .set({ name: 'Flat barbell bench press' })
        .where(eq(exercises.id, BENCH));
    });
  });

  it('odmawia pustej listy zgłoszeń', async () => {
    const response = await harness.json('POST', '/admin/integrity/repair', {
      headers: admin.headers,
      body: { ids: [] },
    });
    expect(response.status).toBe(400);
  });
});
