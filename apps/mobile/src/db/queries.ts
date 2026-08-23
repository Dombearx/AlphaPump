/**
 * Zapytania ekranów.
 *
 * Funkcje zwracają **niewykonane** zapytania Drizzle, bo tego oczekuje
 * `useLiveQuery`: dostaje zapytanie, subskrybuje tabele, których dotyka,
 * i przerysowuje ekran po każdym zapisie. Zwrócenie gotowych danych zabrałoby
 * tę właściwość i wymusiłoby ręczne odświeżanie.
 *
 * Wszystko jedzie z bazy lokalnej. Nie ma tu warstwy stanu serwerowego, nie ma
 * cache'a do unieważniania i nie ma ekranu, który czeka na sieć.
 *
 * > **Bez skorelowanych podzapytań pisanych surowym `sql`.** Drizzle pomija
 * > kwalifikatory tabel w szablonach `sql` należących do zapytania nad jedną
 * > tabelą: `${tags.id}` i `${exercises.id}` renderują się wtedy oba jako
 * > `"id"`, więc podzapytanie cicho porównuje kolumnę samą ze sobą i oddaje
 * > zero zamiast wyniku. Warunki budowane funkcjami (`eq`, `exists`, `count`,
 * > `max`) kwalifikują kolumny **zawsze**, niezależnie od liczby tabel —
 * > i tylko one są tu używane do korelacji. Ta sama pułapka nie dotyczy
 * > `apps/api`, gdzie zapytania są w całości budowane funkcjami.
 */

import {
  SYSTEM_USER_ID,
  type IsoDate,
  type Translatable,
  type Translations,
} from '@alphapump/core';
import {
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import {
  aliasedTable,
  and,
  asc,
  count,
  desc,
  eq,
  exists,
  gte,
  isNotNull,
  isNull,
  lte,
  max,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import { union } from 'drizzle-orm/sqlite-core';

/**
 * Serie jednego dnia wraz z opisem ćwiczenia.
 *
 * Zapytanie sortuje po pozycji, czyli po kolejności ustawionej przez
 * użytkownika. Podziału na ćwiczenia nie da się tu zrobić sensownie: pozycja
 * liczona jest w obrębie pary dzień + ćwiczenie, więc każde ćwiczenie zaczyna od
 * zera i samo sortowanie po niej pomieszałoby grupy. Grupowaniem zajmuje się
 * `groupDaySets` — na kilkudziesięciu wierszach dnia jest to tańsze niż
 * skorelowane podzapytanie po `min(created_at)` w każdym wierszu.
 */
export function daySets(db: SqliteDatabase, userId: string, day: IsoDate) {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      exerciseName: exercises.name,
      // Nazwa kanoniczna **i** tłumaczenia: który z nich pokazać, rozstrzyga
      // ekran, bo zależy to od wyboru języka, a nie od danych (patrz
      // `language/provider.tsx`).
      exerciseTranslations: exercises.translations,
      loggingType: exercises.loggingType,
      tagColor: tags.color,
      position: workoutSets.position,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      bodyweightG: workoutSets.bodyweightG,
      note: workoutSets.note,
      createdAt: workoutSets.createdAt,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .where(
      and(
        eq(workoutSets.userId, userId),
        eq(workoutSets.performedOn, day),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(asc(workoutSets.position), asc(workoutSets.id));
}

export type DaySetRow = Awaited<ReturnType<typeof daySets>>[number];

/** Ćwiczenie wykonane danego dnia razem ze swoimi seriami. */
export interface DayExerciseGroup {
  exerciseId: string;
  exerciseName: string;
  exerciseTranslations: Translations | null;
  loggingType: DaySetRow['loggingType'];
  tagColor: string;
  sets: DaySetRow[];
}

/**
 * Grupuje serie dnia po ćwiczeniu.
 *
 * Grupy idą w kolejności, w jakiej ćwiczenia zaczęto tego dnia wykonywać —
 * czyli tak, jak wyglądał trening. Wewnątrz grupy zostaje kolejność z zapytania,
 * czyli ta ustawiona przez użytkownika.
 */
export function groupDaySets(rows: readonly DaySetRow[]): DayExerciseGroup[] {
  const groups = new Map<string, DayExerciseGroup & { startedAt: number }>();

  for (const row of rows) {
    const existing = groups.get(row.exerciseId);
    if (existing) {
      existing.sets.push(row);
      existing.startedAt = Math.min(existing.startedAt, row.createdAt.getTime());
      continue;
    }

    groups.set(row.exerciseId, {
      exerciseId: row.exerciseId,
      exerciseName: row.exerciseName,
      exerciseTranslations: row.exerciseTranslations,
      loggingType: row.loggingType,
      tagColor: row.tagColor,
      sets: [row],
      startedAt: row.createdAt.getTime(),
    });
  }

  return [...groups.values()]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(({ startedAt: _startedAt, ...group }) => group);
}

/**
 * Liczba serii w każdym dniu zakresu — treść kafelków kalendarza.
 *
 * Zapytanie oddaje wyłącznie dni, w których coś się wydarzyło; dni puste nie
 * mają czego przynosić z bazy i siatkę uzupełnia nimi `calendarWeeks`. Zakres
 * jest domknięty obustronnie i pokrywa **całą siatkę**, razem z ogonami
 * sąsiednich miesięcy — inaczej pierwszy wiersz miesiąca pokazywałby zera tam,
 * gdzie trening był.
 */
export function daySetCounts(db: SqliteDatabase, userId: string, from: IsoDate, to: IsoDate) {
  return db
    .select({
      performedOn: workoutSets.performedOn,
      sets: count(workoutSets.id),
    })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.userId, userId),
        isNull(workoutSets.deletedAt),
        gte(workoutSets.performedOn, from),
        lte(workoutSets.performedOn, to),
      ),
    )
    .groupBy(workoutSets.performedOn)
    .orderBy(asc(workoutSets.performedOn));
}

export type DayCountRow = Awaited<ReturnType<typeof daySetCounts>>[number];

/**
 * Seria w zakresie, którego potrzebują rekordy, podpowiedź i lista dnia —
 * bez kolumn synchronizacyjnych, których przez most React Native nie ma po co
 * przenosić.
 */
export type HistorySetRow = Awaited<ReturnType<typeof exerciseHistory>>[number];

/**
 * Serie jednego ćwiczenia — cała historia użytkownika, chronologicznie.
 *
 * Bez ograniczenia liczby wierszy, i to jest decyzja: rekordy liczy front Pareto
 * (`computeRecords`), a ten musi widzieć **wszystkie** serie. Ucięcie historii
 * do ostatnich N sesji dałoby rekordy, które po cichu przestają być rekordami —
 * najgorszy możliwy błąd w aplikacji, której cała rzecz polega na tym, że mówi
 * prawdę o postępie.
 *
 * Ograniczamy za to **kolumny**. Przez most React Native przechodzi każdy wiersz
 * z każdym polem, a `deviceId`, `serverSeq`, `createdAt` i `deletedAt` nie są
 * potrzebne ani rekordom, ani podpowiedzi, ani liście dnia. Indeks
 * `workout_sets_user_exercise_idx` pokrywa warunek, więc odczyt jest jednym
 * przejściem po indeksie.
 */
export function exerciseHistory(db: SqliteDatabase, userId: string, exerciseId: string) {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      performedOn: workoutSets.performedOn,
      position: workoutSets.position,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      bodyweightG: workoutSets.bodyweightG,
      note: workoutSets.note,
    })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.userId, userId),
        eq(workoutSets.exerciseId, exerciseId),
        isNull(workoutSets.deletedAt),
      ),
    )
    .orderBy(asc(workoutSets.performedOn), asc(workoutSets.position), asc(workoutSets.id));
}

/** Ćwiczenie z tagiem głównym i nickiem autora — nagłówek ekranu logowania. */
export function exerciseDetails(db: SqliteDatabase, exerciseId: string) {
  return db
    .select({
      id: exercises.id,
      name: exercises.name,
      translations: exercises.translations,
      loggingType: exercises.loggingType,
      note: exercises.note,
      gym: exercises.gym,
      authorId: exercises.authorId,
      tagId: exercises.primaryTagId,
      tagName: tags.name,
      tagTranslations: tags.translations,
      tagColor: tags.color,
      authorNickname: users.nickname,
    })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .innerJoin(users, eq(users.id, exercises.authorId))
    .where(eq(exercises.id, exerciseId))
    .limit(1);
}

export type ExerciseDetailsRow = Awaited<ReturnType<typeof exerciseDetails>>[number];

/**
 * Skąd pochodzi ćwiczenie. Autorem wbudowanych jest konto systemowe — innego
 * znacznika nie potrzeba, bo autor i tak wchodzi w klucz identyfikatora.
 */
export type LibrarySource = 'all' | 'built-in' | 'community';

export interface LibraryFilter {
  /** Tag główny **albo** dodatkowy — filtr biblioteki jest szerszy niż cykle. */
  tagId?: string | null;
  source?: LibrarySource;
}

function librarySourceCondition(source: LibrarySource) {
  switch (source) {
    case 'built-in':
      return eq(exercises.authorId, SYSTEM_USER_ID);
    case 'community':
      return ne(exercises.authorId, SYSTEM_USER_ID);
    case 'all':
      return undefined;
  }
}

/**
 * Biblioteka do wyboru ćwiczenia, z licznikiem serii użytkownika.
 *
 * Ćwiczenia używane wcześniej idą na górę — przy „możliwie najmniejszej liczbie
 * kroków do zapisania serii" to zwykle one są tym, czego użytkownik szuka.
 *
 * Licznik i data ostatniego wykonania powstają z jednego złączenia z podzbiorem
 * żywych serii użytkownika, zagregowanego po ćwiczeniu. Złączenie z **całą**
 * tabelą serii rozmnożyłoby wiersze biblioteki, ale złączenie z podzapytaniem
 * i `GROUP BY` daje jeden wiersz na ćwiczenie i jedno przejście po seriach
 * zamiast dwóch podzapytań na wiersz.
 *
 * Filtr po tagu obejmuje tag główny **i** dodatkowe: w bibliotece tag jest
 * etykietą do przeglądania, a nie kryterium zaliczania serii do cyklu — tam
 * liczy się wyłącznie tag główny. W wyniku ćwiczenia, dla których wybrany tag
 * jest główny, idą przed tymi, dla których jest dodatkowy — bez tego lista
 * miesza oba przypadki i główne dopasowania giną między drugorzędnymi.
 */
export function exerciseLibrary(db: SqliteDatabase, userId: string, filter: LibraryFilter = {}) {
  const mySets = db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      performedOn: workoutSets.performedOn,
    })
    .from(workoutSets)
    .where(and(eq(workoutSets.userId, userId), isNull(workoutSets.deletedAt)))
    .as('my_sets');

  const tagged =
    filter.tagId == null
      ? undefined
      : or(
          eq(exercises.primaryTagId, filter.tagId),
          exists(
            db
              .select({ one: exerciseTags.tagId })
              .from(exerciseTags)
              .where(
                and(
                  eq(exerciseTags.exerciseId, exercises.id),
                  eq(exerciseTags.tagId, filter.tagId),
                ),
              ),
          ),
        );

  const setCount = count(mySets.id);
  // Sam literał liczbowy w ORDER BY SQLite czyta jako pozycję kolumny (1-indeks),
  // więc bez filtra po tagu ten człon trzeba pominąć zamiast podstawiać stałą.
  const isPrimaryMatch =
    filter.tagId == null
      ? null
      : sql`case when ${exercises.primaryTagId} = ${filter.tagId} then 0 else 1 end`;

  return db
    .select({
      id: exercises.id,
      name: exercises.name,
      translations: exercises.translations,
      loggingType: exercises.loggingType,
      gym: exercises.gym,
      authorId: exercises.authorId,
      tagId: exercises.primaryTagId,
      tagName: tags.name,
      tagTranslations: tags.translations,
      tagColor: tags.color,
      setCount,
      lastPerformedOn: max(mySets.performedOn),
    })
    .from(exercises)
    .innerJoin(tags, eq(tags.id, exercises.primaryTagId))
    .leftJoin(mySets, eq(mySets.exerciseId, exercises.id))
    .where(and(isNull(exercises.deletedAt), librarySourceCondition(filter.source ?? 'all'), tagged))
    .groupBy(exercises.id, tags.id)
    .orderBy(
      ...[isPrimaryMatch, desc(setCount), asc(exercises.name)].filter((term) => term != null),
    );
}

export type LibraryRow = Awaited<ReturnType<typeof exerciseLibrary>>[number];

/**
 * Tagi z licznikiem ćwiczeń — chipsy filtra biblioteki.
 *
 * Licznik obejmuje ćwiczenia, dla których tag jest główny **albo** dodatkowy,
 * czyli dokładnie to, co pokaże filtr po naciśnięciu chipsa. Tagi bez ani
 * jednego ćwiczenia też są na liście: dopiero co utworzony tag musi dać się
 * wybrać przy dodawaniu pierwszego ćwiczenia z tego obszaru.
 */
export function tagLibrary(db: SqliteDatabase) {
  // Przynależność ćwiczenia do tagu ma dwa źródła — tag główny i tagi dodatkowe
  // — więc liczymy ją z sumy obu zbiorów. `UNION` (a nie `UNION ALL`) odsiewa
  // ćwiczenie wskazujące ten sam tag dwa razy, choć schemat i tak na to nie
  // pozwala; kosztu nie ma, a wynik przestaje zależeć od tej gwarancji.
  //
  // Złączenie zamiast skorelowanego podzapytania jest tu **konieczne**: przy
  // zapytaniu z jedną tabelą Drizzle pomija kwalifikatory kolumn, więc
  // `tags.id` i `exercises.id` w podzapytaniu stałyby się tym samym `"id"`.
  const membership = union(
    db
      .select({ tagId: exercises.primaryTagId, exerciseId: exercises.id })
      .from(exercises)
      .where(isNull(exercises.deletedAt)),
    db
      .select({ tagId: exerciseTags.tagId, exerciseId: exerciseTags.exerciseId })
      .from(exerciseTags)
      .innerJoin(exercises, eq(exercises.id, exerciseTags.exerciseId))
      .where(isNull(exercises.deletedAt)),
  ).as('tag_membership');

  return db
    .select({
      id: tags.id,
      name: tags.name,
      translations: tags.translations,
      color: tags.color,
      exerciseCount: count(membership.exerciseId).as('exercise_count'),
    })
    .from(tags)
    .leftJoin(membership, eq(membership.tagId, tags.id))
    .where(isNull(tags.deletedAt))
    .groupBy(tags.id, tags.name, tags.translations, tags.color)
    .orderBy(asc(tags.name));
}

export type TagLibraryRow = Awaited<ReturnType<typeof tagLibrary>>[number];

/** Tagi dodatkowe jednego ćwiczenia, w kolejności zapisanej przy edycji. */
export function additionalTagsOf(db: SqliteDatabase, exerciseId: string) {
  return db
    .select({ id: tags.id, name: tags.name, translations: tags.translations, color: tags.color })
    .from(exerciseTags)
    .innerJoin(tags, eq(tags.id, exerciseTags.tagId))
    .where(eq(exerciseTags.exerciseId, exerciseId))
    .orderBy(asc(exerciseTags.position));
}

/**
 * Tagi dodatkowe wszystkich ćwiczeń naraz — do dopisania na listach
 * (biblioteka, wybór ćwiczenia), gdzie filtr po tagu obejmuje tag główny
 * **i** dodatkowe (patrz `exerciseLibrary`). Bez tego wiersz przefiltrowany po
 * „Triceps" pokazywał wyłącznie tag główny („Chest"), a nigdzie nie było
 * widać, że w ogóle dotyka tricepsów. Jedno zapytanie i grupowanie w JS-ie po
 * stronie ekranu jest tańsze niż `additionalTagsOf` na każdy wiersz listy.
 */
export function allAdditionalTags(db: SqliteDatabase) {
  return db
    .select({
      exerciseId: exerciseTags.exerciseId,
      tagId: tags.id,
      tagName: tags.name,
      tagTranslations: tags.translations,
      tagColor: tags.color,
    })
    .from(exerciseTags)
    .innerJoin(tags, eq(tags.id, exerciseTags.tagId))
    .orderBy(asc(exerciseTags.position));
}

export type AdditionalTagRow = Awaited<ReturnType<typeof allAdditionalTags>>[number];

/** Wiersz `allAdditionalTags` pogrupowany po ćwiczeniu, do doklejenia na listach. */
export function groupAdditionalTags(rows: readonly AdditionalTagRow[]): Map<string, NamedTag[]> {
  const byExercise = new Map<string, NamedTag[]>();
  for (const row of rows) {
    const list = byExercise.get(row.exerciseId) ?? [];
    list.push({
      id: row.tagId,
      name: row.tagName,
      translations: row.tagTranslations,
      color: row.tagColor,
    });
    byExercise.set(row.exerciseId, list);
  }
  return byExercise;
}

/** Tag w kształcie, w jakim pokazuje go ekran: z nazwą kanoniczną i tłumaczeniami. */
export interface NamedTag {
  id: string;
  name: string;
  translations: Translations | null;
  color: string;
}

export interface ExerciseTag extends NamedTag {
  /** Tylko tag główny liczy się do celów cyklu — reszta jest samą etykietą. */
  primary: boolean;
}

/**
 * Komplet tagów jednego ćwiczenia do pokazania na ekranie: główny na przedzie,
 * dodatkowe w kolejności zapisanej przy edycji.
 *
 * Powtórzenie tagu głównego wśród dodatkowych jest odrzucane. Formularz
 * ćwiczenia takiej pary nie pozwala ustawić, ale dane przychodzą też
 * synchronizacją z innego urządzenia i ze starszych wpisów — a dwa identyczne
 * chipsy obok siebie wyglądałyby jak błąd aplikacji.
 */
export function exerciseTagList(primary: NamedTag, additional: readonly NamedTag[]): ExerciseTag[] {
  return [
    { ...primary, primary: true },
    ...additional.filter((tag) => tag.id !== primary.id).map((tag) => ({ ...tag, primary: false })),
  ];
}

/* --------------------------------------------------------------------- cykle */

/**
 * Cykle użytkownika. Archiwalne są osobnym widokiem, a nie doklejką do listy
 * aktywnych — cykl zamknięty ogląda się rzadko i nie ma powodu, żeby zajmował
 * miejsce na ekranie, na który wchodzi się w trakcie treningu.
 */
export function cycleList(db: SqliteDatabase, userId: string, archived = false) {
  return db
    .select({
      id: cycles.id,
      name: cycles.name,
      startsOn: cycles.startsOn,
      endsOn: cycles.endsOn,
      archivedAt: cycles.archivedAt,
    })
    .from(cycles)
    .where(
      and(
        eq(cycles.userId, userId),
        isNull(cycles.deletedAt),
        archived ? isNotNull(cycles.archivedAt) : isNull(cycles.archivedAt),
      ),
    )
    .orderBy(asc(cycles.startsOn), asc(cycles.name));
}

export type CycleListRow = Awaited<ReturnType<typeof cycleList>>[number];

/**
 * Pozycje celu wszystkich żywych cykli użytkownika, z nazwami zakresu.
 *
 * Nazwy ćwiczenia i tagu są dołączane tutaj, bo pozycja celu bez nich jest
 * nieczytelna („12 czego?"), a doczytywanie ich osobno na ekranie oznaczałoby
 * drugie zapytanie na każdą pozycję.
 *
 * Razem z nimi jedzie tag główny ćwiczenia z pozycji. To po nim ekran wyboru
 * ćwiczenia oznacza gwiazdką filtr tagów: pozycja wskazująca „Ławkę" zostawia
 * robotę w tagu „chest", choć sama żadnego tagu nie wskazuje.
 */
export function cycleGoalList(db: SqliteDatabase, userId: string) {
  const goalTag = aliasedTable(tags, 'goal_tag');

  return db
    .select({
      id: cycleGoals.id,
      cycleId: cycleGoals.cycleId,
      metric: cycleGoals.metric,
      target: cycleGoals.target,
      exerciseId: cycleGoals.exerciseId,
      tagId: cycleGoals.tagId,
      position: cycleGoals.position,
      exerciseName: exercises.name,
      exerciseTranslations: exercises.translations,
      exercisePrimaryTagId: exercises.primaryTagId,
      tagName: goalTag.name,
      tagTranslations: goalTag.translations,
      tagColor: goalTag.color,
    })
    .from(cycleGoals)
    .innerJoin(cycles, eq(cycles.id, cycleGoals.cycleId))
    .leftJoin(exercises, eq(exercises.id, cycleGoals.exerciseId))
    .leftJoin(goalTag, eq(goalTag.id, cycleGoals.tagId))
    .where(and(eq(cycles.userId, userId), isNull(cycles.deletedAt)))
    .orderBy(asc(cycleGoals.cycleId), asc(cycleGoals.position));
}

export type CycleGoalRow = Awaited<ReturnType<typeof cycleGoalList>>[number];

/**
 * Nazwa zakresu pozycji celu — ćwiczenia albo tagu — w kształcie gotowym do
 * przetłumaczenia (`useLocalizedName`).
 *
 * Cel wskazuje **albo** ćwiczenie, **albo** tag, więc wybór jest tutaj, a nie na
 * trzech ekranach z osobna: cykl, lista cykli i formularz pokazują tę samą
 * pozycję i nie mają prawa nazwać jej różnie. `null` znaczy „ani jedno, ani
 * drugie" — pozycja wskazująca wiersz, którego lokalna baza jeszcze nie ma.
 */
export function goalTarget(
  row: Pick<
    CycleGoalRow,
    'exerciseName' | 'exerciseTranslations' | 'tagName' | 'tagTranslations'
  > | null,
): Translatable | null {
  if (row === null) return null;
  if (row.exerciseName !== null) {
    return { name: row.exerciseName, translations: row.exerciseTranslations };
  }
  if (row.tagName !== null) return { name: row.tagName, translations: row.tagTranslations };
  return null;
}

/**
 * Serie do liczenia postępu cykli — od wskazanego dnia w górę.
 *
 * Każdy wiersz niesie tag główny swojego ćwiczenia, bo to on rozstrzyga cele
 * tagowe. Dzięki temu postęp liczy się z jednego zapytania, bez dociągania
 * biblioteki obok. Dolna granica dnia jest po to, żeby ekran cykli nie czytał
 * całej historii treningowej — do celów i tak liczą się wyłącznie serie
 * z zakresów cykli.
 */
export function setsForCycles(db: SqliteDatabase, userId: string, from: IsoDate) {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      performedOn: workoutSets.performedOn,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
      primaryTagId: exercises.primaryTagId,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workoutSets.userId, userId),
        isNull(workoutSets.deletedAt),
        gte(workoutSets.performedOn, from),
      ),
    )
    .orderBy(asc(workoutSets.performedOn));
}

export type CycleSetRow = Awaited<ReturnType<typeof setsForCycles>>[number];

/** Konto właściciela urządzenia — nick pokazywany w nagłówku. */
export function localUser(db: SqliteDatabase, userId: string) {
  return db
    .select({ id: users.id, nickname: users.nickname, role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
}
