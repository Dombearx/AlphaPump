/**
 * Dyktowanie serii głosem — reguły, które muszą być te same po obu stronach.
 *
 * Przepływ ma trzy kroki i tylko środkowy jest „sztuczną inteligencją":
 *
 * 1. telefon nagrywa kilka sekund dźwięku i wysyła je na serwer,
 * 2. serwer zamienia nagranie na tekst, a tekst — razem z listą ćwiczeń
 *    użytkownika i jego ostatnimi seriami — podaje modelowi,
 * 3. model wskazuje **pozycję z listy** i wyciąga liczby, a wynik wraca na
 *    telefon jako wypełniony formularz do zatwierdzenia.
 *
 * Ten moduł opisuje krok trzeci: kształt odpowiedzi modelu, kształt odpowiedzi
 * API i czystą funkcję, która jedno zamienia w drugie. Jest w rdzeniu z tego
 * samego powodu co wykrywanie duplikatów: czyta go i serwer, i telefon, więc
 * rozjazd między „co API zwraca" a „co aplikacja umie przeczytać" jest
 * niemożliwy z definicji.
 *
 * ## Dlaczego model odpowiada indeksem, a nie identyfikatorem
 *
 * Ten sam powód co przy re-rankerze duplikatów: UUID przepisany przez model
 * z jednym przekręconym znakiem trafiałby w nieistniejący wiersz albo — gorzej —
 * w cudze ćwiczenie. Indeks z krótkiej listy jest odporny na tę klasę pomyłek,
 * a indeks spoza zakresu odrzuca `applyVoiceVerdict`.
 *
 * ## Dlaczego model nie zakłada nowych ćwiczeń
 *
 * Bo nie ma jak zapytać o resztę: ćwiczenie to nie sama nazwa, tylko także typ
 * logowania i tag główny, a jedno i drugie rozstrzyga o rekordach i o cyklach.
 * Ćwiczenie, którego nie ma na liście, kończy się więc odpowiedzią „nie wiem,
 * o które chodzi" i normalnym wyborem z biblioteki — czyli tym samym, co dziś,
 * bez straty.
 *
 * ## Dlaczego pomiary spoza typu logowania są wycinane
 *
 * Bo model powie „dwadzieścia powtórzeń deski" i będzie w tym więcej prawdy niż
 * błędu — a deska jest ćwiczeniem na czas i powtórzeń nie ma gdzie zapisać.
 * Wartość spoza osi typu logowania przeszłaby przez bazę i wyszła dopiero przy
 * liczeniu rekordów, jako oś, której to ćwiczenie nie ma. Reguła jest ta sama,
 * którą stosuje formularz na telefonie (`readDraft`), i dlatego stoi w rdzeniu.
 */

import { z } from 'zod';
import {
  hasCompleteMeasurements,
  requiredMeasurements,
  usesBodyweight,
  type LoggingType,
  type MeasurementKey,
  type SetMeasurements,
} from './logging-type.js';
import { displayNameSchema, loggingTypeSchema, noteSchema, uuidSchema } from './schemas.js';
import { kilogramsToGrams } from './units.js';

/**
 * Ile ćwiczeń trafia na listę podawaną modelowi.
 *
 * Lista jest kontekstem jednego wywołania, więc płaci się za nią przy każdym
 * dyktowaniu. Sto pozycji to więcej, niż ktokolwiek ma w rotacji, a przy
 * kolejności „najczęściej wykonywane najpierw" ćwiczenie, które nie zmieściło
 * się w setce, jest tym, którego użytkownik nie robił od miesięcy.
 */
export const VOICE_EXERCISE_LIMIT = 100;

/**
 * Ile ostatnich serii jedzie do modelu jako kontekst.
 *
 * Nie po to, żeby model je przepisał, tylko żeby miał czym uzupełnić zdanie
 * niepełne: „jeszcze osiem" znaczy „ten sam ciężar co poprzednio, osiem
 * powtórzeń". Dwadzieścia serii to z grubsza jeden trening.
 */
export const VOICE_RECENT_SET_LIMIT = 20;

/** Ćwiczenie na liście podawanej modelowi. */
export interface VoiceExercise {
  exerciseId: string;
  /** Nazwa kanoniczna — ta, którą użytkownik widzi w bibliotece. */
  name: string;
  loggingType: LoggingType;
  /**
   * Nazwy w pozostałych językach. Dyktuje się w tym języku, w którym się myśli,
   * a nazwa kanoniczna bywa w innym — bez aliasów „martwy ciąg" nie trafiałby
   * w „Deadlift".
   */
  aliases: readonly string[];
}

/** Ostatnio zapisana seria — kontekst dla zdań niepełnych. */
export interface VoiceRecentSet {
  exerciseName: string;
  performedOn: string;
  measurements: SetMeasurements;
}

/**
 * Werdykt modelu: jedna seria wyjęta z jednego nagrania.
 *
 * Wszystkie pola są **wymagane i dopuszczają `null`**, zamiast być opcjonalne.
 * To nie jest kosmetyka schematu: przy structured output dostawcy potrafią
 * wymagać kompletu kluczy, a `null` niesie tu informację, której brak klucza nie
 * niesie — „w nagraniu tego nie było". Rozróżnienie „nie powiedziano"
 * od „nie zrozumiałem" nie jest nam potrzebne, ale „nie powiedziano"
 * od „zero" — już tak.
 */
export const voiceSetVerdictSchema = z.object({
  /** Pozycja z listy ćwiczeń albo `null`, gdy żadna nie pasuje. */
  exerciseIndex: z.int().min(0).nullable(),
  /** Ciężar w **kilogramach** — tak, jak się o nim mówi; ułamki dozwolone. */
  weightKg: z.number().min(0).nullable(),
  reps: z.int().min(1).nullable(),
  /** Czas w sekundach — „półtorej minuty" ma dojechać jako 90, nie jako 1,5. */
  durationS: z.int().min(1).nullable(),
  distanceM: z.int().min(1).nullable(),
  /** Masa ciała, gdy padła w nagraniu; przy pozostałych typach jest wycinana. */
  bodyweightKg: z.number().min(0).nullable(),
  /** Co w nagraniu nie było ani ćwiczeniem, ani liczbą („bolało kolano"). */
  note: z.string().max(300).nullable(),
  /** Jedno zdanie dla użytkownika: co model zrozumiał albo dlaczego nie umiał. */
  reason: z.string().min(1).max(300),
});

export type VoiceSetVerdict = z.infer<typeof voiceSetVerdictSchema>;

/**
 * Rozpoznana seria — dokładnie tyle, ile potrzebuje formularz na telefonie.
 *
 * Liczby są już w jednostkach bazy (gramy, sekundy, metry), bo przeliczenie
 * z kilogramów jest regułą, a nie szczegółem prezentacji — i ma się wydarzyć raz,
 * po stronie, która zna typ logowania.
 */
export const voiceSetMatchSchema = z.object({
  exerciseId: uuidSchema,
  name: displayNameSchema,
  loggingType: loggingTypeSchema,
  weightG: z.int().min(0).nullable(),
  reps: z.int().min(1).nullable(),
  durationS: z.int().min(1).nullable(),
  distanceM: z.int().min(1).nullable(),
  bodyweightG: z.int().min(0).nullable(),
  note: noteSchema.nullable(),
  /**
   * Czy komplet pól wymaganych przez typ logowania jest wypełniony. `false` nie
   * jest błędem — formularz otworzy się z tym, co zrozumiał model, i poczeka na
   * resztę. Bez tego pola aplikacja musiałaby powtórzyć regułę kompletności,
   * czyli mieć drugą jej kopię.
   */
  complete: z.boolean(),
});

export type VoiceSetMatch = z.infer<typeof voiceSetMatchSchema>;

/**
 * Odpowiedź na jedno nagranie.
 *
 * `transcript` wraca zawsze, także przy braku dopasowania — bo to jedyna rzecz,
 * po której użytkownik pozna, czy nie zrozumiał go mikrofon, czy model. Bez
 * transkrypcji „nie wiem, o które ćwiczenie chodzi" jest nie do zdiagnozowania
 * ani przez niego, ani przez nas ze zgłoszenia.
 */
export const voiceSetResponseSchema = z.object({
  transcript: z.string(),
  match: voiceSetMatchSchema.nullable(),
  /** Zdanie od modelu — pokazywane wprost, zwłaszcza gdy `match` jest `null`. */
  reason: z.string().nullable(),
});

export type VoiceSetResponse = z.infer<typeof voiceSetResponseSchema>;

/** Pomiar wycięty do osi typu logowania; reszta zostaje `null`. */
function measurementsFor(
  loggingType: LoggingType,
  spoken: Readonly<Record<MeasurementKey, number | null>>,
): SetMeasurements {
  const wanted = new Set<MeasurementKey>(requiredMeasurements(loggingType));

  return {
    weightG: wanted.has('weightG') ? spoken.weightG : null,
    reps: wanted.has('reps') ? spoken.reps : null,
    durationS: wanted.has('durationS') ? spoken.durationS : null,
    distanceM: wanted.has('distanceM') ? spoken.distanceM : null,
  };
}

/**
 * Nakłada werdykt modelu na listę ćwiczeń podanych mu jako kontekst.
 *
 * Funkcja jest czysta i **odporna na model**: odpowiedź LLM-a jest danymi
 * z zewnątrz także po walidacji schematu. Indeks spoza listy znaczy „nie
 * dopasował", a nie „weź pierwsze z brzegu"; pomiar spoza osi typu logowania
 * jest wycinany, a nie zapisywany na siłę.
 *
 * `null` na wyjściu znaczy dokładnie jedno: **nie wiadomo, o które ćwiczenie
 * chodzi**. Seria niekompletna to co innego — wraca jako dopasowanie
 * z `complete: false` i domyka ją człowiek w formularzu.
 */
export function applyVoiceVerdict(
  exercises: readonly VoiceExercise[],
  verdict: VoiceSetVerdict,
): VoiceSetMatch | null {
  const index = verdict.exerciseIndex;
  if (index === null || index < 0 || index >= exercises.length) return null;

  const exercise = exercises[index];
  if (exercise === undefined) return null;

  const measurements = measurementsFor(exercise.loggingType, {
    weightG: verdict.weightKg === null ? null : kilogramsToGrams(verdict.weightKg),
    reps: verdict.reps,
    durationS: verdict.durationS,
    distanceM: verdict.distanceM,
  });

  const note = verdict.note?.trim() ?? '';

  return {
    exerciseId: exercise.exerciseId,
    name: exercise.name,
    loggingType: exercise.loggingType,
    ...measurements,
    // Masa ciała jedzie wyłącznie tam, gdzie w ogóle ma sens — i nigdy nie
    // decyduje o kompletności serii, bo nie bierze udziału w rekordach.
    bodyweightG:
      verdict.bodyweightKg === null || !usesBodyweight(exercise.loggingType)
        ? null
        : kilogramsToGrams(verdict.bodyweightKg),
    note: note.length === 0 ? null : note,
    complete: hasCompleteMeasurements(exercise.loggingType, measurements),
  };
}
