/**
 * Złożenie trzech warstw wykrywania duplikatów w jedną odpowiedź.
 *
 * Kolejność jest ustalona i wynika z kosztu: najpierw dwa zapytania do bazy
 * (grosze, milisekundy), potem scalenie RRF, a dopiero na końcu — na krótkiej,
 * już zawężonej liście — model generatywny. Odwrotna kolejność, czyli pokazanie
 * modelowi całej biblioteki, byłaby prostsza w kodzie i nieporównywalnie
 * droższa; a przy okazji gorsza, bo model musiałby wykonać pracę, którą
 * embeddingi robią lepiej.
 *
 * ## Degradacja jest tu funkcją, nie awarią
 *
 * Każda warstwa może zniknąć — z wyłącznika, z braku klucza, z powodu awarii
 * dostawcy albo z przekroczonego limitu czasu. Odpowiedź niesie wtedy `layer`
 * mówiący, dokąd doszliśmy:
 *
 * | `layer`   | Co się wykonało                                    |
 * | --------- | -------------------------------------------------- |
 * | `lexical` | tylko trigramy i `tsvector` — sama pisownia        |
 * | `hybrid`  | dołączyła warstwa wektorowa                        |
 * | `llm`     | doszła ocena i uzasadnienie z re-rankera           |
 *
 * Aplikacja mobilna potrzebuje tej informacji, bo „warstwa nie działała" i „nie
 * ma duplikatu" prowadzą do różnych komunikatów. Zapis ćwiczenia nie jest
 * blokowany w żadnym z tych przypadków.
 */

import {
  DUPLICATE_CANDIDATE_LIMIT,
  applyVerdicts,
  orderByVerdict,
  slug,
  fuseRankings,
  type DuplicateCandidate,
  type DuplicateCheckResponse,
  type DuplicateLayer,
  type DuplicateSource,
  type RerankVerdict,
} from '@alphapump/core';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exercises, tags, users } from '../schema.js';
import { cacheKey, readCachedVerdicts, writeCachedVerdicts } from './cache.js';
import type { DuplicateLayers, RerankCandidate } from './layers.js';
import { LAYER_LIMIT, lexicalSearch, semanticSearch } from './search.js';
import { logger } from '../logger.js';

/** Błąd sprowadzony do napisu — logger dostaje pola, nie wyjątki. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface FindDuplicatesInput {
  name: string;
  /** Ćwiczenie pomijane w wynikach — przy edycji jest nim edytowany wiersz. */
  excludeId?: string | null;
  limit?: number;
}

/** Wiersze potrzebne do zbudowania kandydata: nazwa, autor i tag główny. */
async function loadCandidateRows(
  db: Database,
  exerciseIds: readonly string[],
): Promise<Map<string, { name: string; slug: string; authorNickname: string; tagName: string }>> {
  if (exerciseIds.length === 0) return new Map();

  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      slug: exercises.slug,
      authorNickname: users.nickname,
      tagName: tags.name,
    })
    .from(exercises)
    .innerJoin(users, eq(users.id, exercises.authorId))
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(and(inArray(exercises.id, [...exerciseIds]), isNull(exercises.deletedAt)));

  return new Map(rows.map((row) => [row.id, row]));
}

export async function findDuplicates(
  db: Database,
  layers: DuplicateLayers,
  input: FindDuplicatesInput,
): Promise<DuplicateCheckResponse> {
  const needle = slug(input.name);
  const limit = input.limit ?? DUPLICATE_CANDIDATE_LIMIT;

  // Nazwa bez ani jednej litery nie ma sluga, a więc nie ma czego szukać —
  // ten sam warunek, który przy tworzeniu ćwiczenia odrzuca nazwę bez znaczenia.
  if (needle.length === 0) {
    return { query: input.name, layer: 'lexical', candidates: [] };
  }

  const options = { excludeId: input.excludeId ?? null, limit: LAYER_LIMIT };
  const lexical = await lexicalSearch(db, input.name, options);

  let layer: DuplicateLayer = 'lexical';
  let semantic: string[] = [];

  if (layers.embedder !== null) {
    try {
      semantic = await semanticSearch(db, layers.embedder, input.name, options);
      layer = 'hybrid';
    } catch (error) {
      // Dostawca modeli nie odpowiedział. Zostajemy z warstwą leksykalną —
      // ostrzeżenie o duplikacie ma się pokazać zawsze, choćby węższe.
      logger.warn('warstwa semantyczna nie odpowiedziała', { error: describe(error) });
    }
  }

  const fused = fuseRankings(
    [
      { source: 'lexical' satisfies DuplicateSource, ids: lexical },
      { source: 'semantic' satisfies DuplicateSource, ids: semantic },
    ],
    { limit },
  );

  const rows = await loadCandidateRows(
    db,
    fused.map((entry) => entry.id),
  );

  let candidates: DuplicateCandidate[] = fused.flatMap((entry) => {
    const row = rows.get(entry.id);
    // Wiersz mógł zniknąć między zapytaniem a odczytem — kandydat, którego nie
    // ma, nie może wejść do odpowiedzi ani do wejścia dla modelu.
    if (!row) return [];

    return [
      {
        exerciseId: entry.id,
        name: row.name,
        authorNickname: row.authorNickname,
        primaryTagName: row.tagName,
        score: entry.score,
        sources: entry.sources as DuplicateSource[],
        identical: row.slug === needle,
        duplicate: null,
        reason: null,
      },
    ];
  });

  if (layers.reranker !== null && candidates.length > 0) {
    const verdicts = await rerank(db, layers, input.name, candidates);
    if (verdicts !== null) {
      candidates = orderByVerdict(applyVerdicts(candidates, verdicts));
      layer = 'llm';
    }
  }

  return { query: input.name, layer, candidates };
}

/**
 * Warstwa 3 z cache'em. `null` znaczy „nie udało się ocenić" — wołający zostawia
 * wtedy kandydatów bez werdyktów i nie awansuje warstwy odpowiedzi.
 */
async function rerank(
  db: Database,
  layers: DuplicateLayers,
  query: string,
  candidates: readonly DuplicateCandidate[],
): Promise<RerankVerdict[] | null> {
  const reranker = layers.reranker;
  if (reranker === null) return null;

  const key = cacheKey(
    query,
    candidates.map((candidate) => candidate.exerciseId),
    reranker.model,
  );

  const cached = await readCachedVerdicts(db, key);
  if (cached !== null) return cached;

  const forModel: RerankCandidate[] = candidates.map((candidate) => ({
    name: candidate.name,
    authorNickname: candidate.authorNickname,
    primaryTagName: candidate.primaryTagName,
  }));

  try {
    const verdicts = await reranker.rank(query, forModel);
    await writeCachedVerdicts(db, key, verdicts);
    return verdicts;
  } catch (error) {
    // Model odmówił, przekroczył limit czasu albo zwrócił coś, czego nie
    // przepuścił schemat. Odpowiedź zostaje na warstwie 2 — bez oceny, ale
    // z kandydatami.
    logger.warn('re-ranker nie odpowiedział', { error: describe(error) });
    return null;
  }
}
