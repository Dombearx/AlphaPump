/**
 * Przeliczanie wektorów **poza** ścieżką żądania.
 *
 * ## Dlaczego to nie może się dziać w trakcie pushu
 *
 * `POST /sync/push` liczył wektory nowych ćwiczeń w środku obsługi żądania,
 * sekwencyjnie, z limitem `LLM_TIMEOUT_MS` (domyślnie 8 s) na wywołanie. Telefon
 * przerywa żądanie po 15 s (`apps/mobile/src/sync/transport.ts`), więc dwa
 * ćwiczenia utworzone offline przy wolnym dostawcy modeli wystarczały, żeby ten
 * budżet przekroczyć.
 *
 * Skutek był gorszy niż samo czekanie: telefon dostawał `SyncOfflineError`,
 * pokazywał „offline" mimo działającego VPN-a, zaczynał wycofywanie i ponawiał
 * push — a serwer w tym czasie dokańczał zapis i liczył wektory po raz drugi.
 * Górna granica jest absurdalna: paczka może nieść do pięciuset ćwiczeń.
 *
 * ## Dlaczego to jest kolejka, a nie „odpal i zapomnij"
 *
 * Samo `void refreshEmbeddings(...)` odczepiłoby wektory od żądania i wystarczyło
 * do naprawienia objawu, ale otwierało drugi: dwa pushy naraz to dwa niezależne
 * ciągi wywołań u dostawcy modeli, a przeliczenie całej biblioteki z panelu — trzeci.
 * Jedna kolejka z jednym wykonawcą znaczy, że wywołania są szeregowane niezależnie
 * od tego, ile żądań je zgłosiło, i że da się zapytać, czy coś jeszcze trwa.
 *
 * Brak wektora jest stanem w pełni obsłużonym: ćwiczenie znajdzie się warstwą
 * leksykalną, a wektor dostanie przy najbliższym przebiegu. Dlatego zgłoszenie
 * do kolejki nie czeka, nie rzuca i nie ma jak wywrócić zapisu, który je
 * wywołał — a `enqueue` nie zwraca obietnicy właśnie po to, żeby nikt nie
 * spróbował na nią zaczekać.
 */

import { asc, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exercises } from '../schema.js';
import { refreshEmbedding } from './embeddings.js';
import type { DuplicateLayers } from './layers.js';

export interface EmbeddingBacklogStatus {
  /** Czy warstwa semantyczna w ogóle jest włączona. */
  enabled: boolean;
  /** Czy wykonawca właśnie pracuje. */
  running: boolean;
  /** Ile ćwiczeń czeka w kolejce. */
  pending: number;
  /** Wektory zapisane od startu procesu. */
  written: number;
  /** Ćwiczenia, dla których tekst źródłowy się nie zmienił. */
  unchanged: number;
  /** Wywołania, które się nie udały — model nie odpowiedział albo odmówił. */
  failed: number;
}

export interface EmbeddingBacklog {
  /** Zgłasza ćwiczenia do przeliczenia. Nie czeka i nie rzuca. */
  enqueue(exerciseIds: readonly string[]): void;
  /**
   * Zgłasza **całą** bibliotekę. Zwraca liczbę ćwiczeń, które weszły do kolejki,
   * albo `null`, gdy warstwa semantyczna jest wyłączona.
   */
  enqueueLibrary(): Promise<number | null>;
  status(): EmbeddingBacklogStatus;
  /** Czeka na opróżnienie kolejki. Istnieje dla testów — produkcja nie czeka. */
  drain(): Promise<void>;
}

export function createEmbeddingBacklog(db: Database, layers: DuplicateLayers): EmbeddingBacklog {
  const embedder = layers.embedder;

  const queue = new Set<string>();
  let worker: Promise<void> | null = null;
  let written = 0;
  let unchanged = 0;
  let failed = 0;

  const run = async (): Promise<void> => {
    // `for (const id of queue)` po zbiorze, który w trakcie rośnie, byłby
    // zależny od szczegółu implementacji iteratora. Zdejmujemy więc po jednym,
    // dopóki cokolwiek zostaje — zgłoszenie w trakcie pracy dołącza do tego
    // samego przebiegu, zamiast czekać na następny.
    while (queue.size > 0) {
      const [id] = queue;
      queue.delete(id as string);

      const outcome = await refreshEmbedding(db, embedder, id as string);
      if (outcome === 'written') written += 1;
      else if (outcome === 'unchanged') unchanged += 1;
      else if (outcome === 'failed') failed += 1;
    }
  };

  const wake = (): void => {
    if (embedder === null || worker !== null || queue.size === 0) return;
    worker = run().finally(() => {
      worker = null;
      // Zgłoszenie, które przyszło dokładnie w chwili kończenia przebiegu,
      // nie może zostać w kolejce bez wykonawcy.
      wake();
    });
  };

  return {
    enqueue(exerciseIds) {
      if (embedder === null) return;
      for (const id of exerciseIds) queue.add(id);
      wake();
    },

    async enqueueLibrary() {
      if (embedder === null) return null;

      const rows = await db
        .select({ id: exercises.id })
        .from(exercises)
        .where(isNull(exercises.deletedAt))
        .orderBy(asc(exercises.name));

      for (const row of rows) queue.add(row.id);
      wake();
      return rows.length;
    },

    status() {
      return {
        enabled: embedder !== null,
        running: worker !== null,
        pending: queue.size,
        written,
        unchanged,
        failed,
      };
    },

    async drain() {
      while (worker !== null) await worker;
    },
  };
}

/** Kolejka, która niczego nie robi — dla złożeń bez warstwy semantycznej. */
export const NO_BACKLOG: EmbeddingBacklog = {
  enqueue() {},
  enqueueLibrary: async () => null,
  status: () => ({
    enabled: false,
    running: false,
    pending: 0,
    written: 0,
    unchanged: 0,
    failed: 0,
  }),
  drain: async () => undefined,
};
