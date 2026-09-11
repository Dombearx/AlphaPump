/**
 * Kolejność listy na ekranie wyboru ćwiczenia — reguły i rejestr na dysku.
 *
 * Do wyboru są dwie i obie są sensowne, dla dwóch różnych sposobów trenowania:
 *
 * | Kolejność   | Co jest na górze                                   | Dla kogo |
 * | ----------- | -------------------------------------------------- | -------- |
 * | `rotation`  | co domyka cykl i odciąża partie z ostatniej serii   | kto trenuje pod cykl i robi dwa ćwiczenia na zmianę |
 * | `usage`     | co użytkownik wykonuje najczęściej                  | kto ma stały plan i szuka ćwiczenia z nazwy |
 *
 * Wartością domyślną jest `rotation`, bo to ona odpowiada na pytanie, z którym
 * wchodzi się na ten ekran — „co teraz wykonać" — a kolejność po liczbie serii
 * zostaje pod nią jako rozstrzyganie remisów, więc nikt nie traci swojej listy,
 * tylko dostaje nad nią kilka pozycji z cyklu. Algorytm opisuje `rotation.ts`
 * w `@alphapump/core`.
 *
 * ## Dlaczego per urządzenie, a nie per konto
 *
 * Ten sam powód co przy języku (`language/state.ts`) i przy dyktowaniu: zapis
 * per konto to kolumna w tabeli użytkowników, czyli migracja w dwóch dialektach
 * i pole w protokole synchronizacji — dla ustawienia, które dotyczy jednego
 * ekranu na jednym telefonie.
 *
 * Ten plik jest czysty — nie dotyka Expo ani dysku. Warstwa natywna siedzi
 * w `expo.ts`, a stan ekranu w `use-exercise-order.ts`.
 */

/** Po czym układa się lista biblioteki przy dodawaniu serii. */
export const EXERCISE_ORDERS = ['rotation', 'usage'] as const;

export type ExerciseOrder = (typeof EXERCISE_ORDERS)[number];

export const DEFAULT_EXERCISE_ORDER: ExerciseOrder = 'rotation';

export function isExerciseOrder(value: unknown): value is ExerciseOrder {
  return typeof value === 'string' && (EXERCISE_ORDERS as readonly string[]).includes(value);
}

/**
 * Rejestr nieczytelny albo z kolejnością, której nie znamy, znaczy **kolejność
 * domyślną**, a nie błąd — tak samo jak przy języku. Najgorsze, co się stanie,
 * to że użytkownik przestawi przełącznik jeszcze raz; ekran z komunikatem
 * o błędzie odczytu ustawień byłby gorszy od każdej z dwóch kolejności.
 */
export function parseExerciseOrder(raw: string): ExerciseOrder {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_EXERCISE_ORDER;
  }

  const value = (parsed as { order?: unknown } | null)?.order;
  return isExerciseOrder(value) ? value : DEFAULT_EXERCISE_ORDER;
}

export function serializeExerciseOrder(order: ExerciseOrder): string {
  return JSON.stringify({ order });
}

/**
 * Wejście do warstwy natywnej widziane przez interfejs — jak `DictationStore`.
 * Ekran wyboru ćwiczenia i karta ustawień dostają implementację z zewnątrz,
 * a testy podstawiają atrapę.
 */
export interface ExerciseOrderStore {
  read: () => Promise<ExerciseOrder>;
  write: (order: ExerciseOrder) => Promise<void>;
}
