/**
 * Schemat PostgreSQL — strona serwerowa.
 *
 * Różnice względem dialektu SQLite są celowe i sprowadzają się do trzech rzeczy:
 *
 * 1. **Użytkownicy.** Tu mieszka pełna tabela kont, zgodna z układem pól
 *    better-auth (etap 3 dokłada do niej sesje, konta OAuth i klucze API).
 *    Telefon trzyma jedynie okrojony cache użytkowników, bo potrzebuje nicków
 *    do rekordów globalnych, a nie danych logowania.
 * 2. **`server_seq`.** Na serwerze jest `NOT NULL` i nadawany z sekwencji — to
 *    on jest kursorem pobierania. Na telefonie bywa pusty, bo wiersz utworzony
 *    offline jeszcze go nie dostał.
 * 3. **Klucze obce do użytkowników.** Serwer je egzekwuje; telefon nie, bo
 *    kolejność przychodzenia wierszy w pullu nie jest gwarantowana.
 *
 * Reszta — tabele, kolumny, typy i sens pól — jest identyczna po obu stronach
 * i pilnuje tego test parzystości.
 */

import { GOAL_METRICS, LOGGING_TYPES, USER_ROLES } from '@alphapump/core';
import type { GoalMetric, IsoDate, LoggingType, RerankVerdict, UserRole } from '@alphapump/core';
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  pgSequence,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from 'drizzle-orm/pg-core';
import { EMBEDDING_DIMENSIONS, SERVER_SEQ_SEQUENCE } from '../tables.js';

/* ------------------------------------------------------------------ wspólne */

/**
 * Jedna sekwencja dla wszystkich tabel synchronizowanych. `nextval` jako
 * `DEFAULT` obsługuje wyłącznie wstawienie — przy każdej aktualizacji wiersza
 * serwer musi podbić `server_seq` jawnie, inaczej zmiana nie zostanie pobrana
 * przez klientów, których kursor jest już za nią.
 */
export const serverSeqSequence = pgSequence(SERVER_SEQ_SEQUENCE);

const nextServerSeq = sql`nextval('${sql.raw(SERVER_SEQ_SEQUENCE)}')`;

const syncColumns = () => ({
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  /** Tombstone. Wiersz usunięty nigdy nie znika — inaczej pull nie miałby czego przywieźć. */
  deletedAt: timestamp('deleted_at', { withTimezone: true, mode: 'date' }),
  serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(nextServerSeq),
  /**
   * Urządzenie, które zapisało ten wiersz jako ostatnie. Jedyne zastosowanie:
   * deterministyczne rozstrzygnięcie remisu `updated_at` przy LWW. Puste dla
   * zapisów, które przyszły zwykłym CRUD-em, a nie synchronizacją.
   */
  deviceId: text('device_id'),
});

/** `x IN ('a', 'b')` z listy stałych domenowych — wartości wchodzą do migracji. */
const oneOf = (column: string, values: readonly string[]) =>
  sql.raw(`"${column}" IN (${values.map((value) => `'${value}'`).join(', ')})`);

/* ---------------------------------------------------------------- użytkownik */

/**
 * Konto użytkownika.
 *
 * Układ pól odpowiada temu, czego oczekuje better-auth wraz z pluginem `admin`
 * (`role`, `banned`, `ban_reason`, `ban_expires`). `nickname` jest polem
 * dodatkowym: to on — a nie `name` — pokazuje się przy rekordach globalnych
 * i w rankingach, więc jest wymagany.
 */
export const users = pgTable(
  'users',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    /** Publiczny nick — jedyna dana osobowa wychodząca na zewnątrz przy rekordach. */
    nickname: text('nickname').notNull(),
    email: text('email').notNull(),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    role: text('role').$type<UserRole>().notNull().default('user'),
    banned: boolean('banned').notNull().default(false),
    banReason: text('ban_reason'),
    banExpires: timestamp('ban_expires', { withTimezone: true, mode: 'date' }),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
    /**
     * Konta też schodzą pullem — telefon potrzebuje nicków, żeby pokazać, czyje
     * jest ćwiczenie i czyj rekord globalny. Numer z tej samej sekwencji co
     * reszta, więc `GET /sync/pull?since=` dalej ma **jeden** kursor.
     */
    serverSeq: bigint('server_seq', { mode: 'number' }).notNull().default(nextServerSeq),
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    index('users_server_seq_idx').on(table.serverSeq),
    check('users_role_check', oneOf('role', USER_ROLES)),
  ],
);

/* ----------------------------------------------------------------------- tag */

/**
 * Tag jest bytem globalnym: id wylicza się z samego sluga, więc „biceps",
 * „Biceps" i „BICEPS" to jeden wiersz niezależnie od tego, kto go utworzył
 * i czy miał w tym momencie sieć.
 */
export const tags = pgTable(
  'tags',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    /** Wyliczany z hasha sluga — serwer nigdy go nie koryguje. */
    color: text('color').notNull(),
    ...syncColumns(),
  },
  (table) => [
    uniqueIndex('tags_slug_unique').on(table.slug),
    index('tags_server_seq_idx').on(table.serverSeq),
  ],
);

/* ----------------------------------------------------------------- ćwiczenie */

export const exercises = pgTable(
  'exercises',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    authorId: text('author_id')
      .notNull()
      .references(() => users.id),
    /** Ustalany raz przy tworzeniu; zmiana wymaga nowego ćwiczenia. */
    loggingType: text('logging_type').$type<LoggingType>().notNull(),
    /** Dokładnie jeden — to on decyduje o zaliczaniu serii do cykli tagowych. */
    primaryTagId: text('primary_tag_id')
      .notNull()
      .references(() => tags.id),
    note: text('note'),
    ...syncColumns(),
  },
  (table) => [
    /** Unikalność „nazwa + autor" ze specyfikacji; id i tak wylicza się z tej pary. */
    uniqueIndex('exercises_author_slug_unique').on(table.authorId, table.slug),
    index('exercises_primary_tag_idx').on(table.primaryTagId),
    index('exercises_server_seq_idx').on(table.serverSeq),
    /**
     * Warstwa leksykalna wykrywania duplikatów (etap 12). Indeks trigramowy po
     * slugu, a nie po nazwie: slug jest już znormalizowany — bez ogonków, bez
     * wielkich liter — więc „lawka" i „Ławka" trafiają w te same trigramy bez
     * dokładania `unaccent` do zapytania.
     */
    index('exercises_slug_trgm_idx').using('gin', sql`${table.slug} gin_trgm_ops`),
    /**
     * Druga połowa warstwy leksykalnej: dopasowanie **po słowach**, którego
     * trigramy nie dają — „sztanga lezac" ma trafić w „wyciskanie sztangi leżąc"
     * niezależnie od kolejności członów.
     *
     * Konfiguracja to `simple`, a nie polska, i jest to decyzja, nie
     * przeoczenie: PostgreSQL nie ma wbudowanego słownika polskiego, a dołożenie
     * ispella oznaczałoby pliki słowników na serwerze i różnicę między bazą
     * lokalną a produkcyjną. `simple` nie zna odmiany, ale wejściem jest slug —
     * już bez ogonków i wielkich liter — a odmianę i literówki łapie obok indeks
     * trigramowy. Formy takie jak „przysiad" i „przysiady" zbliża do siebie
     * właśnie on.
     */
    index('exercises_slug_fts_idx').using(
      'gin',
      sql`to_tsvector('simple', replace(${table.slug}, '-', ' '))`,
    ),
    check('exercises_logging_type_check', oneOf('logging_type', LOGGING_TYPES)),
  ],
);

/**
 * Tagi dodatkowe ćwiczenia.
 *
 * Osobna tabela, a nie tablica w wierszu, bo tagi są bytem współdzielonym i
 * chcemy po nich klucz obcy. Przy synchronizacji zestaw tagów jedzie razem
 * z ćwiczeniem i jest podmieniany w całości — dlatego wiersze tej tabeli nie
 * mają własnych kolumn synchronizacyjnych i kasują się kaskadowo.
 */
export const exerciseTags = pgTable(
  'exercise_tags',
  {
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    tagId: text('tag_id')
      .notNull()
      .references(() => tags.id),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    primaryKey({ name: 'exercise_tags_pk', columns: [table.exerciseId, table.tagId] }),
    index('exercise_tags_tag_idx').on(table.tagId),
  ],
);

/* --------------------------------------------------------------------- seria */

/**
 * Seria treningowa — podstawowa jednostka zapisu.
 *
 * Wszystkie pomiary są liczbami całkowitymi (gramy, powtórzenia, sekundy,
 * metry). Front Pareto porównuje wartości na równość, a na liczbach
 * zmiennoprzecinkowych „dokładny remis" — który zgodnie ze specyfikacją nie
 * pokazuje komunikatu o rekordzie — zaczynałby losowo wyskakiwać jako rekord.
 *
 * `performed_on` jest dniem kalendarzowym **bez strefy czasowej**, osobno od
 * `created_at`. Inaczej seria zapisana o 23:00 podczas wyjazdu wylądowałaby po
 * synchronizacji w innym dniu niż ten, w którym użytkownik ją wykonał.
 */
export const workoutSets = pgTable(
  'workout_sets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id),
    performedOn: date('performed_on', { mode: 'string' }).$type<IsoDate>().notNull(),
    /** Kolejność w obrębie dnia; użytkownik może ją zmieniać. */
    position: integer('position').notNull().default(0),
    weightG: integer('weight_g'),
    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: integer('distance_m'),
    /** Zapisywana przy ćwiczeniach na masę ciała, ale nieliczona do rekordów. */
    bodyweightG: integer('bodyweight_g'),
    note: text('note'),
    ...syncColumns(),
  },
  (table) => [
    index('workout_sets_user_day_idx').on(table.userId, table.performedOn),
    index('workout_sets_user_exercise_idx').on(table.userId, table.exerciseId),
    index('workout_sets_exercise_idx').on(table.exerciseId),
    index('workout_sets_server_seq_idx').on(table.serverSeq),
    check(
      'workout_sets_measurements_check',
      sql.raw(
        '"weight_g" >= 0 AND "reps" > 0 AND "duration_s" > 0 AND "distance_m" > 0 AND "bodyweight_g" >= 0',
      ),
    ),
    check('workout_sets_position_check', sql.raw('"position" >= 0')),
  ],
);

/* ---------------------------------------------------------------------- cykl */

export const cycles = pgTable(
  'cycles',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    /** Reset cyklu to przesunięcie tej daty — historia realizacji zostaje w seriach. */
    startsOn: date('starts_on', { mode: 'string' }).$type<IsoDate>().notNull(),
    endsOn: date('ends_on', { mode: 'string' }).$type<IsoDate>(),
    archivedAt: timestamp('archived_at', { withTimezone: true, mode: 'date' }),
    ...syncColumns(),
  },
  (table) => [
    index('cycles_user_idx').on(table.userId),
    index('cycles_server_seq_idx').on(table.serverSeq),
    check('cycles_range_check', sql.raw('"ends_on" IS NULL OR "ends_on" >= "starts_on"')),
  ],
);

/**
 * Pozycja celu cyklu.
 *
 * Wskazuje **albo** ćwiczenie, **albo** tag — nigdy oba i nigdy żadnego.
 * Pilnuje tego `cycle_goals_scope_check`, bo pozycja bez zakresu nie miałaby
 * czego zliczać, a z dwoma zakresami liczyłaby dwa razy.
 */
export const cycleGoals = pgTable(
  'cycle_goals',
  {
    id: text('id').primaryKey(),
    cycleId: text('cycle_id')
      .notNull()
      .references(() => cycles.id, { onDelete: 'cascade' }),
    metric: text('metric').$type<GoalMetric>().notNull(),
    /** Liczba serii, sekundy albo metry — zależnie od metryki. */
    target: integer('target').notNull(),
    exerciseId: text('exercise_id').references(() => exercises.id),
    tagId: text('tag_id').references(() => tags.id),
    position: integer('position').notNull().default(0),
  },
  (table) => [
    index('cycle_goals_cycle_idx').on(table.cycleId),
    check('cycle_goals_metric_check', oneOf('metric', GOAL_METRICS)),
    check('cycle_goals_target_check', sql.raw('"target" > 0')),
    check('cycle_goals_scope_check', sql.raw('("exercise_id" IS NULL) <> ("tag_id" IS NULL)')),
  ],
);

/* --------------------------------------------------- rekordy globalne (etap 11) */

/**
 * Rekord globalny ćwiczenia — front Pareto po seriach **wszystkich** użytkowników.
 *
 * Tabela jest cache'em, nie źródłem prawdy: w każdej chwili odtwarzalnym
 * z samych serii tym samym `computeRecords`, którym telefon liczy rekordy
 * indywidualne. Stoi tu z dwóch powodów, z których żaden nie jest wygodą:
 *
 * 1. Wyliczenie frontu wymaga serii **cudzych**, a te są prywatne — telefon nie
 *    ma ich i mieć nie będzie. Rekord globalny musi więc powstać na serwerze.
 * 2. Ranking „liczba rekordów" jest zliczeniem po tej tabeli. Bez niej trzeba by
 *    przy każdym pytaniu przeliczać front dla każdego ćwiczenia z osobna.
 *
 * Tabela nie jest synchronizowana i nie ma kolumn synchronizacyjnych — telefon
 * czyta rekordy globalne wyłącznie odczytem sieciowym, tak jak rankingi.
 * Przeliczenie jest wpięte w `POST /sync/push` oraz w CRUD serii i podmienia
 * komplet wierszy dotkniętego ćwiczenia (patrz `apps/api/src/derived/`).
 *
 * `ON DELETE CASCADE` na obu kluczach jest tu istotny: twarde usunięcie serii
 * przez porządkowanie tombstone'ów nie może zostawić rekordu wskazującego na
 * nieistniejący wiersz.
 */
export const exerciseRecords = pgTable(
  'exercise_records',
  {
    exerciseId: text('exercise_id')
      .notNull()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    setId: text('set_id')
      .notNull()
      .references(() => workoutSets.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id),
    performedOn: date('performed_on', { mode: 'string' }).$type<IsoDate>().notNull(),
    /** Miejsce na froncie po posortowaniu malejąco po osiach — kolejność prezentacji. */
    position: integer('position').notNull().default(0),
    weightG: integer('weight_g'),
    reps: integer('reps'),
    durationS: integer('duration_s'),
    distanceM: integer('distance_m'),
    note: text('note'),
    /** Kiedy front był ostatnio przeliczany — jedyna informacja diagnostyczna. */
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    primaryKey({ name: 'exercise_records_pk', columns: [table.exerciseId, table.setId] }),
    index('exercise_records_exercise_idx').on(table.exerciseId, table.position),
    /** Ranking „liczba rekordów" to zliczenie po tym indeksie. */
    index('exercise_records_user_idx').on(table.userId),
  ],
);

/* ------------------------------------- warstwa semantyczna (etap 12) --------- */

/**
 * Embedding nazwy ćwiczenia — warstwa 2 wykrywania duplikatów.
 *
 * Tabela istnieje wyłącznie po stronie serwera i **nie jest synchronizowana**:
 * telefon liczy podobieństwo po pisowni (warstwa 1) i nie ma czym ani po co
 * liczyć wektorów. Nie ma tu więc kolumn synchronizacyjnych i nie ma
 * odpowiednika w schemacie SQLite — jest to różnica świadoma, nie przeoczenie.
 *
 * Trzy decyzje warte zapisania:
 *
 * 1. **Osobna tabela, nie kolumna w `exercises`.** Embedding jest danymi
 *    pochodnymi, przeliczalnymi z nazwy — a `exercises` jedzie w każdym pullu.
 *    Wektor o tysiącu wymiarów w wierszu synchronizowanym byłby ładowany za
 *    każdym odczytem biblioteki i wysyłany na telefon, który go nie użyje.
 * 2. **Wymiar jest stały (`EMBEDDING_DIMENSIONS`).** pgvector potrafi trzymać
 *    wektory o dowolnym wymiarze, ale indeks HNSW wymaga wymiaru znanego
 *    w schemacie. Zmiana modelu na taki o innym wymiarze jest więc migracją,
 *    a nie zmianą konfiguracji — i dobrze, bo wektory ze dwóch różnych modeli
 *    nie są porównywalne niezależnie od tego, czy mają ten sam wymiar.
 * 3. **`model` w wierszu.** Bez tego po zmianie modelu nie dałoby się odróżnić
 *    wektorów starych od nowych, a wyszukiwanie po wymieszanych przestrzeniach
 *    daje wyniki, które wyglądają poprawnie i nie są.
 *
 * `ON DELETE CASCADE` jest tu istotny: twarde usunięcie ćwiczenia przez
 * porządkowanie tombstone'ów nie może zostawić wektora wskazującego w próżnię.
 */
export const exerciseEmbeddings = pgTable(
  'exercise_embeddings',
  {
    exerciseId: text('exercise_id')
      .primaryKey()
      .references(() => exercises.id, { onDelete: 'cascade' }),
    /** Identyfikator modelu z OpenRouter — patrz komentarz tabeli. */
    model: text('model').notNull(),
    /** Tekst, z którego policzono wektor: nazwa ćwiczenia i jego tag główny. */
    source: text('source').notNull(),
    embedding: vector('embedding', { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true, mode: 'date' })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * HNSW po odległości kosinusowej. Przy bibliotece rzędu setek wierszy
     * skanowanie sekwencyjne byłoby równie szybkie — indeks stoi tu dlatego, że
     * jego dołożenie później wymaga przestoju na przebudowę, a teraz jest darmowe.
     */
    index('exercise_embeddings_hnsw_idx').using('hnsw', table.embedding.op('vector_cosine_ops')),
  ],
);

/**
 * Cache odpowiedzi re-rankera — warstwa 3 wykrywania duplikatów.
 *
 * Model generatywny kosztuje więcej i odpowiada sekundy, a pytanie „czy «martwy
 * ciąg» to duplikat czegoś w bibliotece" jest przy tworzeniu ćwiczenia zadawane
 * wielokrotnie, w trakcie pisania nazwy. Odpowiedź zależy jednak od dwóch
 * rzeczy, nie od jednej: od zapytania **i** od zestawu kandydatów. Dlatego
 * kluczem jest para slug + odcisk zestawu kandydatów — sam slug dawałby po
 * dodaniu nowego ćwiczenia werdykt nieaktualny, którego nic by nie unieważniło.
 *
 * Wpis jest usuwalny w każdej chwili bez konsekwencji: brak cache'u znaczy
 * tylko, że model zostanie zapytany ponownie.
 */
export const duplicateCheckCache = pgTable(
  'duplicate_check_cache',
  {
    /** Slug nazwy, o którą pytano — normalizacja ta sama, z której liczy się id. */
    querySlug: text('query_slug').notNull(),
    /** Odcisk zestawu kandydatów; zmiana zestawu unieważnia wpis. */
    candidatesFingerprint: text('candidates_fingerprint').notNull(),
    /** Model, który wydał werdykty. Zmiana modelu unieważnia wpis. */
    model: text('model').notNull(),
    verdicts: jsonb('verdicts').$type<RerankVerdict[]>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({
      name: 'duplicate_check_cache_pk',
      columns: [table.querySlug, table.candidatesFingerprint, table.model],
    }),
    /** Po tym indeksie idzie porządkowanie wpisów starszych niż okno retencji. */
    index('duplicate_check_cache_created_idx').on(table.createdAt),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type TagRow = typeof tags.$inferSelect;
export type ExerciseRow = typeof exercises.$inferSelect;
export type ExerciseTagRow = typeof exerciseTags.$inferSelect;
export type WorkoutSetRow = typeof workoutSets.$inferSelect;
export type CycleRow = typeof cycles.$inferSelect;
export type CycleGoalRow = typeof cycleGoals.$inferSelect;
export type ExerciseRecordRow = typeof exerciseRecords.$inferSelect;
export type ExerciseEmbeddingRow = typeof exerciseEmbeddings.$inferSelect;
export type DuplicateCheckCacheRow = typeof duplicateCheckCache.$inferSelect;
