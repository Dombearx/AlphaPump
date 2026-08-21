/**
 * Narzędzia comiesięcznej próby odtworzenia kopii zapasowej.
 *
 * Kopia, której nigdy nie odtworzono, nie jest kopią. Próba odtworzenia raz
 * w miesiącu jest więc zadaniem w CI, a nie obietnicą, że ktoś o tym pamięta —
 * i to jest jedyny powód istnienia tego pliku.
 *
 * Trzy polecenia, wszystkie strony sprawdzenia:
 *
 * - `sample` wypełnia bazę danymi testowymi, żeby próba miała co odtwarzać.
 *   Dane są **fikcyjne i deterministyczne**: żaden prawdziwy eksport nie trafia
 *   do CI, bo zawiera adresy e-mail i pełną historię treningową grupy.
 * - `compare` porównuje dwa pliki archiwum w postaci kanonicznej z rdzenia.
 *   Postać kanoniczna pomija to, co po odtworzeniu **musi** się różnić (moment
 *   eksportu, kolejność wierszy, znaczniki synchronizacji), a zostawia to, co ma
 *   się zgadzać: wartości i powiązania — autorów ćwiczeń i właścicieli serii.
 * - `signin` loguje się na odtworzoną bazę. Bez tego kroku próba przechodziła,
 *   a odtworzony system był nie do użycia: konta wchodziły razem z adresami, ale
 *   bez sposobu logowania, więc zalogować się nie było jak, a założyć konta
 *   ponownie też nie — adres jest zajęty. Porównanie danych tego nie widziało,
 *   bo poświadczeń w archiwum nie było i po obu stronach zgadzały się zera.
 *
 * Skrypt jest częścią aplikacji API, a nie osobnym pakietem, bo potrzebuje jej
 * połączenia z bazą i jej migracji. Nie jest wołany przez serwer i nie wchodzi
 * do żadnej ścieżki produkcyjnej.
 */

import { readFile } from 'node:fs/promises';
import {
  builtInExerciseId,
  canonicalArchive,
  exerciseId as deterministicExerciseId,
  parseArchive,
  slug,
  tagColor,
  tagId,
} from '@alphapump/core';
import { SYSTEM_USER } from '@alphapump/db';
import { createApp } from '../app.js';
import { createAuth } from '../auth.js';
import { loadConfig } from '../config.js';
import { createDatabase, runMigrations } from '../db.js';
import { seedPostgres } from '@alphapump/db/pg';
import { accounts, cycleGoals, cycles, exercises, tags, users, workoutSets } from '../schema.js';

/**
 * Konta testowe. Adresy w domenie `example` — nigdzie nie prowadzą.
 *
 * Identyfikatory są **wpisane na stałe**, a nie losowane. Próba bywa uruchamiana
 * dwa razy na tej samej bazie (choćby przez `workflow_dispatch` po nieudanym
 * przebiegu), a losowy identyfikator dawałby przy drugim uruchomieniu konto,
 * którego wstawienie odbije się o unikalny e-mail — i ćwiczenie wskazujące na
 * autora, którego nie ma. Stałe identyfikatory czynią `sample` idempotentnym.
 */
const PEOPLE = [
  { id: '00000000-0000-4000-8000-00000000d001', email: 'kuba@example.com', nickname: 'Kuba' },
  { id: '00000000-0000-4000-8000-00000000d002', email: 'ola@example.com', nickname: 'Ola' },
] as const;

/** Identyfikatory wierszy próby — również stałe, z tego samego powodu. */
const SET_IDS = [
  '00000000-0000-7000-8000-00000000e001',
  '00000000-0000-7000-8000-00000000e002',
  '00000000-0000-7000-8000-00000000e003',
] as const;

const CYCLE_ID = '00000000-0000-7000-8000-00000000f001';
const GOAL_ID = '00000000-0000-7000-8000-00000000f002';

const AT = new Date('2026-08-01T08:00:00.000Z');

/**
 * Hasło kont próby. Jawne w repozytorium świadomie: konta istnieją wyłącznie
 * w bazie CI, którą zadanie zakłada i porzuca w tym samym przebiegu.
 */
export const SAMPLE_PASSWORD = 'haslo-proby-odtworzenia-123';

/**
 * Wypełnia bazę danymi, na których da się sprawdzić odtworzenie.
 *
 * Zestaw jest dobrany pod to, co w odtwarzaniu bywa trudne, a nie pod objętość:
 * dwie osoby (żeby wyszło pomieszanie właścicieli), ćwiczenie **własne** obok
 * wbudowanego (żeby wyszło powiązanie autora), cykl z pozycją celu wskazującą
 * ćwiczenie (żeby wyszło odwołanie wewnątrz archiwum) i serie w dwóch dniach.
 */
export async function runSample(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    await runMigrations(connection);
    await seedPostgres(connection.db);

    const db = connection.db;
    const people = PEOPLE;

    await db
      .insert(users)
      .values(
        people.map((account) => ({
          id: account.id,
          name: account.nickname,
          nickname: account.nickname,
          email: account.email,
          emailVerified: true,
          role: 'user' as const,
          createdAt: AT,
          updatedAt: AT,
        })),
      )
      .onConflictDoNothing();

    /**
     * Sposób logowania obok konta — inaczej próba sprawdzałaby odtworzenie
     * danych, a nie odtworzenie **systemu**, na który da się wejść.
     *
     * Hash liczymy tym samym hasherem, którego używa better-auth przy
     * rejestracji, a nie własnym: gdyby format się rozjechał, `drill signin`
     * niżej wykryłby to dopiero po odtworzeniu — czyli dokładnie tam, gdzie ma.
     */
    const auth = createAuth(db, config);
    const hash = (await auth.$context).password.hash;

    await db
      .insert(accounts)
      .values(
        await Promise.all(
          people.map(async (account) => ({
            id: `00000000-0000-4000-8000-0000000c${account.id.slice(-4)}`,
            userId: account.id,
            providerId: 'credential',
            accountId: account.id,
            password: await hash(SAMPLE_PASSWORD),
            createdAt: AT,
            updatedAt: AT,
          })),
        ),
      )
      .onConflictDoNothing();

    const grip = tagId('Chwyt szczypcowy');
    await db
      .insert(tags)
      .values({
        id: grip,
        name: 'Chwyt szczypcowy',
        slug: slug('Chwyt szczypcowy'),
        color: tagColor('Chwyt szczypcowy'),
        createdAt: AT,
        updatedAt: AT,
      })
      .onConflictDoNothing();

    const author = people[0];
    const ownExercise = deterministicExerciseId(author.id, 'Zwis na jednej ręce');
    await db
      .insert(exercises)
      .values({
        id: ownExercise,
        name: 'Zwis na jednej ręce',
        slug: slug('Zwis na jednej ręce'),
        authorId: author.id,
        loggingType: 'bodyweight_time',
        primaryTagId: grip,
        note: 'na czas',
        createdAt: AT,
        updatedAt: AT,
      })
      .onConflictDoNothing();

    const bench = builtInExerciseId('Flat barbell bench press');

    await db
      .insert(workoutSets)
      .values([
        {
          id: SET_IDS[0],
          userId: author.id,
          exerciseId: ownExercise,
          performedOn: '2026-08-08',
          position: 0,
          durationS: 45,
          bodyweightG: 82_000,
          note: 'mocno',
          createdAt: AT,
          updatedAt: AT,
        },
        {
          id: SET_IDS[1],
          userId: author.id,
          exerciseId: bench,
          performedOn: '2026-08-10',
          position: 0,
          weightG: 100_000,
          reps: 3,
          createdAt: AT,
          updatedAt: AT,
        },
        {
          id: SET_IDS[2],
          userId: people[1].id,
          exerciseId: bench,
          performedOn: '2026-08-10',
          position: 0,
          weightG: 60_000,
          reps: 8,
          createdAt: AT,
          updatedAt: AT,
        },
      ])
      .onConflictDoNothing();

    await db
      .insert(cycles)
      .values({
        id: CYCLE_ID,
        userId: author.id,
        name: 'Sierpień',
        startsOn: '2026-08-01',
        endsOn: '2026-08-31',
        createdAt: AT,
        updatedAt: AT,
      })
      .onConflictDoNothing();

    await db
      .insert(cycleGoals)
      .values({
        id: GOAL_ID,
        cycleId: CYCLE_ID,
        metric: 'sets',
        target: 20,
        exerciseId: ownExercise,
        position: 0,
      })
      .onConflictDoNothing();

    process.stderr.write(
      `Wypełniono bazę danymi próby: ${String(people.length)} konta, 3 serie, 1 cykl ` +
        `(konto systemowe: ${SYSTEM_USER.email}).\n`,
    );
  } finally {
    await connection.close();
  }
}

/**
 * Porównuje dwa pliki archiwum. Kończy się kodem wyjścia 1, gdy się różnią —
 * to on decyduje o wyniku zadania w CI.
 */
export async function runCompare(first?: string, second?: string): Promise<void> {
  if (first === undefined || second === undefined) {
    throw new Error('Użycie: drill compare <archiwum-a.json> <archiwum-b.json>');
  }

  const [a, b] = await Promise.all([
    readFile(first, 'utf8').then((raw) => parseArchive(JSON.parse(raw))),
    readFile(second, 'utf8').then((raw) => parseArchive(JSON.parse(raw))),
  ]);

  const left = JSON.stringify(canonicalArchive(a));
  const right = JSON.stringify(canonicalArchive(b));

  if (left === right) {
    process.stderr.write(
      `Archiwa zgadzają się: ${String(a.sets.length)} serii, ` +
        `${String(a.exercises.length)} ćwiczeń, ${String(a.users.length)} kont.\n`,
    );
    return;
  }

  process.stderr.write('Archiwa różnią się po odtworzeniu.\n');
  process.stderr.write(`  ${first}: ${left.slice(0, 400)}…\n`);
  process.stderr.write(`  ${second}: ${right.slice(0, 400)}…\n`);
  process.exitCode = 1;
}

/**
 * Loguje się na bazę wskazaną przez `DATABASE_URL` — dowód, że odtworzony system
 * da się w ogóle użyć.
 *
 * Idzie przez **prawdziwą** aplikację i prawdziwy endpoint logowania, a nie przez
 * zapytanie sprawdzające, czy wiersz istnieje. Tylko tak wychodzi rozjazd formatu
 * hasha albo brakująca kolumna: wiersz może być na miejscu, a logowanie i tak
 * odbić się o coś, czego zapytanie nie widzi.
 */
export async function runSignIn(email: string = PEOPLE[0].email): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    const auth = createAuth(connection.db, config);
    const app = createApp({ db: connection.db, auth }, config);

    const response = await app.fetch(
      new Request(`${config.baseUrl}/api/auth/sign-in/email`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password: SAMPLE_PASSWORD }),
      }),
    );

    if (!response.ok) {
      process.stderr.write(
        `Logowanie na odtworzoną bazę nie powiodło się (${String(response.status)}): ` +
          `${(await response.text()).slice(0, 300)}\n` +
          'Kopia odtworzyła dane, ale nie sposób logowania — patrz `credentials` ' +
          'w `packages/core/src/transfer.ts`.\n',
      );
      process.exitCode = 1;
      return;
    }

    const token = response.headers.get('set-auth-token');
    if (token === null || token.length === 0) {
      process.stderr.write('Logowanie przeszło, ale bez tokenu sesji — to nie jest sukces.\n');
      process.exitCode = 1;
      return;
    }

    process.stderr.write(`Logowanie na odtworzoną bazę powiodło się (${email}).\n`);
  } finally {
    await connection.close();
  }
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'sample':
      await runSample();
      return;
    case 'compare':
      await runCompare(rest[0], rest[1]);
      return;
    case 'signin':
      await runSignIn(rest[0]);
      return;
    default:
      throw new Error('Użycie: drill <sample|compare|signin>');
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
