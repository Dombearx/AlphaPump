/**
 * Przyjęcie paczki mutacji z telefonu.
 *
 * ## Dlaczego jeden wiersz nie może wywrócić paczki
 *
 * Outbox na telefonie jest kolejką: dopóki wpis z niej nie zejdzie, nic za nim
 * nie pojedzie. Gdyby jeden odrzucony wiersz kończył całe żądanie błędem, jedna
 * zatruta mutacja zatrzymałaby synchronizację urządzenia **na zawsze**. Dlatego
 * każdy wiersz jest rozstrzygany osobno, a odpowiedź niesie wynik dla każdego
 * z osobna — kolejka rusza dalej, a użytkownik nie ląduje w martwym punkcie.
 *
 * ## Dlaczego odpowiedź zwraca wiersze
 *
 * Wiersz, który przegrał LWW, nie dostaje nowego `server_seq` — jego numer jest
 * już za kursorem telefonu, więc pull nigdy go nie przywiezie i urządzenie
 * zostałoby ze swoją przegraną wersją na zawsze. Push oddaje więc stan
 * serwerowy dla **każdego** wiersza z paczki, w tym samym kształcie, w jakim
 * robi to pull. Dotyczy to też wierszy przyjętych: serwer przycina znaczniki
 * z przyszłości, więc przyjęty wiersz też potrafi wrócić inny, niż pojechał.
 *
 * ## Kolejność encji
 *
 * Tagi → ćwiczenia → cykle → serie, czyli od bytów niezależnych do zależnych.
 * Dzięki temu jedna paczka może przywieźć nowy tag, nowe ćwiczenie z tym tagiem
 * i serię tego ćwiczenia — a to jest dokładnie scenariusz „wymyśliłem nowe
 * ćwiczenie na siłowni bez zasięgu".
 */

import {
  clampRevision,
  exerciseId as deterministicExerciseId,
  isWrite,
  resolveSyncConflict,
  setInputSchemaFor,
  slug,
  SYSTEM_USER_ID,
  tagColor,
  tagId as deterministicTagId,
  type SyncChanges,
  type SyncDecision,
  type SyncEntity,
  type SyncPushRequest,
  type SyncResult,
  type SyncRevision,
} from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Principal } from '../context.js';
import type { Database } from '../db.js';
import { EXERCISE_IN_USE_MESSAGE, isExerciseInUse } from '../exercise-usage.js';
import { cycleGoals, cycles, exerciseTags, exercises, tags, workoutSets } from '../schema.js';
import { nextServerSeq } from '../sync-columns.js';
import { TAG_IN_USE_MESSAGE, isTagInUse } from '../tag-usage.js';
import { emptyScope, noteAffectedSet, type AffectedScope } from './derived.js';
import {
  revisionOf,
  toSyncedCycleDto,
  toSyncedExerciseDto,
  toSyncedSetDto,
  toSyncedTagDto,
} from './rows.js';

export interface PushOutcome {
  /**
   * Najwyższy `server_seq` nadany w tej paczce; `0`, gdy nic nie weszło.
   * Nie jest kursorem pullu — patrz `syncPushResponseSchema` w rdzeniu.
   */
  cursor: number;
  results: SyncResult[];
  changes: SyncChanges;
  /** Ćwiczenia dotknięte zapisem serii — wejście do przeliczeń pochodnych. */
  scope: AffectedScope;
}

/** Pola, po których jedzie rozstrzyganie konfliktu, wyjęte z wiersza paczki. */
function incomingRevision(
  row: { createdAt: string; updatedAt: string; deletedAt: string | null },
  deviceId: string,
): SyncRevision {
  return { ...row, deviceId };
}

/** Znacznik zapisu wiersza przyjętego z synchronizacji. */
function stampFrom(revision: SyncRevision, deviceId: string) {
  return {
    createdAt: new Date(revision.createdAt),
    updatedAt: new Date(revision.updatedAt),
    deletedAt: revision.deletedAt === null ? null : new Date(revision.deletedAt),
    deviceId,
    serverSeq: nextServerSeq(),
  };
}

export async function applyPush(
  db: Database,
  principal: Principal,
  request: SyncPushRequest,
  now: Date,
): Promise<PushOutcome> {
  const { deviceId } = request;
  const results: SyncResult[] = [];
  const changes: SyncChanges = { users: [], tags: [], exercises: [], cycles: [], sets: [] };
  const scope = emptyScope();
  let cursor = 0;

  const record = (entity: SyncEntity, id: string, decision: SyncDecision, reason?: string) => {
    results.push({ entity, id, decision, reason: reason ?? null });
  };

  const advance = (serverSeq: number) => {
    if (serverSeq > cursor) cursor = serverSeq;
  };

  const isAdmin = principal.role === 'admin';

  /* -------------------------------------------------------------------- tagi */

  for (const incoming of request.tags) {
    const revision = clampRevision(incomingRevision(incoming, deviceId), now);
    const [existing] = await db.select().from(tags).where(eq(tags.id, incoming.id)).limit(1);
    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    const emit = (final: SyncDecision, reason?: string) => {
      record('tag', incoming.id, final, reason);
      if (existing && !isWrite(final)) changes.tags.push(toSyncedTagDto(existing));
    };

    // Tworzyć tagi może każdy, zmieniać i usuwać wyłącznie administrator —
    // tak jak w zwykłym CRUD-zie. Synchronizacja nie jest tylnym wejściem.
    if (!isAdmin && (decision === 'update' || decision === 'delete')) {
      emit('rejected', 'Tag może zmieniać wyłącznie administrator');
      continue;
    }

    if (!isWrite(decision)) {
      emit(decision);
      continue;
    }

    const name = incoming.name;
    const newSlug = slug(name);

    // „Usunięcie tagu używanego przez ćwiczenia jest zabronione" obowiązuje tak
    // samo tutaj, jak przy `DELETE /tags/:id`. Bez tego push byłby wejściem,
    // przez które reguła nie obowiązuje, a ćwiczenia zostałyby z tagiem, którego
    // dla użytkownika już nie ma.
    if (decision === 'delete' && (await isTagInUse(db, incoming.id))) {
      emit('rejected', TAG_IN_USE_MESSAGE);
      continue;
    }

    if (decision !== 'delete') {
      // Tag jest bytem globalnym i jego identyfikator wynika ze sluga nazwy.
      // Wiersz z tym samym slugiem, ale innym id, oznacza klienta, który zbudował
      // identyfikator inaczej — przyjęcie go rozbiłoby globalną deduplikację.
      const [collision] = await db
        .select()
        .from(tags)
        .where(and(eq(tags.slug, newSlug), ne(tags.id, incoming.id)))
        .limit(1);
      if (collision) {
        record('tag', incoming.id, 'rejected', `Tag „${name}" istnieje pod innym identyfikatorem`);
        changes.tags.push(toSyncedTagDto(collision));
        continue;
      }
      // Identyfikator wynika z nazwy **przy tworzeniu** i tylko wtedy jest
      // sprawdzany — dokładnie jak przy ćwiczeniach. Zmiana nazwy tagu zostawia
      // id nietknięte (inaczej poprawienie literówki osierociłoby ćwiczenia),
      // więc żądanie tej zgodności od edycji odrzucałoby każdy późniejszy zapis
      // raz przemianowanego tagu.
      if (decision === 'insert' && incoming.id !== deterministicTagId(name)) {
        record('tag', incoming.id, 'rejected', 'Identyfikator tagu nie wynika z jego nazwy');
        continue;
      }
    }

    const stamp = stampFrom(revision, deviceId);
    const [row] =
      decision === 'delete'
        ? await db
            .update(tags)
            .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
            .where(eq(tags.id, incoming.id))
            .returning()
        : decision === 'update'
          ? await db
              .update(tags)
              .set({
                name,
                slug: newSlug,
                color: tagColor(name),
                updatedAt: stamp.updatedAt,
                deletedAt: null,
                ...writeStamp(stamp),
              })
              .where(eq(tags.id, incoming.id))
              .returning()
          : await db
              .insert(tags)
              .values({ id: incoming.id, name, slug: newSlug, color: tagColor(name), ...stamp })
              .onConflictDoUpdate({
                target: tags.id,
                set: { name, slug: newSlug, color: tagColor(name), ...stamp },
              })
              .returning();

    changes.tags.push(toSyncedTagDto(row!));
    advance(row!.serverSeq);
    record('tag', incoming.id, decision);
  }

  /* --------------------------------------------------------------- ćwiczenia */

  for (const incoming of request.exercises) {
    const revision = clampRevision(incomingRevision(incoming, deviceId), now);
    const [existing] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, incoming.id))
      .limit(1);
    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    const currentTagIds = async () => {
      const rows = await db
        .select()
        .from(exerciseTags)
        .where(eq(exerciseTags.exerciseId, incoming.id))
        .orderBy(asc(exerciseTags.position));
      return rows.map((row) => row.tagId);
    };

    const reject = async (reason: string) => {
      record('exercise', incoming.id, 'rejected', reason);
      if (existing) changes.exercises.push(toSyncedExerciseDto(existing, await currentTagIds()));
    };

    // Ćwiczenie może zmieniać wyłącznie jego autor albo administrator. Bez tego
    // wspólna biblioteka wchodzi w problemy rodem z wiki, a samo LWW przestaje
    // wystarczać do rozstrzygania konfliktów.
    //
    // Jeden wyjątek: **wstawienie** brakującego ćwiczenia wbudowanego. Telefon
    // ma bibliotekę wbudowaną z własnego seeda od pierwszego uruchomienia i jest
    // to jedyny zbiór wierszy, które legalnie zna, a których serwer może nie
    // mieć — cudze ćwiczenia trafiają na urządzenie wyłącznie pullem, czyli już
    // po zapisaniu ich na serwerze. Odrzucanie takiego wiersza kosztowałoby
    // serie: seria wskazująca na nieistniejące ćwiczenie też zostaje odrzucona,
    // a odrzucone wpisy schodzą telefonowi z kolejki.
    //
    // Podszycie się pod konto systemowe nie wchodzi w grę, bo identyfikator
    // wiersza musi wynikać z pary autor + nazwa (+ siłownia) — sprawdza to
    // niżej ta sama reguła, co dla ćwiczeń własnych. Autoryzacja zostaje więc
    // nietknięta tam, gdzie ma znaczenie: **istniejącego** wiersza konta
    // systemowego dalej nie ruszy nikt poza administratorem, a wyjątek dotyczy
    // wyłącznie wiersza żywego — tombstone brakującego ćwiczenia wbudowanego
    // znaczyłby „skasuj z biblioteki coś, czego serwer nigdy nie miał".
    const authorId = existing?.authorId ?? incoming.authorId;
    const missingBuiltIn =
      !existing && incoming.authorId === SYSTEM_USER_ID && incoming.deletedAt === null;
    if (!isAdmin && !missingBuiltIn && authorId !== principal.id) {
      await reject('Ćwiczenie może zmieniać wyłącznie jego autor albo administrator');
      continue;
    }

    if (!isWrite(decision)) {
      record('exercise', incoming.id, decision);
      if (existing) changes.exercises.push(toSyncedExerciseDto(existing, await currentTagIds()));
      continue;
    }

    if (decision === 'delete') {
      // „Ćwiczenia z zapisanymi seriami nie da się usunąć" obowiązuje tak samo
      // tutaj, jak przy `DELETE /exercises/:id`. Telefon zna wyłącznie serie
      // swojego właściciela, więc tombstone potrafi tu przyjechać dla ćwiczenia,
      // na którym trenuje ktoś inny — odrzucenie oddaje wtedy wiersz serwerowy
      // i ćwiczenie wraca na urządzenie, które je u siebie skasowało.
      if (await isExerciseInUse(db, incoming.id)) {
        await reject(EXERCISE_IN_USE_MESSAGE);
        continue;
      }

      const stamp = stampFrom(revision, deviceId);
      const [row] = await db
        .update(exercises)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(exercises.id, incoming.id))
        .returning();
      changes.exercises.push(toSyncedExerciseDto(row!, await currentTagIds()));
      advance(row!.serverSeq);
      record('exercise', incoming.id, decision);
      continue;
    }

    // Typ logowania jest ustalany raz przy tworzeniu. Zmiana osierociłaby
    // historyczne serie, które przestałyby pasować do własnego ćwiczenia.
    if (existing && incoming.loggingType !== existing.loggingType) {
      await reject('Typ logowania ćwiczenia jest nieedytowalny');
      continue;
    }

    const wantedTagIds = [incoming.primaryTagId, ...incoming.additionalTagIds];
    if (new Set(wantedTagIds).size !== wantedTagIds.length) {
      await reject('Tag główny nie może powtarzać się wśród tagów dodatkowych');
      continue;
    }
    const missingTags = await findMissing(db, tags.id, wantedTagIds);
    if (missingTags.length > 0) {
      await reject(`Nie ma takich tagów: ${missingTags.join(', ')}`);
      continue;
    }

    const newSlug = slug(incoming.name);
    if (
      decision === 'insert' &&
      incoming.id !== deterministicExerciseId(authorId, incoming.name, incoming.gym)
    ) {
      await reject('Identyfikator ćwiczenia nie wynika z pary autor + nazwa (+ siłownia)');
      continue;
    }
    const [collision] = await db
      .select({ id: exercises.id })
      .from(exercises)
      .where(
        and(
          eq(exercises.authorId, authorId),
          eq(exercises.slug, newSlug),
          incoming.gym === null ? isNull(exercises.gym) : eq(exercises.gym, incoming.gym),
          ne(exercises.id, incoming.id),
        ),
      )
      .limit(1);
    if (collision) {
      await reject('Autor ma już ćwiczenie o takiej nazwie');
      continue;
    }

    const stamp = stampFrom(revision, deviceId);
    const values = {
      id: incoming.id,
      name: incoming.name,
      slug: newSlug,
      authorId,
      loggingType: existing?.loggingType ?? incoming.loggingType,
      primaryTagId: incoming.primaryTagId,
      note: incoming.note,
      gym: incoming.gym,
    };

    const row = await db.transaction(async (tx) => {
      const [written] =
        decision === 'update'
          ? await tx
              .update(exercises)
              .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
              .where(eq(exercises.id, incoming.id))
              .returning()
          : await tx
              .insert(exercises)
              .values({ ...values, ...stamp })
              .onConflictDoUpdate({ target: exercises.id, set: { ...values, ...stamp } })
              .returning();

      // Zestaw tagów dodatkowych jedzie z ćwiczeniem i jest podmieniany
      // w całości — nie ma sensu synchronizować go wiersz po wierszu.
      await tx.delete(exerciseTags).where(eq(exerciseTags.exerciseId, incoming.id));
      if (incoming.additionalTagIds.length > 0) {
        await tx.insert(exerciseTags).values(
          incoming.additionalTagIds.map((tagId, position) => ({
            exerciseId: incoming.id,
            tagId,
            position,
          })),
        );
      }
      return written!;
    });

    changes.exercises.push(toSyncedExerciseDto(row, incoming.additionalTagIds));
    advance(row.serverSeq);
    record('exercise', incoming.id, decision);
  }

  /* -------------------------------------------------------------------- cykle */

  for (const incoming of request.cycles) {
    const revision = clampRevision(incomingRevision(incoming, deviceId), now);
    const [existing] = await db.select().from(cycles).where(eq(cycles.id, incoming.id)).limit(1);

    const currentGoals = async () =>
      db
        .select()
        .from(cycleGoals)
        .where(eq(cycleGoals.cycleId, incoming.id))
        .orderBy(asc(cycleGoals.position));

    // Cykl jest prywatny. Cudzego nie pokazujemy nawet w komunikacie błędu.
    if (existing && existing.userId !== principal.id) {
      record('cycle', incoming.id, 'rejected', 'Cykl należy do innego użytkownika');
      continue;
    }

    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    if (!isWrite(decision)) {
      record('cycle', incoming.id, decision);
      if (existing) changes.cycles.push(toSyncedCycleDto(existing, await currentGoals()));
      continue;
    }

    if (decision === 'delete') {
      const stamp = stampFrom(revision, deviceId);
      const [row] = await db
        .update(cycles)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(cycles.id, incoming.id))
        .returning();
      changes.cycles.push(toSyncedCycleDto(row!, await currentGoals()));
      advance(row!.serverSeq);
      record('cycle', incoming.id, decision);
      continue;
    }

    const goalExerciseIds = incoming.goals
      .map((goal) => goal.exerciseId)
      .filter((id): id is string => id !== null);
    const goalTagIds = incoming.goals
      .map((goal) => goal.tagId)
      .filter((id): id is string => id !== null);
    const missing = [
      ...(await findMissing(db, exercises.id, goalExerciseIds)),
      ...(await findMissing(db, tags.id, goalTagIds)),
    ];
    if (missing.length > 0) {
      record(
        'cycle',
        incoming.id,
        'rejected',
        `Cel wskazuje na nieznane byty: ${missing.join(', ')}`,
      );
      if (existing) changes.cycles.push(toSyncedCycleDto(existing, await currentGoals()));
      continue;
    }

    const stamp = stampFrom(revision, deviceId);
    const values = {
      id: incoming.id,
      userId: principal.id,
      name: incoming.name,
      startsOn: incoming.startsOn,
      endsOn: incoming.endsOn,
      archivedAt: incoming.archivedAt === null ? null : new Date(incoming.archivedAt),
    };

    const row = await db.transaction(async (tx) => {
      const [written] =
        decision === 'update'
          ? await tx
              .update(cycles)
              .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
              .where(eq(cycles.id, incoming.id))
              .returning()
          : await tx
              .insert(cycles)
              .values({ ...values, ...stamp })
              .onConflictDoUpdate({ target: cycles.id, set: { ...values, ...stamp } })
              .returning();

      await tx.delete(cycleGoals).where(eq(cycleGoals.cycleId, incoming.id));
      await tx.insert(cycleGoals).values(
        incoming.goals.map((goal, position) => ({
          id: goal.id,
          cycleId: incoming.id,
          metric: goal.metric,
          target: goal.target,
          exerciseId: goal.exerciseId,
          tagId: goal.tagId,
          position,
        })),
      );
      return written!;
    });

    changes.cycles.push(toSyncedCycleDto(row, await currentGoals()));
    advance(row.serverSeq);
    record('cycle', incoming.id, decision);
  }

  /* -------------------------------------------------------------------- serie */

  for (const incoming of request.sets) {
    const revision = clampRevision(incomingRevision(incoming, deviceId), now);
    const [existing] = await db
      .select()
      .from(workoutSets)
      .where(eq(workoutSets.id, incoming.id))
      .limit(1);

    // Serie są prywatne — także administrator nie dotyka cudzej historii.
    if (existing && existing.userId !== principal.id) {
      record('set', incoming.id, 'rejected', 'Seria należy do innego użytkownika');
      continue;
    }

    const decision = resolveSyncConflict(existing ? revisionOf(existing) : null, revision);

    if (!isWrite(decision)) {
      record('set', incoming.id, decision);
      if (existing) changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    if (decision === 'delete') {
      const stamp = stampFrom(revision, deviceId);
      const [row] = await db
        .update(workoutSets)
        .set({ updatedAt: stamp.updatedAt, deletedAt: stamp.deletedAt, ...writeStamp(stamp) })
        .where(eq(workoutSets.id, incoming.id))
        .returning();
      changes.sets.push(toSyncedSetDto(row!));
      advance(row!.serverSeq);
      noteAffectedSet(scope, principal.id, row!.exerciseId);
      record('set', incoming.id, decision);
      continue;
    }

    const [exercise] = await db
      .select()
      .from(exercises)
      .where(eq(exercises.id, incoming.exerciseId))
      .limit(1);
    if (!exercise) {
      record('set', incoming.id, 'rejected', 'Ćwiczenie serii nie istnieje');
      if (existing) changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    // Pomiary są walidowane względem typu logowania **ćwiczenia**, a nie samego
    // ciała żądania: dystans przy wyciskaniu sztangi nie ma jak się prześlizgnąć.
    const measurements = setInputSchemaFor(exercise.loggingType).safeParse({
      exerciseId: incoming.exerciseId,
      performedOn: incoming.performedOn,
      weightG: incoming.weightG,
      reps: incoming.reps,
      durationS: incoming.durationS,
      distanceM: incoming.distanceM,
      bodyweightG: incoming.bodyweightG,
      note: incoming.note,
    });
    if (!measurements.success) {
      record(
        'set',
        incoming.id,
        'rejected',
        `Pomiary nie pasują do typu logowania ${exercise.loggingType}`,
      );
      if (existing) changes.sets.push(toSyncedSetDto(existing));
      continue;
    }

    const stamp = stampFrom(revision, deviceId);
    const values = {
      id: incoming.id,
      userId: principal.id,
      exerciseId: incoming.exerciseId,
      performedOn: incoming.performedOn,
      position: incoming.position,
      weightG: incoming.weightG,
      reps: incoming.reps,
      durationS: incoming.durationS,
      distanceM: incoming.distanceM,
      bodyweightG: incoming.bodyweightG,
      note: incoming.note,
    };

    const [row] =
      decision === 'update'
        ? await db
            .update(workoutSets)
            .set({ ...values, updatedAt: stamp.updatedAt, deletedAt: null, ...writeStamp(stamp) })
            .where(eq(workoutSets.id, incoming.id))
            .returning()
        : await db
            .insert(workoutSets)
            .values({ ...values, ...stamp })
            .onConflictDoUpdate({ target: workoutSets.id, set: { ...values, ...stamp } })
            .returning();

    changes.sets.push(toSyncedSetDto(row!));
    advance(row!.serverSeq);
    // Przeniesienie serii między ćwiczeniami rusza rekordy po obu stronach.
    if (existing) noteAffectedSet(scope, principal.id, existing.exerciseId);
    noteAffectedSet(scope, principal.id, row!.exerciseId);
    record('set', incoming.id, decision);
  }

  return { cursor, results, changes, scope };
}

/** Część znacznika wspólna dla każdego zapisu — bez pól, które zależą od decyzji. */
function writeStamp(stamp: ReturnType<typeof stampFrom>) {
  return { deviceId: stamp.deviceId, serverSeq: stamp.serverSeq };
}

/** Identyfikatory, których nie ma w tabeli. Pusta lista wejściowa nie pyta bazy. */
async function findMissing(
  db: Database,
  column: typeof tags.id | typeof exercises.id,
  ids: readonly string[],
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db.select({ id: column }).from(column.table).where(inArray(column, unique));
  const known = new Set(rows.map((row) => row.id));
  return unique.filter((id) => !known.has(id));
}
