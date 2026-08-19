/**
 * Porządkowanie biblioteki — reguły, bez interfejsu.
 *
 * Ekran biblioteki odpowiada na trzy pytania i wszystkie trzy są tutaj, jako
 * zwykłe funkcje: **czy ten wiersz da się usunąć**, **co z nim właściwie
 * zrobić**, i **które wiersze w ogóle pokazać**. Renderowanie tabeli nie jest
 * warte testu; te trzy rzeczy są, bo pomyłka w każdej z nich kończy się albo
 * przyciskiem, który zawsze odbija się o 409, albo — gorzej — scaleniem
 * w niewłaściwą stronę.
 *
 * Predykaty są tu **powtórzeniem** reguł serwerowych i nie udają czegoś innego:
 * decyduje serwer, panel jedynie tłumaczy jego odmowę zawczasu, zamiast pokazać
 * ją po kliknięciu. Kiedy się rozjadą, wygrywa serwer — dlatego panel nigdy nie
 * ukrywa wiersza na podstawie tych funkcji, a jedynie wygasza przycisk
 * i dopisuje powód.
 */

import type { LibraryExercise, LibraryTag } from '@alphapump/core';

/* -------------------------------------------------------- blokady usunięcia */

/**
 * Dlaczego tego ćwiczenia nie da się usunąć; `null` — da się.
 *
 * Odpowiada regule z `apps/api/src/exercise-usage.ts`: liczą się serie żywe
 * i cele żywych cykli.
 */
export function exerciseDeletionProblem(entry: LibraryExercise): string | null {
  const { sets, users, goals } = entry.usage;

  if (sets > 0) {
    const owners = users === 1 ? '1 osoby' : `${String(users)} osób`;
    return `Ma ${String(sets)} zapisanych serii (${owners}). Scal je z innym ćwiczeniem — serie przejdą razem z nim.`;
  }
  if (goals > 0) {
    return `Wskazuje na nie ${String(goals)} celów cyklu. Scal je z innym ćwiczeniem albo popraw cele.`;
  }
  return null;
}

/** Dlaczego tego tagu nie da się usunąć; `null` — da się. */
export function tagDeletionProblem(entry: LibraryTag): string | null {
  const { exercises, primaryExercises, sets, goals } = entry.usage;

  if (exercises > 0) {
    const asPrimary =
      primaryExercises > 0 ? `, w tym ${String(primaryExercises)} jako tag główny` : '';
    const logged = sets > 0 ? `, z ${String(sets)} zapisanymi seriami` : '';
    return `Używa go ${String(exercises)} ćwiczeń${asPrimary}${logged}. Scal go z innym tagiem.`;
  }
  if (goals > 0) {
    return `Wskazuje na niego ${String(goals)} celów cyklu. Scal go z innym tagiem albo popraw cele.`;
  }
  return null;
}

/* ---------------------------------------------------------------- filtrowanie */

/** Kto jest autorem: wszyscy, konto systemowe (seed) albo ludzie. */
export type AuthorFilter = 'all' | 'builtIn' | 'user';
/** Stan wiersza: żywy, z tombstonem albo oba naraz. */
export type StatusFilter = 'live' | 'deleted' | 'all';

export interface ExerciseFilter {
  query: string;
  author: AuthorFilter;
  status: StatusFilter;
  /** Pokazuje wyłącznie ćwiczenia z tym tagiem — głównym albo dodatkowym. */
  tagId: string | null;
}

export const EMPTY_FILTER: ExerciseFilter = {
  query: '',
  author: 'all',
  status: 'live',
  tagId: null,
};

/**
 * Dopasowanie po nazwie **i po nicku autora**.
 *
 * Autor jest tu nie bez powodu: sytuacja, dla której ten ekran powstał, to
 * „w bibliotece stoją ćwiczenia, których nikt nie planował dodawać" — a jedyne,
 * co je wtedy łączy, to właśnie konto, z którego weszły.
 */
function matchesQuery(entry: LibraryExercise, needle: string): boolean {
  if (needle.length === 0) return true;
  return (
    entry.exercise.name.toLowerCase().includes(needle) ||
    entry.authorNickname.toLowerCase().includes(needle) ||
    (entry.exercise.gym ?? '').toLowerCase().includes(needle)
  );
}

export function filterExercises(
  rows: readonly LibraryExercise[],
  filter: ExerciseFilter,
): LibraryExercise[] {
  const needle = filter.query.trim().toLowerCase();

  return rows.filter((entry) => {
    if (!matchesQuery(entry, needle)) return false;
    if (filter.author === 'builtIn' && !entry.builtIn) return false;
    if (filter.author === 'user' && entry.builtIn) return false;

    const deleted = entry.exercise.deletedAt !== null;
    if (filter.status === 'live' && deleted) return false;
    if (filter.status === 'deleted' && !deleted) return false;

    if (filter.tagId !== null) {
      const { primaryTagId, additionalTagIds } = entry.exercise;
      if (primaryTagId !== filter.tagId && !additionalTagIds.includes(filter.tagId)) return false;
    }

    return true;
  });
}

/* -------------------------------------------------------------- cele scalenia */

/**
 * Ćwiczenia, w które wolno scalić wskazane.
 *
 * Typ logowania musi się zgadzać — serie są walidowane względem typu
 * **ćwiczenia**, więc przeniesione pod ćwiczenie innego typu byłyby wierszami,
 * których nie przyjąłby żaden zapis. Cel z tombstonem odpada z tego samego
 * powodu, dla którego odpada w API: scalanie w wiersz, którego dla użytkownika
 * nie ma, przenosi serie donikąd.
 */
export function exerciseMergeTargets(
  rows: readonly LibraryExercise[],
  source: LibraryExercise,
): LibraryExercise[] {
  return rows
    .filter(
      (entry) =>
        entry.exercise.id !== source.exercise.id &&
        entry.exercise.deletedAt === null &&
        entry.exercise.loggingType === source.exercise.loggingType,
    )
    .sort((left, right) => left.exercise.name.localeCompare(right.exercise.name, 'pl'));
}

export function tagMergeTargets(rows: readonly LibraryTag[], source: LibraryTag): LibraryTag[] {
  return rows
    .filter((entry) => entry.tag.id !== source.tag.id && entry.tag.deletedAt === null)
    .sort((left, right) => left.tag.name.localeCompare(right.tag.name, 'pl'));
}

/* ------------------------------------------------------------------ opisy */

/** Krótkie „co na tym wisi" do kolumny użycia — puste znaczy „nic". */
export function usageSummary(usage: LibraryExercise['usage']): string {
  const parts: string[] = [];
  if (usage.sets > 0) parts.push(`${String(usage.sets)} serii`);
  if (usage.users > 1) parts.push(`${String(usage.users)} osób`);
  if (usage.goals > 0) parts.push(`${String(usage.goals)} celów`);
  if (usage.deletedSets > 0) parts.push(`${String(usage.deletedSets)} skasowanych serii`);
  return parts.join(' · ');
}
