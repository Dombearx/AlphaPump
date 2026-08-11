/**
 * Warstwy 2 i 3 wykrywania duplikatów, widziane jako zależności.
 *
 * Moduł opisuje **co** warstwy robią, a nie **czym** — implementacja przez
 * OpenRouter jest obok, w `openrouter.ts`. Podział nie jest tu ceremonią:
 *
 * - testy integracyjne API muszą sprawdzić scalanie RRF, cache i nakładanie
 *   werdyktów **bez wychodzenia do sieci**, bo inaczej CI zależałby od cudzego
 *   serwisu i od klucza w sekretach,
 * - `null` w miejscu warstwy jest pełnoprawnym stanem, a nie awarią: tak wygląda
 *   wyłączona warstwa semantyczna albo wyłączony re-ranker.
 *
 * Obie warstwy mają jedną wspólną regułę: **nie wolno im wywrócić żądania**.
 * Wykrywanie duplikatów jest podpowiedzią przy tworzeniu ćwiczenia i specyfikacja
 * wprost zabrania blokowania zapisu, więc awaria dostawcy modeli musi kończyć się
 * węższą odpowiedzią, a nie błędem. Wołający (`service.ts`) egzekwuje to,
 * przechwytując wyjątki — implementacje nie muszą udawać, że nic się nie stało.
 */

import type { RerankVerdict } from '@alphapump/core';

/** Warstwa 2: nazwa ćwiczenia na wektor. */
export interface Embedder {
  /** Identyfikator modelu — trafia do wiersza, bo wektory z dwóch modeli są nieporównywalne. */
  readonly model: string;
  embed(text: string): Promise<number[]>;
}

/** Kandydat pokazywany modelowi. Bez identyfikatorów — model odpowiada po indeksach. */
export interface RerankCandidate {
  name: string;
  authorNickname: string;
  primaryTagName: string;
}

/** Warstwa 3: ocena kandydatów wraz z uzasadnieniem. */
export interface Reranker {
  readonly model: string;
  rank(query: string, candidates: readonly RerankCandidate[]): Promise<RerankVerdict[]>;
}

/**
 * Zestaw warstw, którym dysponuje aplikacja.
 *
 * Domyślnie oba pola są puste. Asymetria względem przeliczeń danych pochodnych
 * (`AppDependencies.derived`, gdzie domyślny jest **komplet**) jest zamierzona:
 * brak przeliczenia rekordów to cichy błąd poprawności, a włączona z przeoczenia
 * warstwa LLM to wychodzące żądania i rachunek u dostawcy. Bezpieczna wartość
 * domyślna jest więc w każdym z tych przypadków inna.
 */
export interface DuplicateLayers {
  embedder: Embedder | null;
  reranker: Reranker | null;
}

export const NO_LAYERS: DuplicateLayers = { embedder: null, reranker: null };
