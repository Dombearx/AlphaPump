/**
 * Dwa zapytania, z których powstaje wyszukiwanie hybrydowe.
 *
 * Każde zwraca **uporządkowaną listę identyfikatorów** i nic więcej. Wyniki
 * liczbowe zostają w bazie, bo do scalenia listy RRF potrzebuje wyłącznie
 * miejsc — a `similarity()` z trigramów i `1 - (a <=> b)` z pgvectora mieszkają
 * w nieporównywalnych skalach (patrz `fuseRankings` w rdzeniu).
 *
 * ## Warstwa leksykalna
 *
 * Dwa mechanizmy naraz, bo łapią różne rzeczy:
 *
 * - **trigramy** (`pg_trgm`) — literówki i odmiana: „przysiady" trafia
 *   w „przysiad", „wyciskanei" w „wyciskanie",
 * - **`tsvector`** — dopasowanie po słowach niezależnie od kolejności:
 *   „sztanga lezac" trafia w „wyciskanie sztangi leżąc".
 *
 * Wejściem jest **slug**, nie nazwa. Slug jest już znormalizowany — bez ogonków
 * i wielkich liter — więc „ławka" i „lawka" dają te same trigramy bez dokładania
 * `unaccent` do każdego zapytania. Ta sama normalizacja stoi za identyfikatorami
 * ćwiczeń, czyli „identyczny slug" znaczy tu dokładnie „ten sam wiersz u tego
 * samego autora".
 *
 * ## Warstwa semantyczna
 *
 * Odległość kosinusowa po gotowych wektorach. Filtr po modelu jest tu istotny:
 * wektory z dwóch różnych modeli leżą w różnych przestrzeniach, a ich porównanie
 * daje wyniki, które wyglądają poprawnie i nie są. Po zmianie modelu stare
 * wiersze są więc niewidoczne, dopóki nie zostaną przeliczone.
 */

import { slug } from '@alphapump/core';
import { and, asc, desc, eq, isNull, ne, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exerciseEmbeddings, exercises } from '../schema.js';
import { vectorLiteral } from './embeddings.js';
import type { Embedder } from './layers.js';

/**
 * Minimalne podobieństwo trigramowe, przy którym wpis wchodzi na listę.
 *
 * Wartość jest tą samą, którą `pg_trgm` przyjmuje domyślnie dla operatora `%`,
 * ale podana jawnie: operator czyta ją z ustawienia sesji, a ustawienie potrafi
 * być inne na minipc niż w PGlite w testach. Progu, od którego zależy, co
 * użytkownik zobaczy, nie zostawiamy w konfiguracji serwera.
 */
export const LEXICAL_MIN_SIMILARITY = 0.3;

/**
 * Minimalne podobieństwo kosinusowe wektorów.
 *
 * Wektory dwóch dowolnych krótkich fraz rzadko są ortogonalne, więc bez progu
 * lista semantyczna zawsze zwracałaby pełne `limit` pozycji — także dla nazwy,
 * która nie ma w bibliotece żadnego odpowiednika. Wpis znaleziony wyłącznie
 * semantycznie i słabo trafiony psułby wtedy ostrzeżenie, zamiast je poprawiać.
 * Wartość jest heurystyką dobraną ostrożnie i to ona jest pierwszym pokrętłem
 * do zmierzenia po wyborze konkretnego modelu embeddingów.
 */
export const SEMANTIC_MIN_SIMILARITY = 0.5;

/** Ile pozycji bierze każda warstwa przed scaleniem. */
export const LAYER_LIMIT = 10;

export interface SearchOptions {
  limit?: number;
  /** Ćwiczenie pomijane w wynikach — przy edycji jest nim edytowany wiersz. */
  excludeId?: string | null;
}

const notExcluded = (excludeId: string | null | undefined): SQL | undefined =>
  excludeId === null || excludeId === undefined ? undefined : ne(exercises.id, excludeId);

/** Lista leksykalna: identyfikatory od najlepiej dopasowanego. */
export async function lexicalSearch(
  db: Database,
  name: string,
  options: SearchOptions = {},
): Promise<string[]> {
  const needle = slug(name);
  if (needle.length === 0) return [];

  // `plainto_tsquery` chce słów, a slug ma myślniki — zamiana daje z „martwy-ciag"
  // zapytanie „martwy & ciag", czyli oba słowa muszą trafić.
  const words = needle.replaceAll('-', ' ');

  const trigram = sql<number>`similarity(${exercises.slug}, ${needle})`;
  const document = sql`to_tsvector('simple', replace(${exercises.slug}, '-', ' '))`;
  const query = sql`plainto_tsquery('simple', ${words})`;
  const lexical = sql<number>`greatest(${trigram}, ts_rank(${document}, ${query}))`;

  const rows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        isNull(exercises.deletedAt),
        notExcluded(options.excludeId),
        sql`(${trigram} >= ${LEXICAL_MIN_SIMILARITY} or ${document} @@ ${query})`,
      ),
    )
    // Nazwa dokłada się do porządku po wyniku, żeby remis nie zależał od
    // kolejności wierszy w tabeli — wynik jedzie potem do cache'u i do modelu.
    .orderBy(desc(lexical), asc(exercises.name))
    .limit(options.limit ?? LAYER_LIMIT);

  return rows.map((row) => row.id);
}

/**
 * Lista semantyczna: identyfikatory od najbliższego wektora.
 *
 * Rzuca, gdy dostawca modeli nie odpowiedział — i tak ma być. Decyzja „oddaj
 * wynik samej warstwy leksykalnej i oznacz odpowiedź jako `lexical`" należy do
 * `service.ts`, bo to on składa odpowiedź i wie, czym dysponuje. Przechwycenie
 * błędu tutaj zamieniłoby awarię dostawcy w „nic nie znalazłem", czyli w dwie
 * nierozróżnialne sytuacje.
 */
export async function semanticSearch(
  db: Database,
  embedder: Embedder,
  name: string,
  options: SearchOptions = {},
): Promise<string[]> {
  const embedding = await embedder.embed(name);

  const vector = sql`${vectorLiteral(embedding)}::vector`;
  const distance = sql<number>`${exerciseEmbeddings.embedding} <=> ${vector}`;

  const rows = await db
    .select({ id: exerciseEmbeddings.exerciseId })
    .from(exerciseEmbeddings)
    .innerJoin(exercises, eq(exercises.id, exerciseEmbeddings.exerciseId))
    .where(
      and(
        isNull(exercises.deletedAt),
        notExcluded(options.excludeId),
        eq(exerciseEmbeddings.model, embedder.model),
        sql`(1 - (${distance})) >= ${SEMANTIC_MIN_SIMILARITY}`,
      ),
    )
    .orderBy(asc(distance))
    .limit(options.limit ?? LAYER_LIMIT);

  return rows.map((row) => row.id);
}
