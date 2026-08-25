/**
 * Wyciąganie serii z transkrypcji — model generatywny na OpenRouterze.
 *
 * Wejściem jest tekst nagrania, lista ćwiczeń użytkownika i jego ostatnie serie.
 * Wyjściem — jedna pozycja z tej listy (po **indeksie**, nie po nazwie) i liczby.
 * Ten sam dostawca i ten sam klucz co embeddingi, re-ranker i tłumaczenie, z tego
 * samego powodu, dla którego tamte trzy nie rozjeżdżają się na kilku dostawców.
 *
 * ## Dlaczego ostatnie serie są w kontekście
 *
 * Bo na siłowni nie mówi się pełnymi zdaniami. „Jeszcze osiem" znaczy „to samo
 * ćwiczenie, ten sam ciężar, osiem powtórzeń", a „setka na dziesięć" znaczy sto
 * kilogramów tylko wtedy, gdy poprzednie serie były w tej okolicy — przy
 * ćwiczeniu, w którym użytkownik chodzi po dwudziestu kilogramach, to samo zdanie
 * znaczy coś innego. Bez historii model musiałby zgadywać dokładnie tam, gdzie
 * pomyłka jest najbardziej kosztowna: w zapisanej liczbie.
 *
 * ## Dlaczego model nie dostaje pozwolenia na „prawie pasuje"
 *
 * Bo cena pomyłki jest niesymetryczna. „Nie wiem, o które ćwiczenie chodzi"
 * kosztuje jedno naciśnięcie — użytkownik wybiera z listy tak jak dotąd.
 * Seria dopisana do nie tego ćwiczenia kosztuje rekord, wykres i pozycję
 * w rankingu, a zauważa się ją tygodnie później.
 */

import { voiceSetVerdictSchema, type VoiceExercise, type VoiceRecentSet } from '@alphapump/core';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { generateObject } from 'ai';
import type { LlmConfig, VoiceConfig } from '../config.js';
import { formatRecentSet } from './context.js';

/** Model dostaje transkrypcję i kontekst, oddaje werdykt. */
export interface VoiceInterpreter {
  model: string;
  interpret(request: VoiceInterpretation): Promise<VoiceVerdict>;
}

export interface VoiceInterpretation {
  transcript: string;
  exercises: readonly VoiceExercise[];
  recent: readonly VoiceRecentSet[];
}

export type VoiceVerdict = ReturnType<typeof voiceSetVerdictSchema.parse>;

const SYSTEM_PROMPT = [
  'Zapisujesz serie treningowe dyktowane głosem w aplikacji na siłownię.',
  'Dostajesz transkrypcję jednego nagrania, ponumerowaną listę ćwiczeń użytkownika',
  'i jego ostatnio zapisane serie.',
  'Wskazujesz **numer** ćwiczenia z listy i wyciągasz liczby: ciężar w kilogramach,',
  'powtórzenia, czas w sekundach, dystans w metrach.',
  'Nowych ćwiczeń nie wymyślasz — wolno wskazać wyłącznie pozycję z listy.',
  'Kiedy żadna nie pasuje albo nagranie jest niejednoznaczne, podajesz `null`',
  'zamiast zgadywać: pomyłka w ćwiczeniu kosztuje więcej niż pytanie do użytkownika.',
  'Czego w nagraniu nie było, zostaje `null` — nie uzupełniasz go historią.',
  'Historia służy do zrozumienia zdania niepełnego („jeszcze osiem" to ten sam',
  'ciężar co ostatnio) i do oceny, czy usłyszana liczba jest w skali tego ćwiczenia.',
  'Liczby wypowiedziane słownie przeliczasz („półtorej minuty" to 90 sekund,',
  '„dwie i pół" przy ciężarze to 2.5).',
  'Pole `reason` to jedno zdanie do pokazania użytkownikowi, w języku nagrania.',
].join(' ');

function exerciseList(exercises: readonly VoiceExercise[]): string {
  return exercises
    .map((exercise, index) => {
      const aliases = exercise.aliases.length > 0 ? ` [${exercise.aliases.join(', ')}]` : '';
      return `${String(index)}. ${exercise.name}${aliases} — ${exercise.loggingType}`;
    })
    .join('\n');
}

function userPrompt(request: VoiceInterpretation): string {
  const recent =
    request.recent.length === 0
      ? 'Brak — to pierwsza zapisywana seria.'
      : request.recent.map((set) => formatRecentSet(set)).join('\n');

  return [
    `Nagranie: „${request.transcript}"`,
    '',
    'Ćwiczenia użytkownika (numer, nazwa, nazwy obce, typ logowania):',
    exerciseList(request.exercises),
    '',
    'Ostatnio zapisane serie (od najnowszej):',
    recent,
  ].join('\n');
}

/**
 * Interpreter z konfiguracji albo `null`.
 *
 * `null` wychodzi z tych samych powodów co przy tłumaczu: wyłączona cała
 * warstwa LLM-owa (brak klucza OpenRoutera albo `LLM_ENABLED=false`) i osobno
 * wyłączone dyktowanie. Oba znaczą to samo: telefon nie pokazuje mikrofonu.
 */
export function createOpenRouterInterpreter(
  llm: LlmConfig | null,
  voice: VoiceConfig | null,
): VoiceInterpreter | null {
  if (llm === null || voice === null) return null;

  const openrouter = createOpenRouter({ apiKey: llm.apiKey });

  return {
    model: voice.model,
    async interpret(request) {
      const { object } = await generateObject({
        model: openrouter.chat(voice.model),
        schema: voiceSetVerdictSchema,
        system: SYSTEM_PROMPT,
        prompt: userPrompt(request),
        abortSignal: AbortSignal.timeout(voice.timeoutMs),
      });

      return object;
    },
  };
}
