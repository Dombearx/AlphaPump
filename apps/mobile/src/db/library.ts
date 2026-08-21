/**
 * Słownik: tagi i ćwiczenia. Zapis lokalny, kolejka wysyłki, zero sieci.
 *
 * Wszystko tutaj musi działać offline — to jest wymaganie produktu.
 * Ćwiczenie utworzone w trybie samolotowym ma od razu istnieć w bibliotece,
 * dać się wybrać do serii i pojechać na serwer, gdy łączność wróci.
 *
 * Sercem tej możliwości są **deterministyczne identyfikatory** z `@alphapump/core`:
 * id tagu wynika ze sluga nazwy, id ćwiczenia z pary autor + slug nazwy. Dwa
 * telefony bez sieci, na których ktoś doda „Wyciskanie francuskie", wyliczą to
 * samo id i po synchronizacji zsumują się w jeden wiersz. Bez tego trzeba by
 * remapować identyfikatory po zapisie na serwerze, a więc przepinać serie, które
 * już na to ćwiczenie wskazują.
 *
 * Uprawnienia są sprawdzane także tutaj, mimo że pilnuje ich serwer. Powód jest
 * praktyczny: przy pracy offline odmowa z serwera przyszłaby po godzinach,
 * w formie odrzuconego wiersza w kolejce, a użytkownik dawno by o tej zmianie
 * zapomniał. Lepiej powiedzieć „nie" od razu.
 */

import {
  createExerciseInputSchema,
  createTagInputSchema,
  exerciseId as computeExerciseId,
  slug,
  tagColor,
  tagId as computeTagId,
  updateExerciseInputSchema,
  type LoggingType,
  type UserRole,
} from '@alphapump/core';
import {
  exerciseTags,
  exercises,
  tags,
  workoutSets,
  type ExerciseRow,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import { and, eq, isNull, ne } from 'drizzle-orm';
import { enqueue } from '../sync/outbox';
import { ExerciseNotFoundError } from './sets';
import { withTransaction } from './transaction';

/**
 * Kto zapisuje. Rola jest tu obok urządzenia, bo administrator może zmieniać
 * cudze ćwiczenia — a lokalna baza zna rolę właściciela telefonu z cache'u kont.
 */
export interface LibraryAuthor {
  userId: string;
  deviceId: string;
  role: UserRole;
}

/** Zapis, który mógł trafić w istniejący wiersz zamiast utworzyć nowy. */
export interface SavedRow {
  id: string;
  /** `false`, gdy wiersz o tym identyfikatorze już był — nic nie nadpisujemy. */
  created: boolean;
}

export class NotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotAllowedError';
  }
}

export class NameTakenError extends Error {
  constructor(name: string) {
    super(`You already have an exercise named "${name}"`);
    this.name = 'NameTakenError';
  }
}

/**
 * Ćwiczenie ma zapisane serie.
 *
 * Reguły pilnuje serwer, ale odmowa stamtąd przyszłaby dopiero przy
 * synchronizacji — jako odrzucony wiersz w kolejce, po którym ćwiczenie
 * wróciłoby do biblioteki bez wyjaśnienia. Lepiej powiedzieć „nie" od razu.
 *
 * Telefon widzi wyłącznie serie swojego właściciela, więc ten warunek jest
 * węższy niż serwerowy: ćwiczenie, na którym trenuje ktoś inny z grupy,
 * odrzuci dopiero push.
 */
export class ExerciseInUseError extends Error {
  constructor() {
    super('This exercise has logged sets. Delete the sets first, or ask an admin to merge it.');
    this.name = 'ExerciseInUseError';
  }
}

export class TagNotFoundError extends Error {
  constructor(tagId: string) {
    super(`No tag with ID ${tagId}`);
    this.name = 'TagNotFoundError';
  }
}

/** Tag główny wśród dodatkowych — ten sam warunek egzekwuje schemat i serwer. */
export class RepeatedTagError extends Error {
  constructor() {
    super('The primary tag cannot repeat among the additional tags');
    this.name = 'RepeatedTagError';
  }
}

function assertMayModify(exercise: ExerciseRow, author: LibraryAuthor): void {
  if (author.role === 'admin') return;
  if (exercise.authorId === author.userId) return;
  throw new NotAllowedError('Only its author or an admin can change this exercise');
}

/* ----------------------------------------------------------------------- tagi */

export interface CreateTagCommand extends LibraryAuthor {
  name: string;
}

/**
 * Dodaje tag albo oddaje ten, który już jest.
 *
 * Kolor nie jest losowany ani przydzielany przez serwer — wynika z nazwy, więc
 * tag utworzony offline ma od razu finalny kolor, identyczny na każdym
 * urządzeniu.
 */
export async function createTag(
  db: SqliteDatabase,
  command: CreateTagCommand,
  now: Date = new Date(),
): Promise<SavedRow> {
  const { name } = createTagInputSchema.parse({ name: command.name });
  const id = computeTagId(name);

  const [existing] = await db.select().from(tags).where(eq(tags.id, id)).limit(1);
  if (existing && existing.deletedAt === null) return { id, created: false };

  const values = {
    id,
    name,
    slug: slug(name),
    color: tagColor(name),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    deviceId: command.deviceId,
  };

  await withTransaction(db, async () => {
    await db.insert(tags).values(values).onConflictDoUpdate({ target: tags.id, set: values });
    await enqueue(db, 'tag', id, now);
  });

  return { id, created: true };
}

/** Rzuca, gdy któryś ze wskazanych tagów nie istnieje w bazie lokalnej. */
async function assertTagsExist(db: SqliteDatabase, tagIds: readonly string[]): Promise<void> {
  for (const id of new Set(tagIds)) {
    const [row] = await db.select({ id: tags.id }).from(tags).where(eq(tags.id, id)).limit(1);
    if (!row) throw new TagNotFoundError(id);
  }
}

/* ------------------------------------------------------------------ ćwiczenia */

export interface ExerciseValues {
  name: string;
  primaryTagId: string;
  additionalTagIds: string[];
  note: string | null;
  /**
   * Siłownia — opcjonalna, wchodzi w id **tylko przy tworzeniu** (patrz
   * `ids.ts`), tak samo jak nazwa. Późniejsza zmiana nie przelicza id, żeby nie
   * osierocić serii wskazujących na to ćwiczenie — więc przy edycji jest
   * zwykłym polem, tak jak notatka.
   */
  gym: string | null;
}

export interface CreateExerciseCommand extends LibraryAuthor, ExerciseValues {
  loggingType: LoggingType;
}

/**
 * Podmienia komplet tagów dodatkowych — tak samo jak robi to serwer i kod
 * zapisujący paczkę pullu. Różnicowanie zbioru dałoby ten sam wynik za cenę
 * trzeciego miejsca, w którym można się pomylić.
 */
async function replaceAdditionalTags(
  db: SqliteDatabase,
  exerciseId: string,
  tagIds: readonly string[],
): Promise<void> {
  await db.delete(exerciseTags).where(eq(exerciseTags.exerciseId, exerciseId));
  if (tagIds.length === 0) return;

  await db
    .insert(exerciseTags)
    .values(tagIds.map((tagId, position) => ({ exerciseId, tagId, position })));
}

/**
 * Dodaje ćwiczenie do wspólnej biblioteki.
 *
 * Gdy autor ma już żywe ćwiczenie o tej nazwie, nie nadpisujemy go — oddajemy
 * jego identyfikator z `created: false`. To jest ta sama odpowiedź, którą daje
 * serwer (200 zamiast 201), i to ona sprawia, że dwukrotne dodanie tej samej
 * nazwy jest nieszkodliwe zamiast wywracać zapis.
 */
export async function createExercise(
  db: SqliteDatabase,
  command: CreateExerciseCommand,
  now: Date = new Date(),
): Promise<SavedRow> {
  const input = createExerciseInputSchema.parse({
    name: command.name,
    loggingType: command.loggingType,
    primaryTagId: command.primaryTagId,
    additionalTagIds: command.additionalTagIds,
    note: command.note,
    gym: command.gym,
  });

  if (input.additionalTagIds.includes(input.primaryTagId)) throw new RepeatedTagError();
  await assertTagsExist(db, [input.primaryTagId, ...input.additionalTagIds]);

  const id = computeExerciseId(command.userId, input.name, input.gym);
  const [existing] = await db.select().from(exercises).where(eq(exercises.id, id)).limit(1);
  if (existing && existing.deletedAt === null) return { id, created: false };

  const values = {
    id,
    name: input.name,
    slug: slug(input.name),
    authorId: command.userId,
    loggingType: input.loggingType,
    primaryTagId: input.primaryTagId,
    note: input.note,
    gym: input.gym,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    deletedAt: null,
    deviceId: command.deviceId,
  };

  await withTransaction(db, async () => {
    await db
      .insert(exercises)
      .values(values)
      .onConflictDoUpdate({ target: exercises.id, set: values });
    await replaceAdditionalTags(db, id, input.additionalTagIds);
    await enqueue(db, 'exercise', id, now);
  });

  return { id, created: true };
}

export interface UpdateExerciseCommand extends LibraryAuthor, Partial<ExerciseValues> {
  exerciseId: string;
}

/**
 * Edycja ćwiczenia. Identyfikator **zostaje**, choć wylicza się z nazwy —
 * liczony jest wyłącznie przy tworzeniu, bo inaczej poprawienie literówki
 * osierociłoby wszystkie serie wskazujące na stare id.
 *
 * Typu logowania nie da się tu zmienić i nie jest to przeoczenie: historyczne
 * serie przestałyby pasować do własnego ćwiczenia.
 */
export async function updateExercise(
  db: SqliteDatabase,
  command: UpdateExerciseCommand,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadExercise(db, command.exerciseId);
  assertMayModify(existing, command);

  const input = updateExerciseInputSchema.parse({
    ...(command.name === undefined ? {} : { name: command.name }),
    ...(command.primaryTagId === undefined ? {} : { primaryTagId: command.primaryTagId }),
    ...(command.additionalTagIds === undefined
      ? {}
      : { additionalTagIds: command.additionalTagIds }),
    ...(command.note === undefined ? {} : { note: command.note }),
    ...(command.gym === undefined ? {} : { gym: command.gym }),
  });

  const name = input.name ?? existing.name;
  const primaryTagId = input.primaryTagId ?? existing.primaryTagId;
  const additionalTagIds = input.additionalTagIds;
  const gym = input.gym === undefined ? existing.gym : input.gym;
  if (additionalTagIds?.includes(primaryTagId) === true) throw new RepeatedTagError();
  await assertTagsExist(db, [primaryTagId, ...(additionalTagIds ?? [])]);

  const newSlug = slug(name);
  // Id nie zmienia się przy edycji (patrz komentarz funkcji), ale wiersz musi
  // dalej być jedyny w obrębie „nazwa + siłownia" tego autora — inaczej
  // zapis wywróciłby się dopiero na unikalności bazy, zamiast czytelnym błędem.
  if (newSlug !== existing.slug || gym !== existing.gym) {
    const [collision] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.authorId, existing.authorId),
          eq(exercises.slug, newSlug),
          gym === null ? isNull(exercises.gym) : eq(exercises.gym, gym),
          ne(exercises.id, existing.id),
        ),
      )
      .limit(1);
    if (collision) throw new NameTakenError(name);
  }

  await withTransaction(db, async () => {
    await db
      .update(exercises)
      .set({
        name,
        slug: newSlug,
        primaryTagId,
        note: input.note === undefined ? existing.note : input.note,
        gym,
        updatedAt: now,
        deviceId: command.deviceId,
      })
      .where(eq(exercises.id, existing.id));

    if (additionalTagIds !== undefined) {
      await replaceAdditionalTags(db, existing.id, additionalTagIds);
    }
    await enqueue(db, 'exercise', existing.id, now);
  });
}

/**
 * Usunięcie jest miękkie — wiersz zostaje z tombstonem. Dzięki temu zapisane
 * serie nie tracą tego, na co wskazują, a usunięcie wykonane offline ma jak
 * dojechać na drugie urządzenie.
 *
 * Ćwiczenie, na którym cokolwiek zapisano, nie daje się usunąć w ogóle — dla
 * właściciela serii ćwiczenie z tombstonem nie istnieje, więc jego seria
 * zostaje w dniu jako wpis bez nazwy. Duplikat scala administrator w panelu;
 * ćwiczenie z jedną serią wpisaną przez pomyłkę kasuje się po skasowaniu tej
 * serii.
 */
export async function deleteExercise(
  db: SqliteDatabase,
  exerciseId: string,
  author: LibraryAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadExercise(db, exerciseId);
  assertMayModify(existing, author);
  if (await hasLoggedSets(db, exerciseId)) throw new ExerciseInUseError();

  await withTransaction(db, async () => {
    await db
      .update(exercises)
      .set({ deletedAt: now, updatedAt: now, deviceId: author.deviceId })
      .where(eq(exercises.id, existing.id));
    await enqueue(db, 'exercise', existing.id, now);
  });
}

/** Czy w lokalnej bazie leży choć jedna żywa seria tego ćwiczenia. */
async function hasLoggedSets(db: SqliteDatabase, exerciseId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .where(and(eq(workoutSets.exerciseId, exerciseId), isNull(workoutSets.deletedAt)))
    .limit(1);

  return row !== undefined;
}

async function loadExercise(db: SqliteDatabase, exerciseId: string): Promise<ExerciseRow> {
  const [row] = await db.select().from(exercises).where(eq(exercises.id, exerciseId)).limit(1);
  if (!row || row.deletedAt !== null) throw new ExerciseNotFoundError(exerciseId);
  return row;
}
