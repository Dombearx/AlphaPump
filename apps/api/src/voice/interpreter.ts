/**
 * Wyciąganie serii z transkrypcji — model generatywny na OpenRouterze.
 *
 * Wejściem jest tekst nagrania, lista ćwiczeń do wyboru i ostatnie serie użytkownika.
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
 *
 * Nie znaczy to jednak „nie wskazuj przy najmniejszej wątpliwości", a dokładnie
 * tak model tę regułę czytał: nazwa przekręcona przez rozpoznawanie mowy
 * o jeden znak (a stamtąd przychodzi **każde** zdanie — z zegarka i z klawiatury
 * telefonu) kończyła się odpowiedzią „nie wiem", chociaż ćwiczenie stało na
 * liście i żaden człowiek nie miałby wątpliwości, o które chodzi. Dlatego prompt
 * rozdziela dwie rzeczy, które wcześniej były jedną: **przekręconą nazwę**,
 * przy której trzeba wskazać pozycję, i **nazwę niejednoznaczną**, przy której
 * `null` dalej jest jedyną uczciwą odpowiedzią.
 *
 * ## Dlaczego model przepisuje usłyszaną nazwę osobnym polem
 *
 * Bo to jest jedyny sposób, żeby serwer odróżnił „nie rozpoznałem nazwy"
 * od „nazwy w ogóle nie było". Pierwsze idzie do dopasowania po podobieństwie
 * (`matchSpokenExercise`), drugie — do uzupełnienia z poprzedniej serii
 * (`carryOverLastSet`). Bez tego pola oba wyglądały tak samo i oba kończyły się
 * pytaniem do użytkownika.
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
  'Dostajesz transkrypcję jednego nagrania, ponumerowaną listę ćwiczeń do wyboru',
  'i ostatnio zapisane serie użytkownika.',
  'Lista jest biblioteką aplikacji, a nie samymi ćwiczeniami tego użytkownika:',
  'na jej początku stoją te, które faktycznie wykonuje, więc przy dwóch tak samo',
  'pasujących nazwach wybierasz tę z niższym numerem.',
  'Wskazujesz **numer** ćwiczenia z listy i wyciągasz liczby: ciężar w kilogramach,',
  'powtórzenia, czas w sekundach, dystans w metrach.',
  'Nowych ćwiczeń nie wymyślasz — wolno wskazać wyłącznie pozycję z listy.',
  'Transkrypcja pochodzi z rozpoznawania mowy na zegarku albo na klawiaturze',
  'telefonu, więc nazwy bywają przekręcone, odmienione, skrócone albo zapisane',
  'fonetycznie („bensz pres", „przysiat", „martwy ciong", „lat pull down").',
  'Nazwę, która brzmi albo wygląda jak jedna pozycja z listy, wskazujesz —',
  'literówka, końcówka fleksyjna, skrót i potoczna nazwa to ta sama nazwa.',
  'Wskazujesz też wtedy, gdy nazwa z nagrania jest krótsza od pełnej nazwy',
  'z listy, a pasuje tylko do niej („wyciskanie sztangi" przy jednym wyciskaniu',
  'sztangi na liście).',
  '`null` zostawiasz dla dwóch sytuacji: nagranie pasuje **równie dobrze** do',
  'kilku pozycji (wtedy pytanie do użytkownika jest jedyną uczciwą odpowiedzią)',
  'albo nie przypomina żadnej. Pomyłka w ćwiczeniu kosztuje więcej niż pytanie,',
  'ale „nie wiem" przy jednej oczywistej kandydatce kosztuje zaufanie do całej funkcji.',
  'W `exerciseName` przepisujesz nazwę ćwiczenia **tak, jak padła w nagraniu** —',
  'zawsze, także wtedy, gdy nie wskazałeś numeru; `null` wpisujesz tam wyłącznie',
  'wtedy, gdy w nagraniu nie padła żadna nazwa ćwiczenia („jeszcze osiem",',
  '„osiemdziesiąt na dziesięć"). Aplikacja dopisze wtedy ćwiczenie z poprzedniej',
  'serii sama — nie rób tego za nią i nie zgaduj numeru.',
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
    'Ćwiczenia do wyboru (numer, nazwa, nazwy obce, typ logowania):',
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
