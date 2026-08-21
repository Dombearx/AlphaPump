/**
 * Liczenie i zapisywanie embeddingów ćwiczeń.
 *
 * Embedding powstaje **raz, przy zapisie ćwiczenia**, a nie przy każdym pytaniu.
 * To jest cała różnica kosztowa między warstwą 2 a warstwą 3: przy tworzeniu
 * ćwiczenia liczymy jeden wektor, a przy każdym zapytaniu porównujemy go
 * z gotowymi. Liczenie embeddingów kandydatów w locie kosztowałoby tyle, ile
 * cała biblioteka, przy każdym naciśnięciu klawisza w formularzu.
 *
 * ## Nic tutaj nie może wywrócić zapisu
 *
 * Specyfikacja mówi wprost: utworzenie ćwiczenia **nigdy** nie jest blokowane.
 * Zapis wchodzi do bazy niezależnie od tego, czy dostawca modeli odpowiedział —
 * dlatego wszystkie funkcje tego modułu zwracają wynik zamiast rzucać, a awaria
 * kończy się wpisem w logu i brakiem wiersza w `exercise_embeddings`. Ćwiczenie
 * bez wektora jest normalnym stanem: znajdzie się warstwą leksykalną, a wektor
 * dostanie przy następnej próbie.
 *
 * ## Dlaczego wymiar jest sprawdzany
 *
 * Kolumna ma wymiar wpisany w schemat, bo tego wymaga indeks HNSW. Model
 * zwracający inny wymiar nie jest więc drobną niezgodnością — jest zmianą, której
 * baza nie przyjmie. Sprawdzamy to sami, żeby w logu było „model zwrócił 1536
 * wymiarów, schemat ma 1024", a nie komunikat sterownika o niezgodności typu.
 */

import { EMBEDDING_DIMENSIONS } from '@alphapump/db';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exerciseEmbeddings, exercises, tags } from '../schema.js';
import type { DuplicateLayers, Embedder } from './layers.js';
import { logger } from '../logger.js';

/** Błąd sprowadzony do napisu — logger dostaje pola, nie wyjątki. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Tekst, z którego liczony jest wektor.
 *
 * Sama nazwa bywa dwuznaczna („wznosy" — czego?), a tag główny jest tym jednym
 * słowem kontekstu, które model dostaje darmo, bo ćwiczenie i tak musi go mieć.
 * Funkcja jest wyeksportowana, bo jej wynik trafia do kolumny `source`: dopiero
 * porównanie zapisanego źródła z wyliczonym mówi, czy wektor jest jeszcze aktualny.
 */
export function embeddingSource(name: string, primaryTagName: string): string {
  return `${name} (${primaryTagName})`;
}

/** Wektor w postaci akceptowanej przez pgvector jako parametr zapytania. */
export function vectorLiteral(embedding: readonly number[]): string {
  return `[${embedding.join(',')}]`;
}

export type EmbeddingOutcome =
  /** Wektor policzony i zapisany. */
  | 'written'
  /** Wiersz był już aktualny — ten sam model i ten sam tekst źródłowy. */
  | 'unchanged'
  /** Warstwa wyłączona albo ćwiczenia nie ma. */
  | 'skipped'
  /** Dostawca modeli odmówił albo odpowiedział czymś, czego nie da się zapisać. */
  | 'failed';

/**
 * Przelicza wektor jednego ćwiczenia.
 *
 * Zwraca wynik zamiast rzucać — wołający jest ścieżką zapisu ćwiczenia i nie ma
 * prawa się na tym wywrócić.
 */
export async function refreshEmbedding(
  db: Database,
  embedder: Embedder | null,
  exerciseId: string,
  now: Date = new Date(),
): Promise<EmbeddingOutcome> {
  if (embedder === null) return 'skipped';

  const [row] = await db
    .select({ name: exercises.name, tagName: tags.name })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(and(eq(exercises.id, exerciseId), isNull(exercises.deletedAt)))
    .limit(1);

  // Ćwiczenie usunięte nie potrzebuje wektora — wyszukiwanie i tak go pomija.
  if (!row) return 'skipped';

  const source = embeddingSource(row.name, row.tagName);
  const [existing] = await db
    .select({ model: exerciseEmbeddings.model, source: exerciseEmbeddings.source })
    .from(exerciseEmbeddings)
    .where(eq(exerciseEmbeddings.exerciseId, exerciseId))
    .limit(1);

  if (existing && existing.model === embedder.model && existing.source === source) {
    return 'unchanged';
  }

  let embedding: number[];
  try {
    embedding = await embedder.embed(source);
  } catch (error) {
    logger.warn('nie udało się policzyć embeddingu', { exerciseId, error: describe(error) });
    return 'failed';
  }

  if (embedding.length !== EMBEDDING_DIMENSIONS) {
    logger.warn('model zwrócił wektor o innym wymiarze niż schemat', {
      model: embedder.model,
      received: embedding.length,
      expected: EMBEDDING_DIMENSIONS,
    });
    return 'failed';
  }

  const values = {
    exerciseId,
    model: embedder.model,
    source,
    embedding,
    computedAt: now,
  };

  await db
    .insert(exerciseEmbeddings)
    .values(values)
    .onConflictDoUpdate({ target: exerciseEmbeddings.exerciseId, set: values });

  return 'written';
}

/**
 * Przelicza wektory kilku ćwiczeń — wołane po pushu, który przywiózł ćwiczenia.
 *
 * Sekwencyjnie, nie równolegle: paczka pushu potrafi przywieźć kilkanaście
 * ćwiczeń, a równoległe wywołania u dostawcy modeli to najkrótsza droga do
 * limitu żądań. Ćwiczenia powstają rzadko, więc szeregowanie nic nie kosztuje.
 */
export async function refreshEmbeddings(
  db: Database,
  layers: DuplicateLayers,
  exerciseIds: readonly string[],
  now: Date = new Date(),
): Promise<void> {
  if (layers.embedder === null || exerciseIds.length === 0) return;

  for (const id of new Set(exerciseIds)) {
    await refreshEmbedding(db, layers.embedder, id, now);
  }
}

/**
 * Zdejmuje wektory ćwiczeń, których nazwa albo tag główny mogły się zmienić poza
 * ścieżką zapisu — używane przez zadanie porządkowe panelu administracyjnego.
 * Brak wektora nie psuje wyszukiwania, więc usunięcie jest bezpieczne w każdej
 * chwili.
 */
export async function dropEmbeddings(
  db: Database,
  exerciseIds: readonly string[],
): Promise<number> {
  const ids = [...new Set(exerciseIds)];
  if (ids.length === 0) return 0;

  const removed = await db
    .delete(exerciseEmbeddings)
    .where(inArray(exerciseEmbeddings.exerciseId, ids))
    .returning({ exerciseId: exerciseEmbeddings.exerciseId });

  return removed.length;
}
