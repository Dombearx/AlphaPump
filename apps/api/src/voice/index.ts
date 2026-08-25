/**
 * Dyktowanie serii — warstwa serwerowa.
 *
 * Wejście zbiorcze modułu. Reszta aplikacji woła stąd cztery rzeczy:
 * `dictateSet` i `describeSet` (dwa wejścia ekranu dyktowania — nagranie
 * i opis z klawiatury), `createVoiceLayers` (złożenie warstw z konfiguracji,
 * wołane raz przy starcie serwera) oraz `voiceAvailable`/`speechAvailable`
 * (czy endpointy mają czym odpowiedzieć).
 */

import type { LlmConfig, VoiceConfig } from '../config.js';
import { createOpenRouterInterpreter } from './interpreter.js';
import { createHttpTranscriber } from './speech.js';
import type { VoiceLayers } from './service.js';

export { formatRecentSet, voiceExercises, voiceRecentSets } from './context.js';
export {
  createOpenRouterInterpreter,
  type VoiceInterpretation,
  type VoiceInterpreter,
} from './interpreter.js';
export { createHttpTranscriber } from './speech.js';
export {
  NO_VOICE,
  describeSet,
  dictateSet,
  speechAvailable,
  voiceAvailable,
  type DescribeSetInput,
  type DictateSetInput,
  type VoiceLayers,
} from './service.js';
export type { Transcriber, VoiceRecording } from './transcriber.js';

/**
 * Warstwy dyktowania z konfiguracji.
 *
 * Dwie warstwy u **dwóch różnych dostawców** — transkrypcja własnym kluczem,
 * interpretacja kluczem OpenRoutera — ale nie są równorzędne: bez interpretera
 * nie ma dyktowania w ogóle, a bez transkrypcji nie ma tylko mikrofonu.
 * Rozstrzygają o tym `voiceAvailable` i `speechAvailable`, a nie wołający, żeby
 * warunek nie rozjechał się między endpointem a logiem przy starcie serwera.
 */
export function createVoiceLayers(llm: LlmConfig | null, voice: VoiceConfig | null): VoiceLayers {
  return {
    transcriber: createHttpTranscriber(voice),
    interpreter: createOpenRouterInterpreter(llm, voice),
  };
}
