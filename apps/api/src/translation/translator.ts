/**
 * Tłumaczenie nazw widziane jako zależność.
 *
 * Moduł opisuje **co** tłumaczenie robi, a nie **czym** — implementacja przez
 * OpenRoutera stoi obok, w `openrouter.ts`. Podział jest ten sam co przy
 * warstwach wykrywania duplikatów i z tych samych dwóch powodów:
 *
 * - testy integracyjne muszą sprawdzić, co się dzieje z zapisem, gdy model
 *   odpowie, gdy odpowie bzdurą i gdy nie odpowie w ogóle — a żadnego z tych
 *   przypadków nie da się wywołać, wychodząc naprawdę do sieci,
 * - `null` w miejscu tłumacza jest pełnoprawnym stanem, a nie awarią: tak
 *   wygląda `TRANSLATION_ENABLED=false` i tak wygląda stos bez klucza
 *   OpenRoutera.
 *
 * Obowiązuje tu ta sama reguła co przy duplikatach: **tłumaczenie nie ma prawa
 * wywrócić zapisu**. Zgłoszenie nie ustaliło zachowania przy błędzie modelu,
 * więc rozstrzygamy je tak samo jak przy warstwie 3 wykrywania duplikatów —
 * zapis idzie bez tłumaczenia, a nazwa zostaje kanoniczna. Nazwa, której nikt
 * nie przetłumaczył, wygląda na ekranie dokładnie tak jak przed dodaniem
 * języków; zapis odrzucony z powodu niedostępnego dostawcy modeli nie wygląda
 * jak nic, bo użytkownik zostaje bez swojego ćwiczenia.
 */

import type { Language, Translations } from '@alphapump/core';

/** Encja, dla której prosimy o tłumaczenie — nazwa i to, czym ona jest. */
export interface TranslationRequest {
  /** Nazwa kanoniczna, czyli ta, którą ktoś wpisał. */
  name: string;
  /** Tag albo ćwiczenie — model tłumaczy „klatka" inaczej niż „wyciskanie". */
  kind: 'tag' | 'exercise';
  /**
   * Tag główny ćwiczenia, gdy jest znany. Kontekst rozstrzyga nazwy potoczne:
   * „wznosy" przy tagu „Barki" i przy tagu „Brzuch" to dwa różne ruchy.
   */
  context?: string | null;
  /** Języki, dla których nazwy brakuje. Model dostaje wyłącznie te. */
  missing: readonly Language[];
}

export interface Translator {
  /** Identyfikator modelu — trafia do logu, bo jakość odpowiedzi zależy od niego. */
  readonly model: string;
  /**
   * Nazwy w brakujących językach. Zestaw niepełny jest poprawną odpowiedzią:
   * model, który nie zna jednej z nazw, ma pominąć ją, a nie zmyślić.
   */
  translate(request: TranslationRequest): Promise<Translations>;
}
