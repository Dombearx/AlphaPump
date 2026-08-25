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

import type { VoiceSetMatch } from '@alphapump/core';

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
