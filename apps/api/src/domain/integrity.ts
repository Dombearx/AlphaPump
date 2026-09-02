/**
 * Przegląd bazy pod kątem konfliktów, których nie da się naprawić zapisem
 * z aplikacji.
 *
 * ## Skąd się biorą wiersze, których nie przyjmuje własny schemat
 *
 * Schematy z `@alphapump/core` opisują wiersz **poprawny**, a walidacja stoi
 * przy zapisie. To wystarcza dla danych, które przez ten zapis przeszły — ale
 * baza pamięta więcej: wiersze sprzed reguły, wiersze zmienione ręcznie w psql
 * przy okazji ratowania czegoś innego, wiersze zostawione przez ścieżkę zapisu,
 * której błąd zobaczyliśmy dopiero z produkcji. Historia tego repozytorium ma
 * takich napraw kilka — za każdym razem naprawiona była **przyczyna**, a wiersze,
 * które zdążyła zepsuć, zostawały w bazie.
 *
 * Skutek jest nieproporcjonalny do przyczyny, bo ćwiczenia i tagi są globalne:
 * jeden krzywy wiersz jedzie w każdej odpowiedzi i wywala parsowanie całej
 * listy. Panel przestaje się otwierać, telefon staje na „Pull response has an
 * unknown shape" — obu naraz i do skutku.
 *
 * ## Podział pracy: serializacja masking, ten plik naprawia
 *
 * `dto.ts` czyści to, co da się wystawić w kształcie poprawnym mimo krzywego
 * wiersza (powtórzony tag, tłumaczenie bez litery). Dzięki temu nic nie stoi.
 * Ale wyczyszczony odczyt zostawia bazę taką, jaka była — konflikt wraca przy
 * najbliższym zapisie tego wiersza i nikt o nim nie wie.
 *
 * Ten plik jest drugą połową: wypisuje **to samo** wprost, razem z nazwami
 * i z tym, co zrobi naprawa. Naprawa nie jest automatyczna z rozmysłem —
 * część konfliktów rozstrzyga się wiedząc, co ten wiersz miał znaczyć,
 * a „system po cichu zdjął komuś tag" jest gorsze niż „system pokazał, że
 * tag jest zdublowany".
 *
 * ## Dlaczego naprawa jest po `id` zgłoszenia, a nie po dowolnym poleceniu
 *
 * Zestaw napraw jest zamknięty: `repairIssues` potrafi wyłącznie to, co
 * `scanIntegrity` znalazło i opisało. Panel nie dostaje więc wejścia do bazy,
 * tylko listę rozstrzygnięć do zatwierdzenia. Identyfikator zgłoszenia wynika
 * z treści konfliktu, więc naprawa robi przegląd jeszcze raz i działa na stanie
 * z tej chwili — a nie na tym, co panel widział pięć minut temu.
 */

import {
  INTEGRITY_ISSUE_KINDS,
  displayNameSchema,
  hexColorSchema,
  sanitizeTranslations,
  tagColorForSlug,
  type IntegrityIssue,
  type IntegrityIssueKind,
  type Translations,
} from '@alphapump/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exerciseTags, exercises, tags } from '../schema.js';
import { stampWrite } from '../sync-columns.js';

/** `kind:encja[:tag]` — patrz `integrityIssueSchema` w rdzeniu. */
function issueId(kind: IntegrityIssueKind, entityId: string, tagId?: string): string {
  return tagId === undefined ? `${kind}:${entityId}` : `${kind}:${entityId}:${tagId}`;
}

/** Nazwa tagu do komunikatu; sam identyfikator, gdy tagu nie ma w mapie. */
const nameOf = (names: Map<string, string>, id: string): string => names.get(id) ?? id;

const sameTranslations = (left: Translations | null, right: Translations | null): boolean =>
  JSON.stringify(left ?? null) === JSON.stringify(right ?? null);

const nameValid = (value: string): boolean => displayNameSchema.safeParse(value).success;

/**
 * Pełny przegląd biblioteki.
 *
 * Trzy zapytania na całe tabele, bez `N + 1` i bez filtrów: przegląd z definicji
 * ma zobaczyć wszystko, łącznie z wierszami z tombstonem — usunięte ćwiczenie
 * wraca przy przywróceniu razem ze swoim konfliktem, a usunięty tag dalej jest
 * tagiem głównym czyjegoś ćwiczenia.
 */
export async function scanIntegrity(db: Database): Promise<IntegrityIssue[]> {
  const [exerciseRows, tagRows, linkRows] = await Promise.all([
    db.select().from(exercises),
    db.select().from(tags),
    db.select().from(exerciseTags),
  ]);

  const tagNames = new Map(tagRows.map((row) => [row.id, row.name]));
  const deletedTags = new Set(tagRows.filter((row) => row.deletedAt !== null).map((row) => row.id));
  const exerciseById = new Map(exerciseRows.map((row) => [row.id, row]));

  const issues: IntegrityIssue[] = [];

  /* ------------------------------------------------------------ ćwiczenia */

  for (const row of exerciseRows) {
    const base = {
      entity: 'exercise' as const,
      entityId: row.id,
      entityName: row.name,
      entityDeleted: row.deletedAt !== null,
    };

    // Tag główny z tombstonem. Wiersz **przechodzi** przez schemat — tag jest
    // prawdziwy — ale ćwiczenie odwołuje się do czegoś, czego aplikacja już nie
    // pokazuje, więc w bibliotece stoi bez widocznej kategorii.
    if (deletedTags.has(row.primaryTagId) && row.deletedAt === null) {
      issues.push({
        ...base,
        id: issueId('exercise_primary_tag_deleted', row.id),
        kind: 'exercise_primary_tag_deleted',
        detail:
          `Tag główny „${nameOf(tagNames, row.primaryTagId)}" jest usunięty, ` +
          'więc to ćwiczenie stoi w bibliotece bez widocznej kategorii.',
        repair: 'Przywraca ten tag (zdejmuje tombstone).',
        maskedOnRead: false,
      });
    }

    if (!nameValid(row.name)) {
      issues.push({
        ...base,
        id: issueId('exercise_name_invalid', row.id),
        kind: 'exercise_name_invalid',
        detail:
          `Nazwa „${row.name}" nie przechodzi przez schemat — musi mieć od 1 do 80 znaków ` +
          'i przynajmniej jedną literę lub cyfrę.',
        // Nazwy nie da się zgadnąć: to jedyna treść tego wiersza, którą wpisał
        // człowiek, i to on musi powiedzieć, co miało tam być.
        repair: null,
        maskedOnRead: false,
      });
    }

    const cleanTranslations = sanitizeTranslations(row.translations);
    if (!sameTranslations(row.translations, cleanTranslations)) {
      issues.push({
        ...base,
        id: issueId('exercise_translations_invalid', row.id),
        kind: 'exercise_translations_invalid',
        detail:
          'Wśród tłumaczeń nazwy są wpisy, których nie przyjmuje schemat — ' +
          'odczyt cofa je do nazwy kanonicznej, ale w bazie dalej leżą.',
        repair: 'Zapisuje tłumaczenia bez tych wpisów.',
        maskedOnRead: true,
      });
    }
  }

  /* --------------------------------------------------- powiązania z tagami */

  for (const link of linkRows) {
    const exercise = exerciseById.get(link.exerciseId);
    if (exercise === undefined) continue;

    const base = {
      entity: 'exercise' as const,
      entityId: exercise.id,
      entityName: exercise.name,
      entityDeleted: exercise.deletedAt !== null,
    };

    // Ten jeden konflikt jest powodem, dla którego cały ten plik powstał.
    if (link.tagId === exercise.primaryTagId) {
      issues.push({
        ...base,
        id: issueId('exercise_tag_repeats_primary', exercise.id, link.tagId),
        kind: 'exercise_tag_repeats_primary',
        detail:
          `Tag „${nameOf(tagNames, link.tagId)}" jest jednocześnie główny i dodatkowy. ` +
          'Odczyt zdejmuje ten wpis dodatkowy, ale w bazie zostaje.',
        repair: 'Zdejmuje wpis dodatkowy; tag główny zostaje bez zmian.',
        maskedOnRead: true,
      });
      // Drugie zgłoszenie o tym samym wierszu tabeli nic by nie wniosło:
      // naprawa jest ta sama — zdjęcie tego powiązania.
      continue;
    }

    if (deletedTags.has(link.tagId) && exercise.deletedAt === null) {
      issues.push({
        ...base,
        id: issueId('exercise_additional_tag_deleted', exercise.id, link.tagId),
        kind: 'exercise_additional_tag_deleted',
        detail:
          `Tag dodatkowy „${nameOf(tagNames, link.tagId)}" jest usunięty, ` +
          'więc aplikacja pokazuje przy tym ćwiczeniu tag, którego nie ma na liście tagów.',
        repair: 'Zdejmuje ten tag dodatkowy z ćwiczenia.',
        maskedOnRead: false,
      });
    }
  }

  /* ----------------------------------------------------------------- tagi */

  for (const row of tagRows) {
    const base = {
      entity: 'tag' as const,
      entityId: row.id,
      entityName: row.name,
      entityDeleted: row.deletedAt !== null,
    };

    if (!nameValid(row.name)) {
      issues.push({
        ...base,
        id: issueId('tag_name_invalid', row.id),
        kind: 'tag_name_invalid',
        detail:
          `Nazwa „${row.name}" nie przechodzi przez schemat — musi mieć od 1 do 80 znaków ` +
          'i przynajmniej jedną literę lub cyfrę.',
        repair: null,
        maskedOnRead: false,
      });
    }

    if (!hexColorSchema.safeParse(row.color).success) {
      issues.push({
        ...base,
        id: issueId('tag_color_invalid', row.id),
        kind: 'tag_color_invalid',
        detail: `Kolor „${row.color}" nie jest zapisem w formacie #rrggbb.`,
        repair: 'Wylicza kolor z palety na nowo, omijając kolory zajęte.',
        maskedOnRead: false,
      });
    }

    const cleanTranslations = sanitizeTranslations(row.translations);
    if (!sameTranslations(row.translations, cleanTranslations)) {
      issues.push({
        ...base,
        id: issueId('tag_translations_invalid', row.id),
        kind: 'tag_translations_invalid',
        detail:
          'Wśród tłumaczeń nazwy są wpisy, których nie przyjmuje schemat — ' +
          'odczyt cofa je do nazwy kanonicznej, ale w bazie dalej leżą.',
        repair: 'Zapisuje tłumaczenia bez tych wpisów.',
        maskedOnRead: true,
      });
    }
  }

  // Kolejność stała, żeby lista w panelu nie skakała między odświeżeniami:
  // najpierw to, co widać na ekranie, potem to, co odczyt obchodzi.
  const order = new Map(INTEGRITY_ISSUE_KINDS.map((kind, index) => [kind, index]));
  return issues.sort((left, right) => {
    if (left.maskedOnRead !== right.maskedOnRead) return left.maskedOnRead ? 1 : -1;
    const byKind = (order.get(left.kind) ?? 0) - (order.get(right.kind) ?? 0);
    return byKind !== 0 ? byKind : left.id.localeCompare(right.id);
  });
}

export interface RepairOutcome {
  repaired: string[];
  skipped: string[];
}

/**
 * Naprawa wskazanych zgłoszeń.
 *
 * Przegląd leci **jeszcze raz** wewnątrz transakcji i naprawiane jest wyłącznie
 * to, co dalej jest konfliktem. Zgłoszenie, które w międzyczasie zniknęło — bo
 * ktoś poprawił ten wiersz z panelu albo z telefonu — ląduje w `skipped`, a nie
 * w błędzie: kliknięcie w listę sprzed pięciu minut nie jest pomyłką
 * administratora.
 *
 * Każda naprawa, która rusza ćwiczenie albo tag, podbija `updated_at`
 * i `server_seq` tego wiersza. Bez tego poprawka zostałaby na serwerze:
 * telefony mają kursor za starą wartością i po prostu by jej nie zobaczyły.
 */
export async function repairIssues(db: Database, ids: readonly string[]): Promise<RepairOutcome> {
  const wanted = new Set(ids);

  return db.transaction(async (tx) => {
    const issues = await scanIntegrity(tx as Database);
    const byId = new Map(issues.map((issue) => [issue.id, issue]));

    const repaired: string[] = [];
    const skipped: string[] = [];
    // Ćwiczenia, którym zmienił się zestaw tagów: sam wpis w `exercise_tags`
    // nie ma kolumn synchronizacyjnych, więc bez podbicia wiersza ćwiczenia
    // zmiana nie pojechałaby na telefony.
    const touchedExercises = new Set<string>();

    for (const id of wanted) {
      const issue = byId.get(id);
      if (issue === undefined || issue.repair === null) {
        skipped.push(id);
        continue;
      }

      switch (issue.kind) {
        case 'exercise_tag_repeats_primary':
        case 'exercise_additional_tag_deleted': {
          const tagId = id.slice(id.lastIndexOf(':') + 1);
          await tx
            .delete(exerciseTags)
            .where(and(eq(exerciseTags.exerciseId, issue.entityId), eq(exerciseTags.tagId, tagId)));
          touchedExercises.add(issue.entityId);
          break;
        }

        case 'exercise_primary_tag_deleted': {
          // Naprawą jest przywrócenie tagu, a nie przepięcie ćwiczenia na inny:
          // to ćwiczenie zostało zaszeregowane świadomie, a tag zniknął pod nim
          // później. Zgadywanie zastępczej kategorii byłoby zmianą znaczenia
          // cudzego wiersza.
          const [exercise] = await tx
            .select({ primaryTagId: exercises.primaryTagId })
            .from(exercises)
            .where(eq(exercises.id, issue.entityId))
            .limit(1);
          if (exercise === undefined) {
            skipped.push(id);
            continue;
          }
          await tx
            .update(tags)
            .set({ deletedAt: null, ...stampWrite() })
            .where(eq(tags.id, exercise.primaryTagId));
          break;
        }

        case 'exercise_translations_invalid': {
          const [row] = await tx
            .select({ translations: exercises.translations })
            .from(exercises)
            .where(eq(exercises.id, issue.entityId))
            .limit(1);
          if (row === undefined) {
            skipped.push(id);
            continue;
          }
          await tx
            .update(exercises)
            .set({ translations: sanitizeTranslations(row.translations), ...stampWrite() })
            .where(eq(exercises.id, issue.entityId));
          break;
        }

        case 'tag_translations_invalid': {
          const [row] = await tx
            .select({ translations: tags.translations })
            .from(tags)
            .where(eq(tags.id, issue.entityId))
            .limit(1);
          if (row === undefined) {
            skipped.push(id);
            continue;
          }
          await tx
            .update(tags)
            .set({ translations: sanitizeTranslations(row.translations), ...stampWrite() })
            .where(eq(tags.id, issue.entityId));
          break;
        }

        case 'tag_color_invalid': {
          const [row] = await tx
            .select({ id: tags.id, slug: tags.slug, color: tags.color })
            .from(tags)
            .where(eq(tags.id, issue.entityId))
            .limit(1);
          if (row === undefined) {
            skipped.push(id);
            continue;
          }
          const taken = await tx
            .select({ id: tags.id, color: tags.color })
            .from(tags)
            .where(isNull(tags.deletedAt));
          await tx
            .update(tags)
            .set({
              color: tagColorForSlug(
                row.slug,
                taken.filter((other) => other.id !== row.id).map((other) => other.color),
              ),
              ...stampWrite(),
            })
            .where(eq(tags.id, row.id));
          break;
        }

        // Zgłoszenia bez naprawy odsiewa warunek `issue.repair === null` wyżej;
        // ta gałąź jest tu po to, żeby dołożenie rodzaju bez naprawy nie
        // przeszło niezauważone przez kompilator.
        case 'exercise_name_invalid':
        case 'tag_name_invalid': {
          skipped.push(id);
          continue;
        }
      }

      repaired.push(id);
    }

    for (const exerciseId of touchedExercises) {
      await tx.update(exercises).set(stampWrite()).where(eq(exercises.id, exerciseId));
    }

    return { repaired, skipped };
  });
}
