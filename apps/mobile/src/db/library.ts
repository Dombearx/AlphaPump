/**
 * Słownik: tagi i ćwiczenia. Zapis lokalny, kolejka wysyłki, zero sieci.
 *
 * Wszystko tutaj musi działać offline — to jest kryterium ukończenia etapu 8.
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
  type ExerciseRow,
  type SqliteDatabase,
} from '@alphapump/db/sqlite';
import { and, eq, ne } from 'drizzle-orm';
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
    super(`Masz już ćwiczenie o nazwie „${name}"`);
    this.name = 'NameTakenError';
  }
}

export class TagNotFoundError extends Error {
  constructor(tagId: string) {
    super(`Nie ma tagu o identyfikatorze ${tagId}`);
    this.name = 'TagNotFoundError';
  }
}

/** Tag główny wśród dodatkowych — ten sam warunek egzekwuje schemat i serwer. */
export class RepeatedTagError extends Error {
  constructor() {
    super('Tag główny nie może powtarzać się wśród tagów dodatkowych');
    this.name = 'RepeatedTagError';
  }
}

function assertMayModify(exercise: ExerciseRow, author: LibraryAuthor): void {
  if (author.role === 'admin') return;
  if (exercise.authorId === author.userId) return;
  throw new NotAllowedError('Ćwiczenie może zmieniać wyłącznie jego autor albo administrator');
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
  });

  if (input.additionalTagIds.includes(input.primaryTagId)) throw new RepeatedTagError();
  await assertTagsExist(db, [input.primaryTagId, ...input.additionalTagIds]);

  const id = computeExerciseId(command.userId, input.name);
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
  });

  const name = input.name ?? existing.name;
  const primaryTagId = input.primaryTagId ?? existing.primaryTagId;
  const additionalTagIds = input.additionalTagIds;
  if (additionalTagIds?.includes(primaryTagId) === true) throw new RepeatedTagError();
  await assertTagsExist(db, [primaryTagId, ...(additionalTagIds ?? [])]);

  const newSlug = slug(name);
  if (newSlug !== existing.slug) {
    const [collision] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.authorId, existing.authorId),
          eq(exercises.slug, newSlug),
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
 */
export async function deleteExercise(
  db: SqliteDatabase,
  exerciseId: string,
  author: LibraryAuthor,
  now: Date = new Date(),
): Promise<void> {
  const existing = await loadExercise(db, exerciseId);
  assertMayModify(existing, author);

  await withTransaction(db, async () => {
    await db
      .update(exercises)
      .set({ deletedAt: now, updatedAt: now, deviceId: author.deviceId })
      .where(eq(exercises.id, existing.id));
    await enqueue(db, 'exercise', existing.id, now);
  });
}

async function loadExercise(db: SqliteDatabase, exerciseId: string): Promise<ExerciseRow> {
  const [row] = await db.select().from(exercises).where(eq(exercises.id, exerciseId)).limit(1);
  if (!row || row.deletedAt !== null) throw new ExerciseNotFoundError(exerciseId);
  return row;
}
