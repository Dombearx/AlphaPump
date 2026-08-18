/**
 * Eksport dziennika treningów do pliku kopii zapasowej FitNotes.
 *
 * Plik `FitNotes_Backup.fitnotes` jest zwykłą, nieszyfrowaną bazą SQLite —
 * tylko z innym rozszerzeniem. Zamiast produkować osobny format wymiany
 * dopisujemy dane **wprost do niego**, żeby użytkownik mógł go po prostu
 * przywrócić w FitNotesie.
 *
 * ## Dlaczego reguły są tutaj, a nie przy zapisie
 *
 * Decyzje są trzy i każda jest domenowa: co jest duplikatem, na którą kategorię
 * przełożyć tag główny i które ćwiczenie trzeba dopiero utworzyć. Rozstrzygnięte
 * tutaj dają się przetestować bez pliku SQLite i bez telefonu, a warstwa
 * zapisu zostaje mechaniczna: „wstaw te wiersze".
 *
 * ## Kategorie: mapujemy, nie zakładamy
 *
 * Darmowa wersja FitNotesa nie pozwala utworzyć kategorii, więc eksport **nigdy**
 * nie dopisuje wiersza do `Category`. Tag główny bez odpowiednika o tej samej
 * nazwie wraca w `missingCategories` — o zastępnik pyta użytkownika warstwa
 * wyżej, a jego wybór wraca tu w `categoryMapping` i jest zapamiętywany na
 * kolejne eksporty. Serie takiego tagu czekają; nie zgadujemy kategorii, bo
 * pomyłka wylądowałaby w cudzym pliku na stałe.
 *
 * ## Duplikaty: rejestr po naszej stronie
 *
 * `training_log` nie ma znacznika czasu dodania wpisu — tylko dzień — więc plik
 * docelowy nie jest w stanie odpowiedzieć, czy tę serię już dostał. Rejestr
 * wyeksportowanych wpisów prowadzi więc AlphaPump, kluczem z `fitNotesExportKey`:
 * ćwiczenie + wartości serii + moment jej dodania. Tyle wystarczy, żeby kolejny
 * eksport dopisał wyłącznie to, czego jeszcze nie było, i żeby dwie identyczne
 * serie z jednego treningu dalej były dwiema seriami.
 */

import type { IsoDate } from './dates.js';
import { slug } from './slug.js';
import { gramsToKilograms, metersToKilometers } from './units.js';

/** `unit` w `training_log`: 0 = kilogramy. AlphaPump trzyma gramy, więc zawsze. */
export const FITNOTES_UNIT_METRIC = 0;

/** Kategoria z pliku docelowego (tabela `Category`). */
export interface FitNotesCategory {
  id: number;
  name: string;
}

/** Ćwiczenie z pliku docelowego (tabela `exercise`). */
export interface FitNotesExercise {
  id: number;
  name: string;
  categoryId: number;
}

/** Stan pliku docelowego, na którym liczy się plan. */
export interface FitNotesTarget {
  categories: readonly FitNotesCategory[];
  exercises: readonly FitNotesExercise[];
}

/** Seria AlphaPump w postaci, w jakiej wchodzi do eksportu. */
export interface FitNotesSourceSet {
  exerciseName: string;
  /** Tag główny ćwiczenia — to on odpowiada kategorii w FitNotesie. */
  categoryName: string;
  performedOn: IsoDate;
  weightG: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
  /** Moment dodania serii w AlphaPump (ISO 8601) — część klucza duplikatu. */
  createdAt: string;
}

/**
 * Wiersz `training_log` gotowy do wstawienia. Ćwiczenie jest nazwą, a nie
 * identyfikatorem, bo część ćwiczeń dopiero powstanie i numeru jeszcze nie ma.
 */
export interface FitNotesLogRow {
  exerciseName: string;
  /** `YYYY-MM-DD`, bez godziny — tak jak w kolumnie `date`. */
  date: IsoDate;
  /** Kilogramy; ułamki są w porządku, kolumna trzyma je jako `REAL`. */
  metricWeight: number;
  reps: number;
  unit: number;
  /** Kilometry — spójnie z `unit = 0`, czyli z zapisem metrycznym. */
  distance: number;
  durationSeconds: number;
}

/** Ćwiczenie, którego w pliku docelowym jeszcze nie ma. */
export interface FitNotesExerciseToCreate {
  name: string;
  categoryId: number;
}

export interface FitNotesExportPlan {
  /** Wiersze do dopisania do `training_log`. */
  rows: FitNotesLogRow[];
  /** Wiersze do dopisania do `exercise`, w kolejności pierwszego użycia. */
  exercisesToCreate: FitNotesExerciseToCreate[];
  /** Klucze wpisów z `rows` — do rejestru, po **udanym** zapisie. */
  keys: string[];
  /** Kategorie AlphaPump bez odpowiednika i bez zapamiętanego wyboru. */
  missingCategories: string[];
  /** Serie pominięte, bo rejestr zna je z wcześniejszego eksportu. */
  alreadyExported: number;
  /** Serie czekające na wskazanie zastępczej kategorii. */
  blocked: number;
}

export interface FitNotesExportInput {
  sets: readonly FitNotesSourceSet[];
  target: FitNotesTarget;
  /**
   * Zapamiętane wybory użytkownika: nazwa tagu głównego z AlphaPump → nazwa
   * kategorii w pliku docelowym. Klucze normalizuje `fitNotesNameKey`.
   */
  categoryMapping?: Readonly<Record<string, string>>;
  /** Klucze wpisów, które poszły do tego pliku wcześniej. */
  exportedKeys?: readonly string[];
}

/**
 * Klucz porównywania nazw — ten sam, którym AlphaPump normalizuje nazwy własne.
 * „Bench Press" i „bench press" to w FitNotesie to samo ćwiczenie, a założenie
 * drugiego wiersza rozbiłoby historię na dwa wykresy.
 */
export function fitNotesNameKey(name: string): string {
  return slug(name);
}

/**
 * Klucz duplikatu: ćwiczenie, wartości serii i moment jej dodania.
 *
 * Identyfikator serii byłby krótszy, ale ten klucz przeżywa odtworzenie z
 * archiwum na koncie o innym identyfikatorze — a to jest dokładnie ta sytuacja,
 * w której powtórny eksport zdublowałby użytkownikowi cały dziennik.
 */
export function fitNotesExportKey(set: FitNotesSourceSet): string {
  return [
    fitNotesNameKey(set.exerciseName),
    set.performedOn,
    set.weightG ?? '',
    set.reps ?? '',
    set.durationS ?? '',
    set.distanceM ?? '',
    set.createdAt,
  ].join('|');
}

/** Wartości serii przełożone na kolumny `training_log`. */
function logRow(set: FitNotesSourceSet): FitNotesLogRow {
  return {
    exerciseName: set.exerciseName,
    date: set.performedOn,
    metricWeight: set.weightG === null ? 0 : gramsToKilograms(set.weightG),
    reps: set.reps ?? 0,
    unit: FITNOTES_UNIT_METRIC,
    distance: set.distanceM === null ? 0 : metersToKilometers(set.distanceM),
    durationSeconds: set.durationS ?? 0,
  };
}

/**
 * Układa plan dopisania serii do pliku FitNotesa.
 *
 * Kolejność sprawdzeń nie jest przypadkowa: najpierw rejestr (seria już
 * wyeksportowana nie obchodzi nas w ogóle), potem ćwiczenie, a kategoria dopiero
 * wtedy, gdy ćwiczenie trzeba utworzyć. Ćwiczenie, które w pliku już jest, ma
 * swoją kategorię ustawioną przez użytkownika FitNotesa i nie mamy powodu jej
 * ruszać ani pytać o nią ponownie.
 */
export function planFitNotesExport(input: FitNotesExportInput): FitNotesExportPlan {
  const categoriesByName = new Map(
    input.target.categories.map((category) => [fitNotesNameKey(category.name), category]),
  );
  const exercisesByName = new Map(
    input.target.exercises.map((exercise) => [fitNotesNameKey(exercise.name), exercise]),
  );
  const mapping = new Map(
    Object.entries(input.categoryMapping ?? {}).map(([from, to]) => [fitNotesNameKey(from), to]),
  );
  const exported = new Set(input.exportedKeys ?? []);

  const rows: FitNotesLogRow[] = [];
  const keys = new Set<string>();
  const toCreate = new Map<string, FitNotesExerciseToCreate>();
  const missing = new Set<string>();
  let alreadyExported = 0;
  let blocked = 0;

  for (const set of input.sets) {
    const key = fitNotesExportKey(set);
    if (exported.has(key)) {
      alreadyExported += 1;
      continue;
    }

    const exerciseKey = fitNotesNameKey(set.exerciseName);
    if (!exercisesByName.has(exerciseKey) && !toCreate.has(exerciseKey)) {
      const substitute = mapping.get(fitNotesNameKey(set.categoryName)) ?? set.categoryName;
      const category = categoriesByName.get(fitNotesNameKey(substitute));
      if (category === undefined) {
        missing.add(set.categoryName);
        blocked += 1;
        continue;
      }
      toCreate.set(exerciseKey, { name: set.exerciseName, categoryId: category.id });
    }

    rows.push(logRow(set));
    keys.add(key);
  }

  return {
    rows,
    exercisesToCreate: [...toCreate.values()],
    keys: [...keys],
    missingCategories: [...missing],
    alreadyExported,
    blocked,
  };
}
