/**
 * Format eksportu i importu — jeden dla funkcji użytkownika i dla kopii zapasowych.
 *
 * Specyfikacja wymaga eksportu i importu danych w JSON-ie, a stack wymaga, żeby
 * systemowa kopia zapasowa używała **dokładnie tego samego kodu**. To nie jest
 * oszczędność linijek, tylko jedyny sposób, żeby ścieżka odtwarzania nie
 * zardzewiała: droga „eksport → plik → import" jest przechodzona przez zwykłych
 * użytkowników przy normalnym korzystaniu z aplikacji, więc awaria w niej
 * wychodzi od razu, a nie w dniu, w którym padnie dysk minipc.
 *
 * ## Co jest w archiwum, a czego nie ma
 *
 * W archiwum: serie, ćwiczenia, tagi, cykle oraz **minimalne** dane użytkowników
 * (`id`, e-mail, nick, rola). W archiwum **systemowym** dodatkowo sposoby
 * logowania — hash hasła i powiązanie z Google (patrz `archiveCredentialSchema`).
 * Poza archiwum: sesje (wygasają), klucze API (użytkownik wygeneruje nowe),
 * embeddingi (przeliczalne z nazw) oraz rekordy i rankingi (pochodne z serii).
 *
 * Minimalny zapis użytkowników jest konieczny dlatego, że bez niego po
 * odtworzeniu `authorId` przy ćwiczeniach i właściciel przy seriach wskazywałyby
 * w próżnię. Dopasowanie po restore idzie po adresie e-mail: konto, które w bazie
 * docelowej już jest, zachowuje swój identyfikator, a odwołania są przeliczane.
 *
 * ## Dlaczego tylko wiersze żywe
 *
 * Tombstone'y są mechaniką synchronizacji, nie danymi. Archiwum ma odtworzyć
 * **stan**, a nie historię usunięć: wiersz z `deleted_at` po odtworzeniu i tak
 * byłby dla użytkownika nieistniejący, a przy okazji mógłby po pullu skasować
 * wiersz o tym samym identyfikatorze, który ktoś tymczasem odtworzył. Kolumna
 * `deletedAt` zostaje w schemacie, bo kształt encji jest wspólny z resztą
 * projektu — ale eksport wypełnia ją zawsze `null`.
 *
 * ## Dlaczego reguły są tutaj
 *
 * Serializację wykonują trzy różne miejsca (API dla użytkownika, skrypt kopii,
 * aplikacja mobilna dla własnej bazy). Wspólny musi więc być **format i jego
 * reguły**, bo tylko one gwarantują, że plik z telefonu wejdzie do bazy serwera
 * i odwrotnie. Same zapytania do bazy zostają tam, gdzie baza — tu nie ma I/O.
 */

import { z } from 'zod';
import { exerciseId } from './ids.js';
import {
  cycleSchema,
  exerciseSchema,
  isoDateTimeSchema,
  tagSchema,
  userRoleSchema,
  uuidSchema,
  workoutSetSchema,
} from './schemas.js';

/** Znacznik formatu w pliku — chroni przed próbą importu czegoś zupełnie innego. */
export const ARCHIVE_FORMAT = 'alphapump.archive';

/**
 * Wersja formatu. Podbicie oznacza zmianę niezgodną wstecz i wymaga migracji
 * plików — dlatego import odrzuca wersję, której nie zna, zamiast zgadywać.
 */
export const ARCHIVE_VERSION = 1;

/**
 * Zakres archiwum.
 *
 * `user` — dane jednego konta (funkcja eksportu w aplikacji).
 * `system` — wszystkie konta i cała biblioteka (kopia zapasowa z crona).
 *
 * Zakres jest w pliku, bo import musi wiedzieć, czego się spodziewać:
 * archiwum systemowe niesie użytkowników, których w bazie może nie być,
 * a archiwum jednego konta — wyłącznie jego właściciela i autorów ćwiczeń,
 * z których korzystał.
 */
export const ARCHIVE_SCOPES = ['user', 'system'] as const;
export type ArchiveScope = (typeof ARCHIVE_SCOPES)[number];
export const archiveScopeSchema = z.enum(ARCHIVE_SCOPES);

/**
 * Użytkownik w archiwum — wyłącznie to, bez czego powiązania rozsypią się po
 * odtworzeniu. Bez hasła, bez sesji, bez kluczy API.
 *
 * Adres e-mail jest **nullowalny**, i to nie z ostrożności. Archiwum powstaje
 * także na telefonie, a baza lokalna zna adres wyłącznie właściciela urządzenia:
 * adresy pozostałych osób nie są potrzebne do niczego, co robi aplikacja, więc
 * pull ich tam nie rozsyła. Konto bez adresu jest w archiwum obecne po to, by
 * `authorId` przy ćwiczeniu na coś wskazywał — ale nie da się go **dopasować**
 * przy odtwarzaniu ani założyć, bo dopasowanie idzie właśnie po adresie.
 * Wpisanie tam wartości zastępczej byłoby gorsze niż `null`: import utworzyłby
 * z niej drugie konto tej samej osoby.
 */
export const archiveUserSchema = z.object({
  id: uuidSchema,
  email: z.email().nullable(),
  nickname: z.string().trim().min(1).max(40),
  role: userRoleSchema,
});

export type ArchiveUser = z.infer<typeof archiveUserSchema>;

/**
 * Sposób logowania w archiwum systemowym — bez tego kopia nie jest kopią.
 *
 * Wcześniej poświadczeń tu nie było, „bo wrażliwe, a do odtworzenia zbędne".
 * Drugie było nieprawdą i wychodziło dopiero w dniu, w którym kopia jest
 * potrzebna: import wstawia wiersze kont razem z adresami, więc po odtworzeniu
 * na czystą bazę konto **istnieje**, ale nie ma powiązanego sposobu logowania.
 * Zalogować się nie da, a założyć konta ponownie też nie, bo adres jest zajęty.
 * Resetu hasła przez e-mail nie ma — serwer nie ma czym wysłać wiadomości.
 *
 * Stąd `password`: hash, nie hasło. Wchodzi **wyłącznie** do archiwum
 * systemowego (`scope: 'system'`), które i tak jest zastrzeżone dla
 * administratora, a przy wysyłce poza maszynę `scripts/backup.sh` wymusza
 * szyfrowanie `age`. W archiwum jednego konta, które użytkownik pobiera sobie
 * sam, poświadczeń nie ma i być nie może.
 *
 * Tokenów OAuth (`accessToken`, `refreshToken`, `idToken`) nie ma nigdzie:
 * wygasają, a bez nich powiązanie z Google i tak działa — Google wystawi nowy
 * token przy pierwszym logowaniu.
 */
export const archiveCredentialSchema = z.object({
  userId: uuidSchema,
  /** `credential` dla e-maila z hasłem, `google` dla konta Google. */
  providerId: z.string().min(1).max(64),
  accountId: z.string().min(1),
  /** Hash hasła; `null` przy logowaniu przez dostawcę zewnętrznego. */
  password: z.string().nullable(),
});

export type ArchiveCredential = z.infer<typeof archiveCredentialSchema>;

export const archiveSchema = z.object({
  format: z.literal(ARCHIVE_FORMAT),
  version: z.literal(ARCHIVE_VERSION),
  exportedAt: isoDateTimeSchema,
  scope: archiveScopeSchema,
  users: z.array(archiveUserSchema),
  /**
   * Puste w archiwum jednego konta i w plikach sprzed wprowadzenia tego pola —
   * stąd `.default([])`, a nie podbicie `ARCHIVE_VERSION`. Dołożenie pola
   * opcjonalnego jest zgodne wstecz w obie strony: starszy plik wczytuje się
   * bez zmian, a nowy wczytany starszym kodem po prostu je zignoruje.
   */
  credentials: z.array(archiveCredentialSchema).default([]),
  tags: z.array(tagSchema),
  exercises: z.array(exerciseSchema),
  sets: z.array(workoutSetSchema),
  cycles: z.array(cycleSchema),
});

export type Archive = z.infer<typeof archiveSchema>;

/** Zawartość archiwum bez metadanych — to, co składa strona czytająca bazę. */
export type ArchiveContent = Pick<
  Archive,
  'users' | 'credentials' | 'tags' | 'exercises' | 'sets' | 'cycles'
>;

/**
 * Kolejność zapisu przy imporcie — od bytów niezależnych do zależnych.
 *
 * Nie jest kosmetyką: serwer egzekwuje klucze obce, więc seria wstawiona przed
 * swoim ćwiczeniem wywróci zapis. Kolejność jest tu, a nie w kodzie importu,
 * bo importują trzy różne miejsca i wszystkie muszą trzymać tę samą.
 */
export const ARCHIVE_IMPORT_ORDER = [
  'users',
  // Po kontach, bo wskazują na nie kluczem obcym, i przed resztą, bo bez nich
  // odtworzone konto istnieje, a zalogować się na nie nie da.
  'credentials',
  'tags',
  'exercises',
  'sets',
  'cycles',
] as const;

export interface ArchiveSummary {
  users: number;
  credentials: number;
  tags: number;
  exercises: number;
  sets: number;
  cycles: number;
}

export function archiveSummary(archive: ArchiveContent): ArchiveSummary {
  return {
    users: archive.users.length,
    credentials: archive.credentials.length,
    tags: archive.tags.length,
    exercises: archive.exercises.length,
    sets: archive.sets.length,
    cycles: archive.cycles.length,
  };
}

/**
 * Składa archiwum z zawartości, dokładając metadane formatu.
 *
 * Moment eksportu podaje wołający — rdzeń nie sięga po zegar, bo wtedy przestałby
 * być funkcją swoich argumentów. Ta sama zasada obowiązuje w całym pakiecie.
 */
export function createArchive(
  content: ArchiveContent,
  options: { scope: ArchiveScope; exportedAt: Date },
): Archive {
  return {
    format: ARCHIVE_FORMAT,
    version: ARCHIVE_VERSION,
    exportedAt: options.exportedAt.toISOString(),
    scope: options.scope,
    ...content,
  };
}

/**
 * Czyta archiwum z dowolnej wartości (sparsowanego JSON-a).
 *
 * Rzuca błędem Zoda, gdy plik nie jest archiwum AlphaPump albo ma wersję, której
 * ten kod nie zna. Zgadywanie kształtu byłoby najgorszym możliwym wyborem: import
 * pisze do bazy, a plik przychodzi z zewnątrz — z telefonu, z Dysku, z ręki.
 */
export function parseArchive(value: unknown): Archive {
  return archiveSchema.parse(value);
}

/** Problem spójności archiwum — wiersz wskazujący na coś, czego w pliku nie ma. */
export interface ArchiveProblem {
  entity: 'exercise' | 'set' | 'cycle';
  id: string;
  message: string;
}

/**
 * Sprawdza spójność wewnętrzną archiwum **przed** dotknięciem bazy.
 *
 * Import wchodzi do bazy z kluczami obcymi. Bez tego kroku pierwszy osierocony
 * wiersz wywracałby transakcję komunikatem sterownika o naruszeniu więzów —
 * prawdziwym, ale bezużytecznym dla osoby odtwarzającej kopię. Tu zamiast tego
 * wychodzi lista: co dokładnie wskazuje na co i czego brakuje.
 *
 * Sprawdzamy wyłącznie spójność **wewnątrz pliku**. Ćwiczenie cudzego autora,
 * który jest już w bazie, ale nie ma go w archiwum jednego konta, nie jest
 * błędem — dlatego import łączy archiwum ze stanem bazy, a nie zastępuje go.
 */
export function findArchiveProblems(archive: ArchiveContent): ArchiveProblem[] {
  const problems: ArchiveProblem[] = [];

  const userIds = new Set(archive.users.map((user) => user.id));
  const tagIds = new Set(archive.tags.map((tag) => tag.id));
  const exerciseIds = new Set(archive.exercises.map((exercise) => exercise.id));

  for (const exercise of archive.exercises) {
    if (!userIds.has(exercise.authorId)) {
      problems.push({
        entity: 'exercise',
        id: exercise.id,
        message: `Autor ${exercise.authorId} nie występuje w archiwum`,
      });
    }
    for (const tagId of [exercise.primaryTagId, ...exercise.additionalTagIds]) {
      if (!tagIds.has(tagId)) {
        problems.push({
          entity: 'exercise',
          id: exercise.id,
          message: `Tag ${tagId} nie występuje w archiwum`,
        });
      }
    }
  }

  for (const set of archive.sets) {
    if (!userIds.has(set.userId)) {
      problems.push({
        entity: 'set',
        id: set.id,
        message: `Właściciel ${set.userId} nie występuje w archiwum`,
      });
    }
    if (!exerciseIds.has(set.exerciseId)) {
      problems.push({
        entity: 'set',
        id: set.id,
        message: `Ćwiczenie ${set.exerciseId} nie występuje w archiwum`,
      });
    }
  }

  for (const cycle of archive.cycles) {
    if (!userIds.has(cycle.userId)) {
      problems.push({
        entity: 'cycle',
        id: cycle.id,
        message: `Właściciel ${cycle.userId} nie występuje w archiwum`,
      });
    }
    for (const goal of cycle.goals) {
      if (goal.exerciseId !== null && !exerciseIds.has(goal.exerciseId)) {
        problems.push({
          entity: 'cycle',
          id: cycle.id,
          message: `Pozycja celu wskazuje ćwiczenie ${goal.exerciseId}, którego nie ma w archiwum`,
        });
      }
      if (goal.tagId !== null && !tagIds.has(goal.tagId)) {
        problems.push({
          entity: 'cycle',
          id: cycle.id,
          message: `Pozycja celu wskazuje tag ${goal.tagId}, którego nie ma w archiwum`,
        });
      }
    }
  }

  return problems;
}

/* ------------------------------------------- tłumaczenie identyfikatorów --- */

export interface ArchiveIdentityPlan {
  /** Identyfikator z archiwum → identyfikator, którego użyje baza docelowa. */
  userIdMap: Map<string, string>;
  /** Konta z archiwum, których baza docelowa nie zna. */
  missingUsers: ArchiveUser[];
  exerciseIdMap: Map<string, string>;
  /** Ćwiczenia, którym identyfikator się zmienił, bo zmienił się autor. */
  remappedExerciseIds: string[];
}

/**
 * Tłumaczy identyfikatory z archiwum na te, którymi posługuje się baza docelowa.
 *
 * To najbardziej podstępna część odtwarzania i dlatego jest tu, w rdzeniu:
 * wykonują ją **dwa** miejsca — import po stronie serwera (Postgres) i import
 * w aplikacji (SQLite) — a rozjazd między nimi objawiłby się dopiero jako
 * odrzucony wiersz przy pierwszej synchronizacji po restore.
 *
 * ## Konta: dopasowanie po adresie e-mail
 *
 * Archiwum nie niesie danych logowania, więc po odtworzeniu na czystej bazie
 * ludzie logują się ponownie i dostają **nowe** identyfikatory. Trzymanie się
 * identyfikatorów z pliku dałoby dwa konta na osobę: jedno z historią i bez
 * możliwości logowania, drugie odwrotnie.
 *
 * ## Ćwiczenia: identyfikator wynika z autora
 *
 * Identyfikator ćwiczenia to `uuidv5(autor + slug nazwy)` i synchronizacja tego
 * pilnuje — push odrzuca wstawienie ćwiczenia, którego id nie wynika z tej pary.
 * Zmiana identyfikatora autora musi więc pociągnąć przeliczenie identyfikatorów
 * jego ćwiczeń, a za tym przepisanie odwołań w seriach i pozycjach celów.
 *
 * Przeliczamy **wyłącznie** przy zmianie autora. Ćwiczenie, któremu poprawiono
 * nazwę, ma identyfikator niewynikający z nazwy aktualnej i tak ma być
 * (identyfikator liczy się raz, przy tworzeniu) — przeliczanie go tworzyłoby
 * drugi wiersz dla tej samej pary autor + slug, czego nie przepuszcza indeks
 * unikalny.
 *
 * @param knownUserIdByEmail Adresy e-mail znane bazie docelowej, małymi literami.
 */
export function planArchiveIdentity(
  archive: ArchiveContent,
  knownUserIdByEmail: ReadonlyMap<string, string>,
): ArchiveIdentityPlan {
  const userIdMap = new Map<string, string>();
  const missingUsers: ArchiveUser[] = [];

  for (const user of archive.users) {
    // Konto bez adresu nie ma po czym zostać dopasowane — trafia do brakujących
    // z własnym identyfikatorem i to wołający decyduje, co z nim zrobić.
    const known =
      user.email === null ? undefined : knownUserIdByEmail.get(user.email.toLowerCase());
    if (known === undefined) missingUsers.push(user);
    userIdMap.set(user.id, known ?? user.id);
  }

  const exerciseIdMap = new Map<string, string>();
  const remappedExerciseIds: string[] = [];

  for (const exercise of archive.exercises) {
    const authorId = userIdMap.get(exercise.authorId);
    // Ćwiczenie autora, którego w archiwum nie ma, nie przeszłoby sprawdzenia
    // spójności — tutaj po prostu nie ma dla niego tłumaczenia.
    if (authorId === undefined) continue;

    const id = authorId === exercise.authorId ? exercise.id : exerciseId(authorId, exercise.name);
    exerciseIdMap.set(exercise.id, id);
    if (id !== exercise.id) remappedExerciseIds.push(exercise.id);
  }

  return { userIdMap, missingUsers, exerciseIdMap, remappedExerciseIds };
}

/**
 * Postać kanoniczna archiwum — do porównania „przed" z „po odtworzeniu".
 *
 * Wymaganie brzmi: dane po odtworzeniu zgadzają się
 * z oryginałem, **łącznie z powiązaniami autorów ćwiczeń i właścicieli serii**.
 * Porównanie surowych obiektów tego nie sprawdza, bo różnią się rzeczami bez
 * znaczenia: kolejnością wierszy z bazy i znacznikiem `exportedAt`, który przy
 * drugim eksporcie musi być inny. Ta funkcja odsiewa jedno i drugie, zostawiając
 * dokładnie to, co ma się zgadzać — i właśnie dlatego jest tutaj, a nie w teście:
 * z tej samej reguły korzysta comiesięczna próba odtworzenia w CI.
 */
export function canonicalArchive(archive: ArchiveContent): unknown {
  const byId = <T extends { id: string }>(rows: readonly T[]): T[] =>
    [...rows].sort((a, b) => a.id.localeCompare(b.id));

  return {
    users: byId(archive.users).map((user) => ({
      id: user.id,
      email: user.email,
      nickname: user.nickname,
      role: user.role,
    })),
    credentials: [...archive.credentials]
      .sort((a, b) =>
        a.userId === b.userId
          ? a.providerId.localeCompare(b.providerId)
          : a.userId.localeCompare(b.userId),
      )
      .map((credential) => ({
        userId: credential.userId,
        providerId: credential.providerId,
        accountId: credential.accountId,
        password: credential.password,
      })),
    tags: byId(archive.tags).map((tag) => ({
      id: tag.id,
      name: tag.name,
      slug: tag.slug,
      color: tag.color,
    })),
    exercises: byId(archive.exercises).map((exercise) => ({
      id: exercise.id,
      name: exercise.name,
      slug: exercise.slug,
      authorId: exercise.authorId,
      loggingType: exercise.loggingType,
      primaryTagId: exercise.primaryTagId,
      additionalTagIds: [...exercise.additionalTagIds].sort((a, b) => a.localeCompare(b)),
      note: exercise.note,
      gym: exercise.gym,
    })),
    sets: byId(archive.sets).map((set) => ({
      id: set.id,
      userId: set.userId,
      exerciseId: set.exerciseId,
      performedOn: set.performedOn,
      position: set.position,
      weightG: set.weightG,
      reps: set.reps,
      durationS: set.durationS,
      distanceM: set.distanceM,
      bodyweightG: set.bodyweightG,
      note: set.note,
    })),
    cycles: byId(archive.cycles).map((cycle) => ({
      id: cycle.id,
      userId: cycle.userId,
      name: cycle.name,
      startsOn: cycle.startsOn,
      endsOn: cycle.endsOn,
      archivedAt: cycle.archivedAt,
      goals: byId(cycle.goals).map((goal) => ({
        id: goal.id,
        metric: goal.metric,
        target: goal.target,
        exerciseId: goal.exerciseId,
        tagId: goal.tagId,
      })),
    })),
  };
}
