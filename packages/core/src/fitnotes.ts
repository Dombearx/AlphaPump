/**
 * Wymiana dziennika treningów z plikiem kopii zapasowej FitNotes — w obie strony.
 *
 * Plik `FitNotes_Backup.fitnotes` jest zwykłą, nieszyfrowaną bazą SQLite —
 * tylko z innym rozszerzeniem. Zamiast produkować osobny format wymiany
 * dopisujemy dane **wprost do niego**, żeby użytkownik mógł go po prostu
 * przywrócić w FitNotesie. Import czyta ten sam plik i dokłada z niego to,
 * czego AlphaPump jeszcze nie ma.
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
 *
 * ## Import: duplikat rozstrzyga sam plik
 *
 * W drugą stronę rejestr jest niepotrzebny i byłby wręcz szkodliwy: plik może
 * pochodzić z innego telefonu, a jego wpisy mogły wejść do AlphaPump dowolną
 * drogą. Duplikatem jest więc wpis, którego odpowiednik **już leży w bazie** —
 * ta sama trójka: dzień, ćwiczenie i pomiary (`fitNotesSetKey`). Porównujemy
 * przy tym liczności, a nie sam zbiór kluczy: trzy identyczne serie z jednego
 * treningu są trzema seriami i mają nimi zostać, a ponowny import tego samego
 * pliku nie ma dołożyć ani jednej.
 */

import type { IsoDate } from './dates.js';
import { isIsoDate } from './dates.js';
import { hasCompleteMeasurements, requiredMeasurements, type LoggingType } from './logging-type.js';
import { displayNameSchema } from './schemas.js';
import { slug } from './slug.js';
import {
  gramsToKilograms,
  kilogramsToGrams,
  kilometersToMeters,
  metersToKilometers,
} from './units.js';

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

/**
 * Seria sprowadzona do tego, co odróżnia ją od innych po obu stronach wymiany:
 * ćwiczenie, dzień i pomiary. Tyle wystarczy, żeby rozpoznać duplikat przy
 * imporcie — plik FitNotesa nie zna o serii nic więcej.
 */
export interface FitNotesMeasuredSet {
  exerciseName: string;
  performedOn: IsoDate;
  weightG: number | null;
  reps: number | null;
  durationS: number | null;
  distanceM: number | null;
}

/** Seria AlphaPump w postaci, w jakiej wchodzi do eksportu. */
export interface FitNotesSourceSet extends FitNotesMeasuredSet {
  /** Tag główny ćwiczenia — to on odpowiada kategorii w FitNotesie. */
  categoryName: string;
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

/** Klucz serii: ćwiczenie, dzień i pomiary — bez momentu dodania. */
export function fitNotesSetKey(set: FitNotesMeasuredSet): string {
  return [
    fitNotesNameKey(set.exerciseName),
    set.performedOn,
    set.weightG ?? '',
    set.reps ?? '',
    set.durationS ?? '',
    set.distanceM ?? '',
  ].join('|');
}

/**
 * Klucz duplikatu eksportu: klucz serii i moment jej dodania.
 *
 * Identyfikator serii byłby krótszy, ale ten klucz przeżywa odtworzenie z
 * archiwum na koncie o innym identyfikatorze — a to jest dokładnie ta sytuacja,
 * w której powtórny eksport zdublowałby użytkownikowi cały dziennik.
 */
export function fitNotesExportKey(set: FitNotesSourceSet): string {
  return `${fitNotesSetKey(set)}|${set.createdAt}`;
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

/* -------------------------------------------------------------------- import */

/**
 * Wpis `training_log` odczytany z pliku, metrycznie: ciężar w kilogramach
 * (`metric_weight` trzyma je tak zawsze), dystans w kilometrach, czas
 * w sekundach. Kolumny `unit` nie tłumaczymy — jest wyborem jednostek
 * **wyświetlania** i tak samo, jako metryczną, zapisuje ją nasz eksport.
 */
export interface FitNotesLogEntry {
  exerciseName: string;
  /** Kategoria ćwiczenia w pliku — po naszej stronie tag główny. */
  categoryName: string;
  /** `YYYY-MM-DD` z kolumny `date`; wpisu z inną datą nie da się zapisać. */
  date: string;
  metricWeight: number;
  reps: number;
  distance: number;
  durationSeconds: number;
}

/** Ćwiczenie, które AlphaPump już zna — razem z ustalonym typem logowania. */
export interface FitNotesKnownExercise {
  name: string;
  loggingType: LoggingType;
}

/** Ćwiczenie do założenia w bibliotece, żeby serie z pliku miały na co wskazywać. */
export interface FitNotesExerciseToAdd {
  name: string;
  loggingType: LoggingType;
  /** Kategoria z pliku; tag o tej nazwie powstanie, jeśli jeszcze go nie ma. */
  tagName: string;
}

export interface FitNotesImportPlan {
  /** Serie do zapisania, w kolejności z pliku. */
  sets: FitNotesMeasuredSet[];
  /** Ćwiczenia do założenia — wyłącznie te, do których coś wchodzi. */
  exercisesToCreate: FitNotesExerciseToAdd[];
  /** Wpisy pominięte, bo AlphaPump ma już taką serię. */
  duplicates: number;
  /** Wpisy, których nie da się zapisać: bez pomiaru, z nieznaną datą lub nazwą. */
  skipped: number;
}

export interface FitNotesImportInput {
  entries: readonly FitNotesLogEntry[];
  /** Biblioteka lokalna — jej typ logowania jest rozstrzygający, bo już się nie zmieni. */
  known: readonly FitNotesKnownExercise[];
  /** Serie właściciela telefonu; to z nimi porównujemy wpisy z pliku. */
  existing: readonly FitNotesMeasuredSet[];
}

/** Nazwa musi przejść walidację zapisu — inaczej wywróciłaby cały import. */
function isWritableName(name: string): boolean {
  return displayNameSchema.safeParse(name).success;
}

/**
 * Typ logowania nowego ćwiczenia wynika z **całości** jego wpisów, a nie
 * z pierwszego: podciąganie z obciążeniem ma w pliku także serie z ciężarem
 * zero, a typu logowania nie da się później zmienić.
 *
 * Powtórzenia wygrywają z czasem, bo FitNotes zapisuje przy seriach na
 * powtórzenia także czas odpoczynku — a to nie jest pomiar tej serii.
 */
function inferLoggingType(entries: readonly FitNotesLogEntry[]): LoggingType | null {
  const some = (measure: (entry: FitNotesLogEntry) => number) =>
    entries.some((entry) => measure(entry) > 0);
  const weighted = some((entry) => entry.metricWeight);

  if (some((entry) => entry.distance)) return 'distance_time';
  if (some((entry) => entry.reps)) return weighted ? 'weight_reps' : 'bodyweight_reps';
  if (some((entry) => entry.durationSeconds)) return weighted ? 'weight_time' : 'bodyweight_time';
  return null;
}

/**
 * Wpis przełożony na pomiary AlphaPump. Pola spoza typu logowania są `null`,
 * a nie zerem — takiej serii nie przyjąłby ani schemat zapisu, ani baza.
 */
function measuredSet(entry: FitNotesLogEntry, loggingType: LoggingType): FitNotesMeasuredSet {
  const measured = new Set<string>(requiredMeasurements(loggingType));

  return {
    exerciseName: entry.exerciseName,
    performedOn: entry.date,
    weightG: measured.has('weightG') ? kilogramsToGrams(entry.metricWeight) : null,
    reps: measured.has('reps') ? entry.reps : null,
    durationS: measured.has('durationS') ? entry.durationSeconds : null,
    distanceM: measured.has('distanceM') ? kilometersToMeters(entry.distance) : null,
  };
}

/**
 * Układa plan wciągnięcia dziennika FitNotesa do AlphaPump.
 *
 * Scalanie, nie zastępowanie: plan mówi wyłącznie, co **dołożyć**. Niczego nie
 * usuwa i niczego nie nadpisuje, bo plik jest jednym ze źródeł historii, a nie
 * jej całością — użytkownik ma prawo mieć w AlphaPump serie, których FitNotes
 * nigdy nie widział.
 */
export function planFitNotesImport(input: FitNotesImportInput): FitNotesImportPlan {
  const knownTypes = new Map<string, LoggingType>();
  for (const exercise of input.known) {
    const key = fitNotesNameKey(exercise.name);
    if (!knownTypes.has(key)) knownTypes.set(key, exercise.loggingType);
  }

  const unknown = new Map<string, FitNotesLogEntry[]>();
  for (const entry of input.entries) {
    const key = fitNotesNameKey(entry.exerciseName);
    if (knownTypes.has(key) || !isWritableName(entry.exerciseName)) continue;
    const group = unknown.get(key);
    if (group === undefined) unknown.set(key, [entry]);
    else group.push(entry);
  }

  const toAdd = new Map<string, FitNotesExerciseToAdd>();
  for (const [key, entries] of unknown) {
    const loggingType = inferLoggingType(entries);
    const first = entries[0];
    if (loggingType === null || first === undefined) continue;
    if (!isWritableName(first.categoryName)) continue;
    toAdd.set(key, { name: first.exerciseName, loggingType, tagName: first.categoryName });
  }

  // Liczności, nie zbiór: trzy identyczne serie z jednego treningu są trzema
  // seriami, a plik, w którym są cztery, ma dołożyć dokładnie jedną.
  const remaining = new Map<string, number>();
  for (const set of input.existing) {
    const key = fitNotesSetKey(set);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }

  const sets: FitNotesMeasuredSet[] = [];
  let duplicates = 0;
  let skipped = 0;

  for (const entry of input.entries) {
    const key = fitNotesNameKey(entry.exerciseName);
    const loggingType = knownTypes.get(key) ?? toAdd.get(key)?.loggingType;
    if (loggingType === undefined || !isIsoDate(entry.date)) {
      skipped += 1;
      continue;
    }

    const set = measuredSet(entry, loggingType);
    if (!hasCompleteMeasurements(loggingType, set)) {
      skipped += 1;
      continue;
    }

    const setKey = fitNotesSetKey(set);
    const seen = remaining.get(setKey) ?? 0;
    if (seen > 0) {
      remaining.set(setKey, seen - 1);
      duplicates += 1;
      continue;
    }

    sets.push(set);
  }

  // Ćwiczenie, z którego nic nie weszło (same duplikaty albo same wpisy bez
  // pomiaru), nie ma po co powstawać w bibliotece.
  const used = new Set(sets.map((set) => fitNotesNameKey(set.exerciseName)));

  return {
    sets,
    exercisesToCreate: [...toAdd.entries()]
      .filter(([key]) => used.has(key))
      .map(([, exercise]) => exercise),
    duplicates,
    skipped,
  };
}
