/**
 * Import archiwum JSON — także ścieżka odtwarzania z kopii zapasowej.
 *
 * To ten sam kod w obu przypadkach, bo tak wymaga stack: kopia, której nigdy nie
 * odtworzono, nie jest kopią, a kod używany raz w roku w panice jest kodem
 * niesprawdzonym. Import użytkownika jest więc ciągłym testem procedury awaryjnej.
 *
 * ## Dopasowanie użytkowników po adresie e-mail
 *
 * Archiwum niesie użytkowników bez danych logowania. Po odtworzeniu na czystej
 * bazie ludzie logują się ponownie — przez Google albo hasłem — i dostają
 * **nowe** identyfikatory. Gdyby import trzymał się identyfikatorów z pliku,
 * powstałyby dwa konta na osobę: jedno z historią i bez możliwości logowania,
 * drugie odwrotnie. Dlatego użytkownik z archiwum jest najpierw szukany
 * w bazie po adresie e-mail, a jego identyfikator z pliku jest tłumaczony na
 * ten, który baza już zna.
 *
 * ## Dlaczego tłumaczenie identyfikatorów dotyka też ćwiczeń
 *
 * Identyfikator ćwiczenia to `uuidv5(autor + slug nazwy)` — i synchronizacja tego
 * pilnuje: push odrzuca wstawienie ćwiczenia, którego id nie wynika z tej pary.
 * Zmiana identyfikatora autora musi więc pociągnąć przeliczenie identyfikatora
 * jego ćwiczeń, a za tym — przepisanie odwołań w seriach i w pozycjach celów.
 * Bez tego kroku odtworzone ćwiczenia byłyby poprawne w bazie i odrzucane przy
 * pierwszej synchronizacji z telefonem.
 *
 * Identyfikator przeliczamy **wyłącznie** wtedy, gdy autor się zmienił. Ćwiczenie,
 * któremu poprawiono nazwę, ma id niewynikające z aktualnej nazwy i tak ma być
 * (patrz `PATCH /exercises/:id`) — przeliczanie go tworzyłoby drugi wiersz dla tej
 * samej pary autor + slug, czego nie przepuszcza indeks unikalny.
 *
 * ## Rozstrzyganie konfliktów jest tą samą regułą co przy synchronizacji
 *
 * Wiersz z archiwum wygrywa, gdy ma nowszy `updated_at` — LWW, dokładnie jak
 * w `POST /sync/push`. Import do bazy z nowszymi danymi nie cofa więc czasu,
 * a odtworzenie na czystą bazę wstawia wszystko. Każdy zapisany wiersz dostaje
 * nowy `server_seq`, bo inaczej telefony z kursorem powyżej nigdy by go nie
 * pobrały — czyli restore byłby niewidoczny dla urządzeń.
 *
 * ## Zakres uprawnień
 *
 * Archiwum systemowe może wgrać **wyłącznie administrator**: pisze konta i cudze
 * serie. Zwykły użytkownik importuje własne dane i tylko one wchodzą do bazy —
 * wiersze cudze są pomijane i zliczone w raporcie, a nie przemycane. Tagi są
 * wyjątkiem, bo są bytem globalnym, tworzy je każdy i ich zapis jest idempotentny.
 */

import {
  ARCHIVE_IMPORT_ORDER,
  findArchiveProblems,
  planArchiveIdentity,
  slug,
  type Archive,
  type ArchiveScope,
  type ArchiveSummary,
  type UserRole,
} from '@alphapump/core';
import { eq, inArray, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { Database } from '../db.js';
import { badRequest, forbidden } from '../errors.js';
import {
  accounts,
  cycleGoals,
  cycles,
  exerciseTags,
  exercises,
  tags,
  users,
  workoutSets,
} from '../schema.js';
import { nextServerSeq } from '../sync-columns.js';

/** Kto importuje. Rola rozstrzyga, czy wolno wgrać archiwum systemowe. */
export interface ImportActor {
  id: string;
  email: string;
  role: UserRole;
}

export interface ImportOptions {
  actor: ImportActor;
  now?: Date;
}

export interface ImportReport {
  scope: ArchiveScope;
  /** Wiersze zapisane albo uznane za już aktualne. */
  imported: ArchiveSummary;
  /** Wiersze pominięte: cudze albo wskazujące na coś, czego w bazie nie ma. */
  skipped: ArchiveSummary;
  /** Ćwiczenia, którym po dopasowaniu autora zmienił się identyfikator. */
  remappedExercises: number;
  /** Wyjaśnienia pominięć — jedna linia na powód, bez powtórzeń. */
  notes: string[];
}

/** Wiersze wchodzą partiami; jedno zapytanie na kilkaset wierszy zamiast na wiersz. */
const CHUNK_SIZE = 500;

function chunks<T>(rows: readonly T[], size: number = CHUNK_SIZE): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    result.push(rows.slice(index, index + size));
  }
  return result;
}

const emptySummary = (): ArchiveSummary => ({
  users: 0,
  credentials: 0,
  tags: 0,
  exercises: 0,
  sets: 0,
  cycles: 0,
});

/**
 * Adresy e-mail, które baza już zna — wejście dla `planArchiveIdentity`.
 *
 * To jedyna część tłumaczenia identyfikatorów, która wymaga bazy. Sama **reguła**
 * tłumaczenia siedzi w rdzeniu, bo wykonuje ją także aplikacja mobilna przy
 * imporcie do swojej bazy lokalnej — a rozjazd między nimi objawiłby się dopiero
 * jako wiersz odrzucony przy pierwszej synchronizacji po odtworzeniu.
 */
async function knownUserIds(db: Database, archive: Archive): Promise<Map<string, string>> {
  // Konta bez adresu pomijamy: archiwum z telefonu niesie adres wyłącznie
  // właściciela urządzenia, a po czym innym dopasować się nie da.
  const emails = archive.users.flatMap((user) => (user.email === null ? [] : [user.email]));
  if (emails.length === 0) return new Map();

  const rows = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(inArray(users.email, emails));

  return new Map(rows.map((row) => [row.email.toLowerCase(), row.id]));
}

export async function importArchive(
  db: Database,
  archive: Archive,
  options: ImportOptions,
): Promise<ImportReport> {
  const { actor } = options;
  const now = options.now ?? new Date();
  const isAdmin = actor.role === 'admin';

  const problems = findArchiveProblems(archive);
  if (problems.length > 0) {
    throw badRequest('The archive is inconsistent and cannot be restored', problems);
  }

  if (archive.scope === 'system' && !isAdmin) {
    throw forbidden('Only an administrator can import a system archive');
  }

  const imported = emptySummary();
  const skipped = emptySummary();
  const notes = new Set<string>();

  const known = await knownUserIds(db, archive);

  // Właściciel importu wchodzi do mapy adresów **przed** zbudowaniem planu, także
  // wtedy, gdy baza nie zna jeszcze jego adresu z archiwum: plik mógł powstać na
  // koncie, które później zmieniło e-mail. Dzięki temu plan jest liczony raz
  // i jego `exerciseIdMap` jest ostateczna — poprawianie go po fakcie znaczyłoby
  // powtórzenie reguły przeliczania identyfikatorów, czyli tego jednego miejsca,
  // które ma być wspólne z aplikacją.
  known.set(actor.email.toLowerCase(), actor.id);

  const plan = planArchiveIdentity(archive, known);
  const userMap = plan.userIdMap;
  const remappedExercises = plan.remappedExerciseIds.length;

  // Konta, których baza nie zna, zakłada wyłącznie administrator odtwarzający
  // kopię — bez nich cudze serie nie miałyby właściciela. Zwykły użytkownik kont
  // nie tworzy, więc powiązane z nimi wiersze po prostu nie wejdą; ich
  // identyfikatory usuwamy z mapy, żeby dalsze kroki widziały „autor nieznany".
  // Konto bez adresu nie da się założyć — kolumna jest wymagana i unikalna,
  // a wymyślony adres utworzyłby drugie konto tej samej osoby.
  const creatable = plan.missingUsers.filter((user) => user.email !== null);
  const newUsers = isAdmin ? creatable : [];
  const unresolved = isAdmin
    ? plan.missingUsers.filter((user) => user.email === null)
    : plan.missingUsers;

  for (const user of unresolved) userMap.delete(user.id);
  if (unresolved.length > 0) {
    notes.add(
      `Pominięto dane kont, których baza nie zna: ${unresolved
        .map((user) => user.email ?? user.nickname)
        .join(', ')} — konta zakłada administrator albo ich właściciele przez logowanie.`,
    );
  }

  /* ------------------------------------------------------------- ćwiczenia */

  interface PlannedExercise {
    id: string;
    original: string;
    authorId: string;
    exercise: Archive['exercises'][number];
    /** `false` — ćwiczenie cudze przy imporcie użytkownika; ma już być w bazie. */
    writable: boolean;
  }

  const planned: PlannedExercise[] = [];
  const exerciseIdMap = plan.exerciseIdMap;

  for (const exercise of archive.exercises) {
    const authorId = userMap.get(exercise.authorId);
    const id = exerciseIdMap.get(exercise.id);
    // Autor nierozstrzygnięty (konto, którego baza nie zna, a importujący nie ma
    // prawa go założyć) — ćwiczenia nie ma gdzie przypisać.
    if (authorId === undefined || id === undefined) {
      exerciseIdMap.delete(exercise.id);
      skipped.exercises += 1;
      continue;
    }

    planned.push({
      id,
      original: exercise.id,
      authorId,
      exercise,
      writable: isAdmin || authorId === actor.id,
    });
  }

  const foreign = planned.filter((entry) => !entry.writable);
  const presentForeign =
    foreign.length === 0
      ? new Set<string>()
      : new Set(
          (
            await db
              .select({ id: exercises.id })
              .from(exercises)
              .where(
                inArray(
                  exercises.id,
                  foreign.map((entry) => entry.id),
                ),
              )
          ).map((row) => row.id),
        );

  const writableExercises = planned.filter((entry) => entry.writable);
  const usableExerciseIds = new Set<string>([
    ...writableExercises.map((entry) => entry.id),
    ...[...presentForeign],
  ]);

  for (const entry of foreign) {
    if (presentForeign.has(entry.id)) {
      // Ćwiczenie cudze, ale już w bazie — serie mogą na nie wskazywać.
      continue;
    }
    skipped.exercises += 1;
    notes.add(
      'Pominięto ćwiczenia innych autorów, których nie ma w bibliotece — ' +
        'dodaje je ich autor albo administrator odtwarzający kopię systemową.',
    );
  }

  /* ------------------------------------------------------------------ zapis */

  await db.transaction(async (tx) => {
    for (const step of ARCHIVE_IMPORT_ORDER) {
      switch (step) {
        case 'users': {
          for (const batch of chunks(newUsers)) {
            await tx
              .insert(users)
              .values(
                batch.map((user) => ({
                  id: user.id,
                  // `name` jest polem better-auth; archiwum go nie niesie, bo do
                  // odtworzenia powiązań wystarczy nick.
                  name: user.nickname,
                  nickname: user.nickname,
                  email: user.email!,
                  emailVerified: false,
                  role: user.role,
                  createdAt: now,
                  updatedAt: now,
                })),
              )
              .onConflictDoNothing();
          }
          imported.users = newUsers.length;
          skipped.users = archive.users.length - newUsers.length;
          break;
        }

        /**
         * Sposoby logowania. Bez nich odtworzone konto istnieje, ale nie da się
         * na nie zalogować ani założyć go ponownie — adres jest już zajęty.
         *
         * `onConflictDoNothing`, bo baza docelowa może już znać to konto (import
         * na żywy system, nie na czysty): wtedy jego obecne hasło jest nowsze niż
         * to z kopii i nie ma powodu go cofać. Identyfikator wiersza nadajemy
         * sami, bo archiwum go nie niesie — dla better-autha liczy się para
         * `providerId` + `accountId` i to ona ma indeks unikalny.
         *
         * Konta, których import nie utworzył i których baza nie zna, wypadają
         * razem ze swoim właścicielem: `userMap` nie ma dla nich wpisu.
         */
        case 'credentials': {
          const usable = archive.credentials.flatMap((credential) => {
            const userId = userMap.get(credential.userId);
            if (userId === undefined) return [];
            return [{ ...credential, userId }];
          });

          for (const batch of chunks(usable)) {
            await tx
              .insert(accounts)
              .values(
                batch.map((credential) => ({
                  id: uuidv7(),
                  userId: credential.userId,
                  providerId: credential.providerId,
                  accountId: credential.accountId,
                  password: credential.password,
                  createdAt: now,
                  updatedAt: now,
                })),
              )
              .onConflictDoNothing();
          }

          imported.credentials = usable.length;
          skipped.credentials = archive.credentials.length - usable.length;
          if (skipped.credentials > 0) {
            notes.add(
              'Pominięto sposoby logowania kont, których nie ma w bazie — ' +
                'te konta i tak nie zostały odtworzone.',
            );
          }
          break;
        }

        case 'tags': {
          for (const batch of chunks(archive.tags)) {
            await tx
              .insert(tags)
              .values(
                batch.map((tag) => ({
                  id: tag.id,
                  name: tag.name,
                  slug: tag.slug,
                  color: tag.color,
                  // Nazwy w pozostałych językach jadą razem z wierszem: bez tego
                  // odtworzenie z kopii kasowałoby tłumaczenia, które archiwum
                  // przecież niesie.
                  translations: tag.translations,
                  createdAt: new Date(tag.createdAt),
                  updatedAt: new Date(tag.updatedAt),
                  deletedAt: null,
                })),
              )
              .onConflictDoUpdate({
                target: tags.id,
                set: {
                  name: sql`excluded.name`,
                  slug: sql`excluded.slug`,
                  color: sql`excluded.color`,
                  translations: sql`excluded.translations`,
                  updatedAt: sql`excluded.updated_at`,
                  deletedAt: sql`excluded.deleted_at`,
                  serverSeq: nextServerSeq(),
                },
                setWhere: sql`${tags.updatedAt} < excluded.updated_at`,
              });
          }
          imported.tags = archive.tags.length;
          break;
        }

        case 'exercises': {
          for (const batch of chunks(writableExercises)) {
            const written = await tx
              .insert(exercises)
              .values(
                batch.map((entry) => ({
                  id: entry.id,
                  name: entry.exercise.name,
                  slug: slug(entry.exercise.name),
                  authorId: entry.authorId,
                  loggingType: entry.exercise.loggingType,
                  primaryTagId: entry.exercise.primaryTagId,
                  note: entry.exercise.note,
                  translations: entry.exercise.translations,
                  createdAt: new Date(entry.exercise.createdAt),
                  updatedAt: new Date(entry.exercise.updatedAt),
                  deletedAt: null,
                })),
              )
              .onConflictDoUpdate({
                target: exercises.id,
                set: {
                  name: sql`excluded.name`,
                  slug: sql`excluded.slug`,
                  // Typ logowania **nie** wchodzi do aktualizacji: jest ustalany
                  // raz przy tworzeniu, a jego zmiana unieważniłaby historyczne
                  // serie tego ćwiczenia.
                  primaryTagId: sql`excluded.primary_tag_id`,
                  note: sql`excluded.note`,
                  translations: sql`excluded.translations`,
                  updatedAt: sql`excluded.updated_at`,
                  deletedAt: sql`excluded.deleted_at`,
                  serverSeq: nextServerSeq(),
                },
                setWhere: sql`${exercises.updatedAt} < excluded.updated_at`,
              })
              .returning({ id: exercises.id });

            /*
             * Tagi dodatkowe podmieniamy **wyłącznie** tym wierszom, które ten
             * wsad naprawdę zapisał.
             *
             * `RETURNING` oddaje po `ON CONFLICT DO UPDATE … WHERE` tylko wiersze
             * wstawione albo faktycznie zaktualizowane, więc wiersz, który
             * przegrał LWW z nowszym stanem bazy, w tej liście się nie pojawia.
             * Wcześniej podmiana szła po całym wsadzie i psuła dokładnie ten
             * wiersz, którego reguła LWW miała bronić: tag główny zostawał
             * z bazy, a zestaw dodatkowych przychodził ze starszego archiwum —
             * czyli ten sam tag potrafił wyjść jednocześnie głównym
             * i dodatkowym. Taki wiersz nie przechodzi przez `exerciseSchema`,
             * a ćwiczenia są globalne, więc jedno odtworzenie z kopii zabierało
             * panel i synchronizację wszystkim.
             */
            const writtenIds = new Set(written.map((entry) => entry.id));
            const replaced = batch.filter((entry) => writtenIds.has(entry.id));

            if (replaced.length > 0) {
              // Komplet tagów dodatkowych jest podmieniany, tak jak w CRUD-zie
              // i w pushu — różnicowanie zbioru dałoby ten sam wynik za cenę
              // trzeciego miejsca, w którym można się pomylić.
              await tx.delete(exerciseTags).where(
                inArray(
                  exerciseTags.exerciseId,
                  replaced.map((entry) => entry.id),
                ),
              );

              const links = replaced.flatMap((entry) =>
                entry.exercise.additionalTagIds.map((tagId, position) => ({
                  exerciseId: entry.id,
                  tagId,
                  position,
                })),
              );
              if (links.length > 0) {
                await tx.insert(exerciseTags).values(links).onConflictDoNothing();
              }
            }
          }
          imported.exercises = writableExercises.length;
          break;
        }

        case 'sets': {
          const rows = archive.sets.flatMap((set) => {
            const userId = userMap.get(set.userId);
            const exerciseId = exerciseIdMap.get(set.exerciseId);

            if (userId === undefined || exerciseId === undefined) return [];
            if (!isAdmin && userId !== actor.id) return [];
            if (!usableExerciseIds.has(exerciseId)) return [];

            return [
              {
                id: set.id,
                userId,
                exerciseId,
                performedOn: set.performedOn,
                position: set.position,
                weightG: set.weightG,
                reps: set.reps,
                durationS: set.durationS,
                distanceM: set.distanceM,
                bodyweightG: set.bodyweightG,
                note: set.note,
                createdAt: new Date(set.createdAt),
                updatedAt: new Date(set.updatedAt),
                deletedAt: null,
              },
            ];
          });

          for (const batch of chunks(rows)) {
            await tx
              .insert(workoutSets)
              .values(batch)
              .onConflictDoUpdate({
                target: workoutSets.id,
                set: {
                  exerciseId: sql`excluded.exercise_id`,
                  performedOn: sql`excluded.performed_on`,
                  position: sql`excluded.position`,
                  weightG: sql`excluded.weight_g`,
                  reps: sql`excluded.reps`,
                  durationS: sql`excluded.duration_s`,
                  distanceM: sql`excluded.distance_m`,
                  bodyweightG: sql`excluded.bodyweight_g`,
                  note: sql`excluded.note`,
                  updatedAt: sql`excluded.updated_at`,
                  deletedAt: sql`excluded.deleted_at`,
                  serverSeq: nextServerSeq(),
                },
                setWhere: sql`${workoutSets.updatedAt} < excluded.updated_at`,
              });
          }

          imported.sets = rows.length;
          skipped.sets = archive.sets.length - rows.length;
          if (skipped.sets > 0) {
            notes.add('Pominięto serie, których właściciela albo ćwiczenia nie ma w bazie.');
          }
          break;
        }

        case 'cycles': {
          const usable = archive.cycles.filter((cycle) => {
            const userId = userMap.get(cycle.userId);
            if (userId === undefined) return false;
            if (!isAdmin && userId !== actor.id) return false;

            return cycle.goals.every((goal) => {
              if (goal.exerciseId === null) return true;
              const mapped = exerciseIdMap.get(goal.exerciseId);
              return mapped !== undefined && usableExerciseIds.has(mapped);
            });
          });

          for (const batch of chunks(usable)) {
            await tx
              .insert(cycles)
              .values(
                batch.map((cycle) => ({
                  id: cycle.id,
                  userId: userMap.get(cycle.userId)!,
                  name: cycle.name,
                  startsOn: cycle.startsOn,
                  endsOn: cycle.endsOn,
                  archivedAt: cycle.archivedAt === null ? null : new Date(cycle.archivedAt),
                  createdAt: new Date(cycle.createdAt),
                  updatedAt: new Date(cycle.updatedAt),
                  deletedAt: null,
                })),
              )
              .onConflictDoUpdate({
                target: cycles.id,
                set: {
                  name: sql`excluded.name`,
                  startsOn: sql`excluded.starts_on`,
                  endsOn: sql`excluded.ends_on`,
                  archivedAt: sql`excluded.archived_at`,
                  updatedAt: sql`excluded.updated_at`,
                  deletedAt: sql`excluded.deleted_at`,
                  serverSeq: nextServerSeq(),
                },
                setWhere: sql`${cycles.updatedAt} < excluded.updated_at`,
              });

            // Pozycje celu jadą jako komplet — cykl bez pozycji nie miałby czego
            // zliczać, a różnicowanie ich zbioru nie ma tu żadnej zalety.
            for (const cycle of batch) {
              await tx.delete(cycleGoals).where(eq(cycleGoals.cycleId, cycle.id));
              await tx.insert(cycleGoals).values(
                cycle.goals.map((goal, position) => ({
                  id: goal.id,
                  cycleId: cycle.id,
                  metric: goal.metric,
                  target: goal.target,
                  exerciseId: goal.exerciseId === null ? null : exerciseIdMap.get(goal.exerciseId)!,
                  tagId: goal.tagId,
                  position,
                })),
              );
            }
          }

          imported.cycles = usable.length;
          skipped.cycles = archive.cycles.length - usable.length;
          if (skipped.cycles > 0) {
            notes.add('Pominięto cykle, których właściciela albo ćwiczeń celu nie ma w bazie.');
          }
          break;
        }
      }
    }
  });

  return {
    scope: archive.scope,
    imported,
    skipped,
    remappedExercises,
    notes: [...notes],
  };
}
