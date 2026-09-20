/**
 * Podyktowana seria w drodze z ekranu dyktowania do formularza.
 *
 * Rozpoznane wartości jadą **adresem**, a nie stanem trzymanym obok nawigacji —
 * dokładnie tak jak dzień i ćwiczenie w `/day/[date]/log/[exerciseId]`. Powód
 * jest ten sam: ekran otwarty z takiego adresu przeżywa cofnięcie, ponowne
 * wejście i przywrócenie aplikacji przez system, a stan przekazany bokiem
 * ginie przy pierwszym z tych trzech.
 *
 * Wszystko tutaj jest czyste — napisy w jedną stronę, liczby w drugą — więc
 * reguły dają się przetestować bez renderowania czegokolwiek i bez mikrofonu.
 * A jest czego pilnować: parametr adresu jest napisem, który potrafi przyjść
 * z ręcznie wpisanego linku, z odtworzonej sesji nawigacji albo z wydania
 * sprzed zmiany — i żadna z tych rzeczy nie ma prawa wstawić do formularza
 * ciężaru „NaN".
 */

import { usesBodyweight, type VoiceSetMatch } from '@alphapump/core';
import type { SetValues } from './db/sets';
import type { DictationMode } from './dictation/state';

/** Wartości serii wyjęte z nagrania; `null` znaczy „w nagraniu tego nie było". */
export interface DictatedSet {
  weightG: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  bodyweightG: number | null;
  note: string | null;
}

const MEASUREMENT_KEYS = ['weightG', 'reps', 'durationS', 'distanceM', 'bodyweightG'] as const;

/**
 * Parametry adresu formularza. Pola puste są **pomijane**, a nie wysyłane jako
 * „null": adres ma nieść to, co model zrozumiał, a resztę zostawić formularzowi,
 * który i tak podpowie wartość z poprzedniej serii.
 */
export function dictationParams(match: VoiceSetMatch): Record<string, string> {
  const params: Record<string, string> = {};

  for (const key of MEASUREMENT_KEYS) {
    const value = match[key];
    if (value !== null) params[key] = String(value);
  }
  if (match.note !== null && match.note.length > 0) params.note = match.note;

  return params;
}

/** Jedna liczba całkowita z parametru adresu; wszystko inne jest `null`. */
function readInteger(value: unknown): number | null {
  const text = Array.isArray(value) ? value[0] : value;
  if (typeof text !== 'string' || text.trim().length === 0) return null;

  const parsed = Number(text);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

/**
 * Podyktowana seria odczytana z parametrów adresu.
 *
 * `null` znaczy „ten adres nie niesie dyktowania" — czyli zwykłe wejście
 * w formularz, w którym ma zadziałać podpowiedź z poprzedniej serii. Sama
 * notatka bez żadnej liczby też jest dyktowaniem: model bywa pewien tego, co
 * usłyszał obok liczb, i nie ma powodu tego gubić.
 */
export function readDictationParams(
  params: Record<string, string | string[] | undefined>,
): DictatedSet | null {
  const values: DictatedSet = {
    weightG: readInteger(params.weightG),
    reps: readInteger(params.reps),
    durationS: readInteger(params.durationS),
    distanceM: readInteger(params.distanceM),
    bodyweightG: readInteger(params.bodyweightG),
    note: typeof params.note === 'string' && params.note.length > 0 ? params.note : null,
  };

  const empty = Object.values(values).every((value) => value === null);
  return empty ? null : values;
}

/** Gdzie kończy się dyktowanie. */
export type DictationOutcome =
  /** Zapisujemy serię od razu, w bazie lokalnej — użytkownik o to poprosił. */
  | 'save'
  /** Wartości wchodzą do formularza serii i czekają na zatwierdzenie. */
  | 'form'
  /** Nie ma czego zrobić: model nie wskazał ćwiczenia. */
  | 'ask';

/**
 * Co zrobić z odpowiedzią serwera.
 *
 * Reguła jest tutaj, a nie w ekranie, bo składa się z trzech warunków, które
 * łatwo pomylić przy czytaniu JSX-a — a pomyłka w jedną stronę zapisuje serię,
 * o którą nikt nie prosił.
 *
 * Kompletność **wygrywa z ustawieniem**: serii bez wszystkich pól wymaganych
 * przez typ logowania nie da się zapisać, więc niezależnie od przełącznika
 * trafia do formularza. To ta sama reguła co przy zapisie z palca, a nie wyjątek
 * od niej.
 */
export function dictationOutcome(
  mode: DictationMode,
  match: VoiceSetMatch | null,
): DictationOutcome {
  if (match === null) return 'ask';
  return mode === 'save' && match.complete ? 'save' : 'form';
}

/**
 * Wartości serii zapisywanej wprost z dyktowania, czyli w trybie „zapisz od
 * razu" — ten jeden tryb omija formularz, więc masa ciała z ustawień musi wejść
 * tutaj. Inaczej ta sama seria miałaby masę przy zapisie z palca, a nie miałaby
 * jej przy dyktowaniu, i to bez żadnego powodu widocznego dla użytkownika.
 *
 * Reguła jest ta sama co w `suggestedDraft`, z jednym odwróceniem: masa
 * **powiedziana** wygrywa z ustawieniem, bo dotyczy tej jednej serii. Ustawienie
 * uzupełnia wyłącznie to, czego w nagraniu nie było — i tylko tam, gdzie
 * ćwiczenie w ogóle o masę ciała pyta (`usesBodyweight`), żeby nie wpisać jej
 * do wyciskania sztangi.
 */
export function dictatedSetValues(match: VoiceSetMatch, bodyweightG: number | null): SetValues {
  return {
    weightG: match.weightG,
    reps: match.reps,
    durationS: match.durationS,
    distanceM: match.distanceM,
    bodyweightG: usesBodyweight(match.loggingType) ? (match.bodyweightG ?? bodyweightG) : null,
    note: match.note,
  };
}
