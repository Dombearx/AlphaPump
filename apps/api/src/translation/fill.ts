/**
 * Domknięcie zestawu tłumaczeń jednego wiersza — tagu albo ćwiczenia.
 *
 * ## Co tu jest regułą, a co szczegółem
 *
 * Regułą jest to, że tłumaczenie **wyłącznie uzupełnia luki**: nazwa wpisana
 * ręcznie ma pierwszeństwo przed nazwą z modelu, dziś i po każdym kolejnym
 * przebiegu. Pilnuje tego `mergeTranslations` z rdzenia, a nie kod poniżej —
 * ta sama funkcja domyka zestaw przy pushu z telefonu.
 *
 * ## Dlaczego wiersz czytamy dwa razy
 *
 * Bo między pytaniem modelu a zapisem mija kilka sekund, a w tym czasie
 * użytkownik zdąży zmienić nazwę, dopisać własne tłumaczenie albo skasować
 * ćwiczenie. Drugi odczyt sprawia, że zapis dokłada tłumaczenia do stanu
 * **aktualnego**, a nie do tego sprzed wywołania — i że wiersz z tombstonem nie
 * wraca do życia przez cudzy przebieg w tle.
 *
 * ## Dlaczego zapis podbija `updated_at`
 *
 * Inaczej nie dojechałby na telefon. Pull chodzi po `server_seq`, ale o tym,
 * czy przyjąć wiersz, decyduje po stronie urządzenia LWW po `updated_at` — więc
 * zapis z niezmienionym znacznikiem przegrałby z wersją lokalną i tłumaczenie
 * zostałoby na serwerze. Jest to różnica względem uzupełniania biblioteki
 * wbudowanej w seedzie, gdzie `updated_at` **nie** wolno ruszyć: tamto dzieje
 * się przy każdym starcie, więc wiersz wbudowany wygrywałby w kółko z edycją
 * użytkownika. Tutaj zapis zdarza się raz na wiersz, kilka sekund po jego
 * utworzeniu.
 */

import { mergeTranslations, missingLanguages, type Translations } from '@alphapump/core';
import { and, eq, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { logger } from '../logger.js';
import { exercises, tags } from '../schema.js';
import { stampWrite } from '../sync-columns.js';
import type { Translator } from './translator.js';

/** Co się stało z jednym wierszem — liczone przez kolejkę i pokazywane w panelu. */
export type TranslationOutcome =
  /** Model odpowiedział, zestaw został domknięty. */
  | 'written'
  /** Komplet nazw już był — model nie był pytany. */
  | 'complete'
  /** Wiersz zniknął albo dostał tombstone w trakcie tłumaczenia. */
  | 'gone'
  /**
   * Nazwa zmieniła się w trakcie tłumaczenia — odpowiedź modelu dotyczy już
   * nieaktualnej. Zapis, który ją zmienił, zgłosił wiersz do kolejki ponownie,
   * więc tłumaczenie przyjdzie z nowej nazwy zamiast z tej sprzed sekundy.
   */
  | 'stale'
  /** Model nie odpowiedział albo oddał same puste nazwy — zapis zostaje bez tłumaczenia. */
  | 'failed';

/** Rodzaj wiersza. Model tłumaczy „klatka" inaczej niż „wyciskanie na klatkę". */
export type TranslatableEntity = 'tag' | 'exercise';

export interface TranslationTarget {
  entity: TranslatableEntity;
  id: string;
}

/** Błąd sprowadzony do napisu — logger dostaje pola, nie wyjątki. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Loaded {
  name: string;
  translations: Translations | null;
  /** Tag główny ćwiczenia; przy tagu `null`. */
  context: string | null;
}

async function loadTag(db: Database, id: string): Promise<Loaded | null> {
  const [row] = await db
    .select({ name: tags.name, translations: tags.translations })
    .from(tags)
    .where(and(eq(tags.id, id), isNull(tags.deletedAt)))
    .limit(1);

  return row ? { ...row, context: null } : null;
}

async function loadExercise(db: Database, id: string): Promise<Loaded | null> {
  const [row] = await db
    .select({
      name: exercises.name,
      translations: exercises.translations,
      context: tags.name,
    })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(and(eq(exercises.id, id), isNull(exercises.deletedAt)))
    .limit(1);

  return row ?? null;
}

const load = (db: Database, target: TranslationTarget): Promise<Loaded | null> =>
  target.entity === 'tag' ? loadTag(db, target.id) : loadExercise(db, target.id);

async function write(
  db: Database,
  target: TranslationTarget,
  translations: Translations,
): Promise<void> {
  const values = { translations, ...stampWrite() };

  if (target.entity === 'tag') {
    await db
      .update(tags)
      .set(values)
      .where(and(eq(tags.id, target.id), isNull(tags.deletedAt)));
    return;
  }

  await db
    .update(exercises)
    .set(values)
    .where(and(eq(exercises.id, target.id), isNull(exercises.deletedAt)));
}

/**
 * Uzupełnia brakujące nazwy jednego wiersza.
 *
 * Funkcja **nie rzuca**. Awaria dostawcy modeli, przekroczony limit czasu
 * i odpowiedź bez ani jednej użytecznej nazwy dają ten sam wynik: `failed`,
 * wpis w logu i wiersz zapisany bez tłumaczenia — czyli dokładnie to, co
 * proponował opis zgłoszenia i co robi warstwa 3 wykrywania duplikatów.
 * Wołający (kolejka, CLI) liczy wyniki, ale nie ma czego obsługiwać.
 */
export async function fillTranslations(
  db: Database,
  translator: Translator | null,
  target: TranslationTarget,
): Promise<TranslationOutcome> {
  if (translator === null) return 'failed';

  const before = await load(db, target);
  if (before === null) return 'gone';

  const missing = missingLanguages(before.translations);
  if (missing.length === 0) return 'complete';

  let translated: Translations;
  try {
    translated = await translator.translate({
      name: before.name,
      kind: target.entity,
      context: before.context,
      missing,
    });
  } catch (error) {
    logger.warn('tłumaczenie nazwy nie powiodło się', {
      entity: target.entity,
      id: target.id,
      model: translator.model,
      error: describe(error),
      effect: 'wiersz zostaje z nazwą kanoniczną',
    });
    return 'failed';
  }

  if (Object.keys(translated).length === 0) {
    logger.warn('model nie oddał żadnej nazwy', {
      entity: target.entity,
      id: target.id,
      model: translator.model,
      missing,
    });
    return 'failed';
  }

  // Drugi odczyt: przez czas wywołania wiersz mógł zmienić nazwę, dostać własne
  // tłumaczenie albo tombstone.
  const current = await load(db, target);
  if (current === null) return 'gone';
  if (current.name !== before.name) return 'stale';

  const merged = mergeTranslations(current.translations, translated);
  if (merged === null) return 'failed';

  await write(db, target, merged);
  return 'written';
}
