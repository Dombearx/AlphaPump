/**
 * Kontrakt zarządzania biblioteką z panelu administracyjnego.
 *
 * Zwykły CRUD ćwiczeń i tagów opisuje `schemas.ts` — tam mieszka to, co widzi
 * i wysyła aplikacja. Tutaj jest wyłącznie to, czego aplikacja nie robi i robić
 * nie będzie: **porządkowanie** biblioteki. Trzy rzeczy, których zwykły CRUD
 * nie umie:
 *
 * 1. **Użycie.** „Czy da się to usunąć" jest pytaniem o zapisane serie, a nie
 *    o uprawnienia. Lista biblioteki dla panelu niesie więc przy każdym wierszu
 *    liczby, po których widać, co wisi na tym ćwiczeniu albo tagu — bo to one
 *    decydują, czy usunięcie w ogóle wchodzi w grę.
 * 2. **Scalenie.** Dwa wiersze opisujące ten sam ruch to nie jest sytuacja, którą
 *    da się naprawić usunięciem: seria zapisana na jednym z nich musi mieć dokąd
 *    przejść. Scalenie przenosi serie i cele cyklu, a dopiero potem zdejmuje
 *    źródło.
 * 3. **Przywrócenie.** Usunięcie jest miękkie, więc pomyłka jest odwracalna —
 *    ale tylko wtedy, gdy jest czym ją odwrócić.
 *
 * Schematy są tu, a nie w API, z tego samego powodu co reszta kontraktu: panel
 * jest osobną aplikacją i dwie niezależne definicje tego samego kształtu
 * rozjeżdżają się przy pierwszym dodanym polu — cicho, bo TypeScript po obu
 * stronach jest wtedy zadowolony.
 */

import { z } from 'zod';
import { exerciseSchema, isoDateSchema, tagSchema, uuidSchema } from './schemas.js';

/* ------------------------------------------------------------------ użycie */

/**
 * Co wisi na ćwiczeniu.
 *
 * `sets` liczy serie **żywe** i to ona blokuje usunięcie; `deletedSets` stoi
 * obok, bo seria z tombstonem dalej wskazuje na to ćwiczenie i wróci, gdy
 * urządzenie, które ją skasowało, przegra rozstrzygnięcie konfliktu.
 *
 * `users` mówi, ilu ludzi to dotyczy — to jest różnica między „moje ćwiczenie
 * z jedną serią" a „ćwiczenie, na którym trenuje cała grupa", i to ona decyduje,
 * czy scalenie jest porządkowaniem, czy ingerencją w cudzą historię.
 */
export const exerciseUsageSchema = z.object({
  sets: z.int().min(0),
  deletedSets: z.int().min(0),
  users: z.int().min(0),
  /** Cele cykli wskazujące na to ćwiczenie — zniknięcie ćwiczenia psuje ich liczenie. */
  goals: z.int().min(0),
  /** Ostatni dzień, w którym ktokolwiek zapisał serię; `null` — nigdy. */
  lastPerformedOn: isoDateSchema.nullable(),
});

export type ExerciseUsage = z.infer<typeof exerciseUsageSchema>;

/**
 * Ćwiczenie w widoku porządkowania.
 *
 * Samo ćwiczenie jest tu **zagnieżdżone**, a nie rozpłaszczone, żeby panel mógł
 * podać je wprost formularzowi edycji — ten przyjmuje `Exercise` z rdzenia
 * i o istnieniu tego widoku nie musi wiedzieć.
 */
export const libraryExerciseSchema = z.object({
  exercise: exerciseSchema,
  /** Nick autora — bez niego kolumna „autor" byłaby kolumną identyfikatorów. */
  authorNickname: z.string().min(1),
  /** Autorem jest konto systemowe, czyli wiersz pochodzi z seeda. */
  builtIn: z.boolean(),
  /**
   * Czy ćwiczenie ma policzony wektor. Ćwiczenie bez wektora jest niewidoczne
   * dla warstwy semantycznej, więc jego brak tłumaczy pustą listę podobnych.
   */
  hasEmbedding: z.boolean(),
  usage: exerciseUsageSchema,
});

export type LibraryExercise = z.infer<typeof libraryExerciseSchema>;

export const libraryExerciseListSchema = z.object({ exercises: z.array(libraryExerciseSchema) });

/**
 * Co wisi na tagu.
 *
 * Ćwiczenia są rozbite na główne i dodatkowe, bo to dwie różne przeszkody:
 * tag dodatkowy da się zdjąć edycją ćwiczenia, tag główny trzeba **zastąpić**
 * innym — ćwiczenie bez tagu głównego nie istnieje.
 */
export const tagUsageSchema = z.object({
  primaryExercises: z.int().min(0),
  additionalExercises: z.int().min(0),
  /** Ćwiczenia unikalne — tag bywa główny dla jednego, a dodatkowy dla drugiego. */
  exercises: z.int().min(0),
  /** Serie zapisane na ćwiczeniach z tym tagiem — sedno reguły „nic nie tracimy". */
  sets: z.int().min(0),
  goals: z.int().min(0),
});

export type TagUsage = z.infer<typeof tagUsageSchema>;

export const libraryTagSchema = z.object({
  tag: tagSchema,
  /** Tag z seeda — kasowanie takiego zwykle znaczy, że ktoś się pomylił. */
  builtIn: z.boolean(),
  usage: tagUsageSchema,
});

export type LibraryTag = z.infer<typeof libraryTagSchema>;

export const libraryTagListSchema = z.object({ tags: z.array(libraryTagSchema) });

/* ---------------------------------------------------------------- scalenie */

/** Wejście scalenia: dokąd przenieść. Źródło jest w ścieżce żądania. */
export const mergeInputSchema = z.object({ targetId: uuidSchema });

export type MergeInput = z.infer<typeof mergeInputSchema>;

/**
 * Raport scalenia ćwiczeń.
 *
 * Liczby, a nie samo „udało się": scalenie dotyka cudzych serii i jedyną
 * odpowiedzią, która pozwala to sprawdzić bez zaglądania do bazy, jest „ile
 * ich było". Serie usunięte są przenoszone razem z żywymi i liczone osobno —
 * tombstone, który zostałby przy zdjętym ćwiczeniu, wróciłby na telefon jako
 * seria wskazująca w próżnię.
 */
export const exerciseMergeReportSchema = z.object({
  sourceId: uuidSchema,
  targetId: uuidSchema,
  movedSets: z.int().min(0),
  movedDeletedSets: z.int().min(0),
  movedGoals: z.int().min(0),
});

export type ExerciseMergeReport = z.infer<typeof exerciseMergeReportSchema>;

/**
 * Raport scalenia tagów.
 *
 * `mergedAdditional` to wiersze, których nie dało się przenieść, bo ćwiczenie
 * miało już tag docelowy — zostają zdjęte, a nie zdublowane. To nie jest utrata
 * danych: zestaw tagów ćwiczenia jest zbiorem, a nie listą.
 */
export const tagMergeReportSchema = z.object({
  sourceId: uuidSchema,
  targetId: uuidSchema,
  movedPrimary: z.int().min(0),
  movedAdditional: z.int().min(0),
  mergedAdditional: z.int().min(0),
  movedGoals: z.int().min(0),
});

export type TagMergeReport = z.infer<typeof tagMergeReportSchema>;

/* ------------------------------------------------------------- embeddingi */

/**
 * Odpowiedź na prośbę o przeliczenie wektorów całej biblioteki.
 *
 * Jest to **potwierdzenie przyjęcia zlecenia**, nie wynik pracy, i to jest
 * zmiana względem pierwszej wersji. Wcześniej endpoint iterował po całej
 * bibliotece w środku żądania — do ośmiu sekund na ćwiczenie — i odpowiadał
 * dopiero na końcu. Caddy przerywa po dwóch minutach, więc przy większej
 * bibliotece panel dostawał błąd bramy, podczas gdy zadanie po cichu leciało
 * dalej; ponowne kliknięcie startowało drugi przebieg obok pierwszego.
 *
 * `enabled: false` znaczy, że warstwa semantyczna jest wyłączona — nie jest to
 * błąd, tylko konfiguracja. Bez tego pola panel nie odróżniłby „nie ma czego
 * liczyć" od „nie ma czym".
 *
 * Postęp widać w `/admin/stats` (`duplicates.embeddings`) — panel odświeża tę
 * liczbę i nie potrzebuje osobnego kanału.
 */
export const embeddingRefreshReportSchema = z.object({
  enabled: z.boolean(),
  /**
   * `started` — zlecenie przyjęte, `busy` — przebieg już trwa i drugiego nie
   * uruchamiamy, `disabled` — warstwa semantyczna wyłączona.
   */
  status: z.enum(['started', 'busy', 'disabled']),
  /** Ile ćwiczeń trafiło do kolejki. */
  queued: z.int().min(0),
  /** Ile czeka w tej chwili — razem z tym, co zgłosiły wcześniejsze zapisy. */
  pending: z.int().min(0),
});

export type EmbeddingRefreshReport = z.infer<typeof embeddingRefreshReportSchema>;

/**
 * Odpowiedź na „uzupełnij brakujące tłumaczenia".
 *
 * Ten sam kształt co przy wektorach i z tego samego powodu: robota idzie do
 * kolejki poza żądaniem, więc odpowiedź jest potwierdzeniem przyjęcia zlecenia,
 * a nie wynikiem. Osobny schemat, a nie wspólny z embeddingami, bo liczy co
 * innego — tagi **i** ćwiczenia — i wolno mu się od tamtego rozejść.
 *
 * `enabled: false` znaczy „nie ma czym tłumaczyć": wyłączony przełącznik albo
 * brak klucza u dostawcy modeli. To jest konfiguracja, a nie awaria — nazwy
 * dalej wyświetlają się kanoniczne.
 */
export const translationRefreshReportSchema = z.object({
  enabled: z.boolean(),
  /** `started` — zlecenie przyjęte, `busy` — przebieg już trwa, `disabled` — nie ma czym. */
  status: z.enum(['started', 'busy', 'disabled']),
  /** Ile wierszy (tagów i ćwiczeń razem) trafiło do kolejki. */
  queued: z.int().min(0),
  /** Ile czeka w tej chwili — razem z tym, co zgłosiły wcześniejsze zapisy. */
  pending: z.int().min(0),
});

export type TranslationRefreshReport = z.infer<typeof translationRefreshReportSchema>;
