/**
 * Dyktowanie serii — przepływ od nagrania do wypełnionego formularza.
 *
 * Trzy kroki, każdy w osobnym pliku, tutaj złożone w jedno:
 * transkrypcja (`speech.ts`), kontekst z bazy (`context.ts`), interpretacja
 * przez model (`interpreter.ts`). Reguły nakładania werdyktu na listę ćwiczeń
 * stoją w rdzeniu (`@alphapump/core`), bo czyta je także telefon.
 *
 * ## Dlaczego awaria dostawcy jest tu błędem, a przy duplikatach nie była
 *
 * Bo to są dwie różne sytuacje. Ostrzeżenie o duplikacie jest **dodatkiem** do
 * ostrzeżenia liczonego lokalnie: gdy model milczy, użytkownik i tak dostaje
 * to, po co przyszedł. Dyktowanie jest **całą funkcją**: bez transkrypcji nie ma
 * czego pokazać, a ekran, który po naciśnięciu mikrofonu udaje, że nic się nie
 * stało, jest gorszy niż komunikat „nie udało się rozpoznać nagrania".
 *
 * Kosztu dla reszty aplikacji to nie ma żadnego: dyktowanie niczego nie zapisuje
 * i nie stoi na ścieżce zapisu serii. Zapisuje dopiero człowiek, w formularzu,
 * naciskając ten sam przycisk co zawsze.
 */

import { applyVoiceVerdict, type VoiceSetResponse } from '@alphapump/core';
import type { Database } from '../db.js';
import { voiceExercises, voiceRecentSets } from './context.js';
import type { VoiceInterpreter } from './interpreter.js';
import type { Transcriber, VoiceRecording } from './transcriber.js';

/**
 * Warstwy dyktowania widziane jako zależności — dokładnie ta sama konwencja co
 * przy `DuplicateLayers`. `null` w którymkolwiek polu znaczy „dyktowanie
 * wyłączone", a testy podstawiają tu funkcje bez sieci i bez klucza.
 */
export interface VoiceLayers {
  transcriber: Transcriber | null;
  interpreter: VoiceInterpreter | null;
}

export const NO_VOICE: VoiceLayers = { transcriber: null, interpreter: null };

/** Czy dyktowanie jest w tym procesie w ogóle dostępne. */
export function voiceAvailable(layers: VoiceLayers): boolean {
  return layers.transcriber !== null && layers.interpreter !== null;
}

export interface DictateSetInput {
  userId: string;
  recording: VoiceRecording;
}

/**
 * Jedno nagranie w jedną odpowiedź.
 *
 * Kontekst czytany jest **po** transkrypcji, a nie równolegle: nagranie, którego
 * nie da się rozpoznać, kończy przepływ, a wtedy dwa zapytania do bazy byłyby
 * pracą wykonaną na darmo. Pusta transkrypcja (cisza, nieodblokowany mikrofon)
 * jest właśnie takim przypadkiem i nie idzie do modelu — model dostałby zdanie
 * bez treści i musiał zgadywać.
 */
export async function dictateSet(
  db: Database,
  layers: VoiceLayers,
  input: DictateSetInput,
): Promise<VoiceSetResponse> {
  const { transcriber, interpreter } = layers;
  if (transcriber === null || interpreter === null) {
    throw new Error('Dyktowanie jest wyłączone');
  }

  const transcript = await transcriber.transcribe(input.recording);
  if (transcript.length === 0) {
    return { transcript, match: null, reason: 'Nagranie jest puste — nic nie usłyszałem.' };
  }

  const [exercises, recent] = await Promise.all([
    voiceExercises(db, input.userId),
    voiceRecentSets(db, input.userId),
  ]);

  if (exercises.length === 0) {
    // Nowe konto: nie ma z czego wybierać, więc pytanie do modelu byłoby
    // wywołaniem, którego jedyną możliwą odpowiedzią jest „nie wiem".
    return {
      transcript,
      match: null,
      reason: 'Nie masz jeszcze żadnych ćwiczeń — zapisz pierwszą serię z listy.',
    };
  }

  const verdict = await interpreter.interpret({ transcript, exercises, recent });

  return {
    transcript,
    match: applyVoiceVerdict(exercises, verdict),
    reason: verdict.reason,
  };
}
