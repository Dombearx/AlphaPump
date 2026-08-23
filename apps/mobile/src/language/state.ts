/**
 * Wybrany język aplikacji — reguły i rejestr na dysku.
 *
 * ## Dlaczego per urządzenie, a nie per konto
 *
 * Zgłoszenie tego nie ustaliło, więc rozstrzygamy tak, jak proponował opis
 * poprzedniego kroku: **per urządzenie**. Powody są dwa i oba są praktyczne.
 * Po pierwsze wybór działa wtedy także przed zalogowaniem — ekran logowania
 * jest pierwszym, który ktoś widzi, i nie ma jak wcześniej wiedzieć, czyj jest
 * telefon. Po drugie zapis per konto to kolumna w tabeli użytkowników, czyli
 * migracja w dwóch dialektach i pole w protokole synchronizacji — dla ustawienia,
 * które i tak dotyczy tego jednego ekranu, na którym się patrzy.
 *
 * Cena jest widoczna i akceptujemy ją świadomie: kto ma dwa urządzenia, wybiera
 * język na obu.
 *
 * ## Dlaczego plik, a nie tabela w bazie lokalnej
 *
 * Bo baza lokalna jest repliką danych, które jadą na serwer, a to ustawienie
 * nigdzie nie jedzie. Ten sam wzorzec co przy tapecie (`background/state.ts`):
 * mały rejestr JSON w katalogu dokumentów, czytany raz przy starcie.
 *
 * Ten plik jest czysty — nie dotyka Expo ani dysku. Warstwa natywna siedzi
 * w `expo.ts`, a stan aplikacji w `provider.tsx`.
 */

import { DEFAULT_LANGUAGE, isLanguage, type Language } from '@alphapump/core';

/**
 * Rejestr nieczytelny albo z językiem, którego już nie obsługujemy, znaczy
 * **język domyślny**, a nie błąd. Najgorsze, co się stanie, to że użytkownik
 * wybierze język jeszcze raz — a alternatywa (ekran z komunikatem o błędzie
 * odczytu ustawień) jest gorsza od każdego z tych dwóch języków.
 */
export function parseLanguage(raw: string): Language {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_LANGUAGE;
  }

  const value = (parsed as { language?: unknown } | null)?.language;
  return isLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function serializeLanguage(language: Language): string {
  return JSON.stringify({ language });
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs.
 *
 * Korzeń aplikacji wstrzykuje implementację z `expo.ts`, a testy — atrapę.
 * Dzięki temu `provider.tsx` nie importuje niczego z Expo i daje się
 * wyrenderować poza telefonem, razem z ekranem ustawień, który na nim stoi.
 */
export interface LanguageStore {
  /** Zapisany wybór albo język domyślny, gdy nikt jeszcze nie wybierał. */
  read: () => Promise<Language>;
  write: (language: Language) => Promise<void>;
}
