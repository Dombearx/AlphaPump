/**
 * Składanie ostrzeżenia o duplikacie z trzech warstw.
 *
 * Warstwa lokalna (pisownia, zawsze dostępna) i warstwy serwerowe (znaczenie
 * i ocena modelu) mówią o tym samym, ale w innym języku i z inną pewnością.
 * Pokazanie ich obok siebie dałoby listę z powtórzeniami, w której użytkownik
 * musiałby sam się domyślać, dlaczego coś na niej jest. Ta funkcja robi z nich
 * **jedną** listę, w której każda pozycja niesie powód swojej obecności.
 *
 * Kolejność wynika z pewności, nie z warstwy:
 *
 * 1. Pozycje, które model uznał wprost za duplikat — niosą uzasadnienie i są
 *    najmocniejszym sygnałem, jaki mamy.
 * 2. Pozycje znalezione lokalnie po pisowni — pewne co do faktu (nazwa jest
 *    podobna), milczące co do znaczenia.
 * 3. Pozostałe trafienia serwera, których model nie ocenił.
 *
 * Pozycje **odrzucone** przez model wypadają, chyba że warstwa lokalna też je
 * znalazła: „to nie to samo ćwiczenie" nie unieważnia faktu, że nazwa jest
 * podobna do złudzenia — a przy identycznym slugu zapis i tak trafi w istniejący
 * wiersz, więc zamilczenie o nim byłoby wprowadzaniem w błąd.
 *
 * Funkcja jest czysta i mieszka poza ekranem, bo to jest ta część, w której da
 * się popełnić błąd niewidoczny na pierwszy rzut oka — a ekranu nie renderujemy
 * w testach.
 */

import type { DuplicateCheckResponse, SimilarityMatch } from '@alphapump/core';

/** Skąd wiemy o tej pozycji. Decyduje o tym, co napisać przy jej nazwie. */
export type HintOrigin =
  /** Podobna pisownia, policzona na telefonie. Działa bez sieci. */
  | 'local'
  /** Podobne znaczenie — wektor z serwera. */
  | 'server'
  /** Model ocenił, że to ten sam ruch, i podał powód. */
  | 'model';

export interface DuplicateHint {
  exerciseId: string;
  name: string;
  origin: HintOrigin;
  /** Uzasadnienie od modelu; `null`, gdy pozycja nie przeszła przez warstwę 3. */
  reason: string | null;
  /** Nick autora — przy cudzym ćwiczeniu zmienia decyzję użytkownika. */
  authorNickname: string | null;
  /**
   * Slug identyczny z wpisywaną nazwą. Dla ćwiczenia tego samego autora znaczy,
   * że zapis trafi w ten wiersz, zamiast utworzyć nowy.
   */
  identical: boolean;
}

/** Ile pozycji pokazujemy. Ostrzeżenie ma być krótkie, żeby dało się je przeczytać. */
export const HINT_LIMIT = 3;

export interface LocalCandidate {
  id: string;
  name: string;
}

export function mergeDuplicateHints(
  local: readonly SimilarityMatch<LocalCandidate>[],
  remote: DuplicateCheckResponse | null,
  limit: number = HINT_LIMIT,
): DuplicateHint[] {
  const localIds = new Set(local.map((match) => match.exercise.id));
  const hints: DuplicateHint[] = [];
  const taken = new Set<string>();

  const push = (hint: DuplicateHint): void => {
    if (taken.has(hint.exerciseId)) return;
    taken.add(hint.exerciseId);
    hints.push(hint);
  };

  for (const candidate of remote?.candidates ?? []) {
    if (candidate.duplicate !== true) continue;
    push({
      exerciseId: candidate.exerciseId,
      name: candidate.name,
      origin: 'model',
      reason: candidate.reason,
      authorNickname: candidate.authorNickname,
      identical: candidate.identical,
    });
  }

  for (const match of local) {
    push({
      exerciseId: match.exercise.id,
      name: match.exercise.name,
      origin: 'local',
      reason: null,
      authorNickname: null,
      identical: match.identical,
    });
  }

  for (const candidate of remote?.candidates ?? []) {
    // Model powiedział „nie" — a warstwa lokalna też tego nie znalazła, więc nie
    // ma powodu tym zawracać głowy.
    if (candidate.duplicate === false && !localIds.has(candidate.exerciseId)) continue;
    push({
      exerciseId: candidate.exerciseId,
      name: candidate.name,
      origin: 'server',
      reason: candidate.reason,
      authorNickname: candidate.authorNickname,
      identical: candidate.identical,
    });
  }

  return hints.slice(0, limit);
}

/** Krótkie wyjaśnienie obecności pozycji na liście — gotowe do pokazania. */
export function describeHint(hint: DuplicateHint): string {
  if (hint.reason !== null) return hint.reason;
  if (hint.origin === 'local') return 'podobna nazwa';
  return 'podobne znaczenie';
}
