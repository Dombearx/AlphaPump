/**
 * Dyktowanie serii — przepływ od nagrania albo opisu do wypełnionego formularza.
 *
 * Kroki są w osobnych plikach, tutaj złożone w jedno: transkrypcja
 * (`speech.ts`), kontekst z bazy (`context.ts`), interpretacja przez model
 * (`interpreter.ts`). Reguły nakładania werdyktu na listę ćwiczeń stoją
 * w rdzeniu (`@alphapump/core`), bo czyta je także telefon.
 *
 * Wejścia są **dwa i różnią się tylko pierwszym krokiem**: nagranie trzeba
 * najpierw zamienić na tekst, a opis wpisany z klawiatury już tekstem jest.
 * Dalej idą tą samą drogą — i to jest powód, dla którego drugie wejście kosztuje
 * kilkanaście linijek, a nie drugi przepływ.
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

import {
  VOICE_EXERCISE_LIMIT,
  applyVoiceVerdict,
  carryOverLastSet,
  isRepsOnlyVerdict,
  type IsoDate,
  type VoiceSetResponse,
} from '@alphapump/core';
import type { Database } from '../db.js';
import { logger } from '../logger.js';
import { voiceExercises, voiceRecentSets } from './context.js';
import type { VoiceInterpreter } from './interpreter.js';
import type { Transcriber, VoiceRecording } from './transcriber.js';

/**
 * Warstwy dyktowania widziane jako zależności — dokładnie ta sama konwencja co
 * przy `DuplicateLayers`. Testy podstawiają tu funkcje bez sieci i bez klucza.
 *
 * Pola są dwa, bo dyktowanie ma **dwa wejścia i jeden mózg**. Model
 * interpretujący tekst jest warunkiem koniecznym: bez niego nie ma czego zrobić
 * ani z nagraniem, ani z opisem wpisanym z klawiatury. Transkrypcja jest
 * dodatkiem, który dokłada do tego mikrofon — jej brak zwęża funkcję,
 * a nie wyłącza.
 */
export interface VoiceLayers {
  transcriber: Transcriber | null;
  interpreter: VoiceInterpreter | null;
}

export const NO_VOICE: VoiceLayers = { transcriber: null, interpreter: null };

/**
 * Czy da się cokolwiek podyktować — czyli czy jest model interpretujący tekst.
 * To jest warunek istnienia ekranu dyktowania.
 */
export function voiceAvailable(layers: VoiceLayers): boolean {
  return layers.interpreter !== null;
}

/**
 * Czy da się przysłać **nagranie**. Osobno od `voiceAvailable`, bo to osobna
 * odpowiedź: telefon bez transkrypcji chowa mikrofon, ale pole tekstowe zostawia
 * — systemowe dyktowanie z klawiatury nie potrzebuje od nas niczego.
 */
export function speechAvailable(layers: VoiceLayers): boolean {
  return voiceAvailable(layers) && layers.transcriber !== null;
}

export interface DictateSetInput {
  userId: string;
  recording: VoiceRecording;
}

export interface DescribeSetInput {
  userId: string;
  /** Opis serii wpisany z klawiatury — albo podyktowany jej własnym mikrofonem. */
  text: string;
  /**
   * Dzień treningu **z urządzenia**, jeśli je zna. Po nim poznajemy, czy sama
   * liczba powtórzeń ma co uzupełnić: bez niego nie da się odróżnić serii
   * dopowiedzianej do trwającego treningu od pierwszej serii nowego dnia,
   * więc uzupełnianie po prostu nie wchodzi.
   */
  day?: IsoDate;
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
  const { transcriber } = layers;
  if (transcriber === null) throw new Error('Nagrywanie jest wyłączone');

  const transcript = await transcriber.transcribe(input.recording);
  if (transcript.length === 0) {
    return { transcript, match: null, reason: 'Nagranie jest puste — nic nie usłyszałem.' };
  }

  return interpretTranscript(db, layers, input.userId, transcript, undefined);
}

/**
 * Jeden opis z klawiatury w jedną odpowiedź — ta sama droga bez pierwszego kroku.
 *
 * Wejście istnieje, bo transkrypcja jest **naszym** kosztem i naszą awarią,
 * a telefon ma własną: klawiatura Androida ma mikrofon, z którego ludzie i tak
 * korzystają. „Napisz albo podyktuj klawiaturą" omija więc dostawcę
 * transkrypcji w całości — i działa też tam, gdzie mikrofonu użyć nie wypada
 * albo jest zbyt głośno, żeby cokolwiek z niego wyszło.
 */
export async function describeSet(
  db: Database,
  layers: VoiceLayers,
  input: DescribeSetInput,
): Promise<VoiceSetResponse> {
  const text = input.text.trim();
  if (text.length === 0) {
    return { transcript: text, match: null, reason: 'Pusty opis — nie ma czego rozpoznać.' };
  }

  return interpretTranscript(db, layers, input.userId, text, input.day);
}

/**
 * Wspólny środek obu wejść: kontekst z bazy, jedno pytanie do modelu, werdykt
 * nałożony na listę ćwiczeń w rdzeniu. Tekst jest tekstem — to, czy przyszedł
 * z mikrofonu, czy z klawiatury, przestaje mieć tu znaczenie.
 */
async function interpretTranscript(
  db: Database,
  layers: VoiceLayers,
  userId: string,
  transcript: string,
  day: IsoDate | undefined,
): Promise<VoiceSetResponse> {
  const { interpreter } = layers;
  if (interpreter === null) throw new Error('Dyktowanie jest wyłączone');

  const [exercises, recent] = await Promise.all([
    // Transkrypcja wchodzi do zapytania: to ona wciąga na listę ćwiczenie
    // z biblioteki, którego użytkownik jeszcze nie robił (patrz `context.ts`).
    voiceExercises(db, userId, transcript),
    voiceRecentSets(db, userId),
  ]);

  if (exercises.length === 0) {
    // Pusta biblioteka: nie ma z czego wybierać, więc pytanie do modelu byłoby
    // wywołaniem, którego jedyną możliwą odpowiedzią jest „nie wiem". Po seedzie
    // jest to stan nieosiągalny — zostaje jako bezpiecznik, a nie jako ścieżka,
    // którą ktokolwiek chodzi.
    return {
      transcript,
      match: null,
      reason: 'Biblioteka ćwiczeń jest pusta — nie ma czego dopasować.',
    };
  }

  const verdict = await interpreter.interpret({ transcript, exercises, recent });

  // „Osiem" powiedziane między seriami znaczy „to samo ćwiczenie i ten sam
  // ciężar, co przed chwilą" — a to stoi w bazie, więc dopisujemy je sami.
  const filled =
    isRepsOnlyVerdict(verdict) && day !== undefined
      ? carryOverLastSet(exercises, recent, verdict, day)
      : verdict;

  if (filled === null) {
    return {
      transcript,
      match: null,
      reason:
        'Sama liczba powtórzeń, a nie ma z czego uzupełnić ćwiczenia i ciężaru — ' +
        'w tym treningu nie ma jeszcze żadnej serii.',
    };
  }

  const match = applyVoiceVerdict(exercises, filled);

  // Nietrafione dyktowanie jest jedynym śladem, jaki po tej funkcji zostaje:
  // serwer niczego nie zapisuje, a użytkownik zwykle wybiera ćwiczenie z listy
  // i idzie dalej, więc bez tego wpisu wiedzielibyśmy o problemie dopiero ze
  // zgłoszenia zwrotnego — czyli wtedy, gdy komuś się chciało je napisać.
  // Transkrypcja jedzie do logu w całości: bez niej „model nie dopasował" jest
  // zdaniem, z którym nie da się nic zrobić.
  if (match === null) {
    logger.warn('dyktowanie bez dopasowania', {
      userId,
      transcript,
      candidates: exercises.length,
      // Lista przycięta do limitu znaczy, że biblioteka nie zmieściła się
      // w kontekście — i że dopasowanie mogło polec właśnie na obcięciu.
      truncated: exercises.length >= VOICE_EXERCISE_LIMIT,
    });
  }

  return {
    transcript,
    match,
    reason: filled.reason,
  };
}
