/**
 * Dyktowanie serii głosem — warstwa serwerowa.
 *
 * Wejście zbiorcze modułu. Reszta aplikacji woła stąd trzy rzeczy: `dictateSet`
 * (odpowiedź dla ekranu dyktowania), `createVoiceLayers` (złożenie warstw
 * z konfiguracji, wołane raz przy starcie serwera) oraz `voiceAvailable` (czy
 * endpoint ma czym odpowiedzieć).
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
  dictateSet,
  voiceAvailable,
  type DictateSetInput,
  type VoiceLayers,
} from './service.js';
export type { Transcriber, VoiceRecording } from './transcriber.js';

/**
 * Warstwy dyktowania z konfiguracji.
 *
 * Dwie warstwy u **dwóch różnych dostawców** — transkrypcja własnym kluczem,
 * interpretacja kluczem OpenRoutera — więc `null` w jednej z nich znaczy tyle
 * samo co `null` w obu: dyktowania nie ma. Rozstrzyga o tym `voiceAvailable`,
 * a nie wołający, żeby warunek nie rozjechał się między endpointem a logiem
 * przy starcie serwera.
 */
export function createVoiceLayers(llm: LlmConfig | null, voice: VoiceConfig | null): VoiceLayers {
  return {
    transcriber: createHttpTranscriber(voice),
    interpreter: createOpenRouterInterpreter(llm, voice),
  };
}
