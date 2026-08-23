/**
 * Tłumaczenie nazw na Haiku, przez OpenRoutera.
 *
 * Ten sam dostawca i ten sam klucz co embeddingi i re-ranker — z tego samego
 * powodu, dla którego tamte dwie warstwy nie rozjeżdżają się na dwóch
 * dostawców. Wywołanie wychodzi **wyłącznie stąd**, czyli z backendu: klucz
 * OpenRoutera nie może trafić do binarki aplikacji mobilnej, bo ta jest
 * w praktyce publiczna.
 *
 * ## Dlaczego model dostaje nazwę kanoniczną, a nie zestaw tłumaczeń
 *
 * Bo nazwa kanoniczna jest jedyną, o której wiadomo, że wpisał ją człowiek.
 * Tłumaczenie tłumaczenia oddala wynik od tego, co ktoś miał na myśli, a przy
 * kolejnych językach robi z tego głuchy telefon.
 *
 * ## Dlaczego prompt mówi, czego **nie** tłumaczyć
 *
 * Nazwy ćwiczeń są w dużej części zapożyczeniami, które w polszczyźnie
 * siłowni funkcjonują bez tłumaczenia: „deadlift" bywa „martwym ciągiem", ale
 * „hip thrust" zostaje „hip thrustem", a „Pull-up bar" w nazwie sprzętu nie
 * jest zdaniem do przełożenia. Model, któremu każe się przetłumaczyć wszystko,
 * produkuje kalki, których nikt nie używa i po których nie da się wyszukać
 * ćwiczenia.
 */

import {
  LANGUAGE_LABELS,
  translationResultSchema,
  translationsFromModel,
  type Translations,
} from '@alphapump/core';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import type { LlmConfig } from '../config.js';
import type { TranslationRequest, Translator } from './translator.js';

const SYSTEM_PROMPT = [
  'Tłumaczysz nazwy ćwiczeń i partii mięśniowych w aplikacji treningowej.',
  'Dostajesz jedną nazwę i listę języków, w których jej brakuje.',
  'Dla każdego z tych języków podajesz nazwę, której naprawdę używają ludzie na siłowni —',
  'nie dosłowne tłumaczenie słowo w słowo.',
  'Nazwę, która w danym języku funkcjonuje w oryginalnym brzmieniu („hip thrust", „plank"),',
  'zostawiasz bez zmian.',
  'Nazwy własne sprzętu i marek zostawiasz bez zmian.',
  'Odpowiadasz samą nazwą, bez objaśnień i bez wariantów w nawiasach.',
  'Języka, którego nazwy nie jesteś pewien, po prostu nie podajesz —',
  'brak nazwy jest lepszy niż nazwa zmyślona.',
].join(' ');

function userPrompt(request: TranslationRequest): string {
  const what = request.kind === 'tag' ? 'partia mięśniowa (tag)' : 'ćwiczenie';
  const wanted = request.missing.map((language) => `${language} (${LANGUAGE_LABELS[language]})`);

  return [
    `Rodzaj: ${what}`,
    `Nazwa: „${request.name}"`,
    ...(request.context ? [`Partia główna: ${request.context}`] : []),
    `Brakujące języki: ${wanted.join(', ')}`,
  ].join('\n');
}

/**
 * Tłumacz z konfiguracji albo `null`.
 *
 * `null` wychodzi z trzech powodów naraz i wszystkie trzy są tym samym stanem
 * „nie ma czym tłumaczyć": wyłączona cała warstwa LLM-owa (brak klucza albo
 * `LLM_ENABLED=false`, wtedy `config` jest `null`) i osobno wyłączone samo
 * tłumaczenie (`TRANSLATION_ENABLED=false`).
 */
export function createOpenRouterTranslator(config: LlmConfig | null): Translator | null {
  if (config === null || !config.translationEnabled) return null;

  const openrouter = createOpenRouter({ apiKey: config.apiKey });

  return {
    model: config.translationModel,
    async translate(request): Promise<Translations> {
      const { object } = await generateObject({
        model: openrouter.chat(config.translationModel),
        schema: translationResultSchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt(request),
        abortSignal: AbortSignal.timeout(config.translationTimeoutMs),
      });

      // Odpowiedź modelu jest danymi z zewnątrz także po walidacji schematu —
      // przycięcie do języków, o które pytaliśmy, i odsianie pustych nazw
      // dzieje się w rdzeniu, bo to reguła, a nie szczegół dostawcy.
      return translationsFromModel(object, request.missing);
    },
  };
}
