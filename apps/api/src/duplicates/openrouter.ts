/**
 * Warstwy 2 i 3 na OpenRouterze.
 *
 * Jeden dostawca i jeden klucz na embeddingi i na model czatowy — dlatego cały
 * pipeline zostaje u jednego dostawcy zamiast rozjeżdżać się na dwóch. Wywołania
 * wychodzą **wyłącznie stąd**, czyli z backendu: klucz OpenRoutera nie może
 * trafić do binarki aplikacji mobilnej, bo ta jest w praktyce publiczna.
 *
 * ## Dlaczego re-ranker dostaje kandydatów bez identyfikatorów
 *
 * Model odpowiada werdyktami po **indeksach** listy, a nie po UUID-ach. UUID
 * przepisany przez model z jednym przekręconym znakiem trafiałby w nieistniejący
 * wiersz albo — gorzej — w cudzy. Indeks z zakresu 0–9 jest odporny na tę klasę
 * pomyłek, a indeks spoza zakresu odrzuca `applyVerdicts` w rdzeniu.
 *
 * ## Dlaczego limit czasu jest krótki
 *
 * Ostrzeżenie o duplikacie jest podpowiedzią pokazywaną w trakcie pisania nazwy.
 * Model, który odpowiada po dziesięciu sekundach, nie jest już podpowiedzią —
 * jest karą za wpisanie nazwy. Po przekroczeniu limitu warstwa zwraca błąd,
 * a `service.ts` oddaje wynik z warstw, które zdążyły.
 */

import { rerankResultSchema, type RerankVerdict } from '@alphapump/core';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { embed, generateObject } from 'ai';
import type { LlmConfig } from '../config.js';
import type { DuplicateLayers, Embedder, RerankCandidate, Reranker } from './layers.js';

const SYSTEM_PROMPT = [
  'Jesteś asystentem porządkującym bibliotekę ćwiczeń w aplikacji treningowej.',
  'Dostajesz nazwę nowego ćwiczenia i listę ćwiczeń już istniejących.',
  'Dla każdej pozycji z listy oceniasz, czy opisuje **to samo ćwiczenie** co nazwa nowa —',
  'także wtedy, gdy jest to inny język lub inna nazwa potoczna („martwy ciąg" i „deadlift").',
  'Wariant tego samego ruchu wykonywany innym sprzętem, innym chwytem lub w innym zakresie',
  'ruchu **nie** jest duplikatem.',
  'Uzasadnienie pisz po polsku, jednym zdaniem, tak jak powiedziałbyś to użytkownikowi.',
  'Odpowiadaj wyłącznie o pozycjach z listy i odnoś się do nich przez ich indeks.',
].join(' ');

function candidateList(candidates: readonly RerankCandidate[]): string {
  return candidates
    .map(
      (candidate, index) =>
        `${String(index)}. ${candidate.name} (autor: ${candidate.authorNickname}, ` +
        `partia: ${candidate.primaryTagName})`,
    )
    .join('\n');
}

/**
 * Składa warstwy z konfiguracji. `null` w konfiguracji znaczy „warstwa
 * wyłączona" i tu również daje puste warstwy — decyzja o wyłączeniu jest
 * podejmowana raz, przy czytaniu środowiska.
 */
export function createOpenRouterLayers(config: LlmConfig | null): DuplicateLayers {
  if (config === null) return { embedder: null, reranker: null };

  const openrouter = createOpenRouter({ apiKey: config.apiKey });

  const embedder: Embedder = {
    model: config.embeddingModel,
    async embed(text) {
      const { embedding } = await embed({
        model: openrouter.textEmbeddingModel(config.embeddingModel),
        value: text,
        abortSignal: AbortSignal.timeout(config.timeoutMs),
      });
      return embedding;
    },
  };

  // Warstwa 3 wyłącza się osobno od warstwy 2. Do znalezienia podobnych
  // wystarczą embeddingi — model generatywny dokłada ocenę i uzasadnienie,
  // czyli wygodę, nie funkcję.
  const reranker: Reranker | null = config.rerankerEnabled
    ? {
        model: config.rerankerModel,
        async rank(query, candidates) {
          const { object } = await generateObject({
            model: openrouter.chat(config.rerankerModel),
            schema: rerankResultSchema,
            system: SYSTEM_PROMPT,
            prompt: `Nowe ćwiczenie: „${query}"\n\nIstniejące:\n${candidateList(candidates)}`,
            abortSignal: AbortSignal.timeout(config.timeoutMs),
          });
          return object.verdicts satisfies RerankVerdict[];
        },
      }
    : null;

  return { embedder, reranker };
}
