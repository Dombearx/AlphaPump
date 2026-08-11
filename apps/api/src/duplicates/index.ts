/**
 * Wykrywanie duplikatów ćwiczeń — warstwy serwerowe (etap 12).
 *
 * Wejście zbiorcze modułu. Reszta aplikacji woła stąd trzy rzeczy:
 * `findDuplicates` (odpowiedź dla ekranu tworzenia ćwiczenia), `refreshEmbedding`
 * i `refreshEmbeddings` (ścieżka zapisu ćwiczenia i push) oraz
 * `createOpenRouterLayers` (złożenie warstw z konfiguracji, wołane raz przy
 * starcie serwera).
 */

export {
  candidatesFingerprint,
  countCache,
  pruneCache,
  DEFAULT_CACHE_RETENTION_DAYS,
} from './cache.js';
export {
  dropEmbeddings,
  embeddingSource,
  refreshEmbedding,
  refreshEmbeddings,
  vectorLiteral,
  type EmbeddingOutcome,
} from './embeddings.js';
export {
  NO_LAYERS,
  type DuplicateLayers,
  type Embedder,
  type RerankCandidate,
  type Reranker,
} from './layers.js';
export { createOpenRouterLayers } from './openrouter.js';
export {
  LAYER_LIMIT,
  LEXICAL_MIN_SIMILARITY,
  SEMANTIC_MIN_SIMILARITY,
  lexicalSearch,
  semanticSearch,
} from './search.js';
export { findDuplicates, type FindDuplicatesInput } from './service.js';
