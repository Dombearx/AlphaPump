/**
 * `pnpm --filter api regenerate-seed` — przenosi ręczne zmiany biblioteki
 * wbudowanej z powrotem do pliku seeda.
 *
 * Panel admina edytuje tagi i ćwiczenia konta systemowego przez te same
 * endpointy co telefon (`PATCH /exercises/:id`, `PATCH /tags/:id`) — to
 * prawdziwy zapis do Postgresa. Sync jest globalny dla tagów i ćwiczeń
 * (patrz `sync/pull.ts`), więc taka zmiana dojeżdża do każdego zalogowanego
 * urządzenia bez udziału tego skryptu.
 *
 * Ten skrypt rozwiązuje inny problem: `packages/db/src/seed/data.ts` jest
 * źródłem prawdy tylko dla **startu od zera** (świeży `seedSqlite`/`seedPostgres`
 * na pustej bazie). Bez regeneracji ręczna edycja w adminie żyje wyłącznie
 * w Postgresie — nowy deployment albo świeża instalacja telefonu offline
 * (przed pierwszym zalogowaniem) dalej dostają starą wersję z pliku.
 *
 * Workflow: edytuj w panelu admina, potem uruchom ten skrypt i zacommituj
 * diff `data.ts`.
 *
 * ```
 * pnpm --filter api build
 * pnpm --filter api regenerate-seed
 * git diff packages/db/src/seed/data.ts
 * ```
 *
 * Kolejność ćwiczeń w wygenerowanym pliku jest deterministyczna (tag główny,
 * potem nazwa), nie ręcznie ułożona jak w oryginale — to jedyna różnica
 * kosmetyczna, jakiej można się spodziewać w diffie mimo braku zmian
 * treściowych.
 */

import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { builtInExerciseId, SYSTEM_USER_ID, tagId as tagIdOf } from '@alphapump/core';
import type { LoggingType } from '@alphapump/core';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { loadConfig } from '../config.js';
import { createDatabase } from '../db.js';
import { exerciseTags, exercises, tags } from '../schema.js';

const DATA_FILE = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../../../packages/db/src/seed/data.ts',
);

/** Kolejność sekcji i ich nagłówki — te same, co w ręcznie pisanym oryginale. */
const GROUPS: readonly { loggingType: LoggingType; heading: string }[] = [
  { loggingType: 'weight_reps', heading: 'weight + reps' },
  { loggingType: 'bodyweight_reps', heading: 'bodyweight + reps' },
  { loggingType: 'bodyweight_time', heading: 'bodyweight + time' },
  { loggingType: 'weight_time', heading: 'weight + time' },
  { loggingType: 'distance_time', heading: 'distance + time' },
];

interface ExerciseRow {
  name: string;
  loggingType: LoggingType;
  primaryTag: string;
  additionalTags: string[];
}

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderTagNames(names: readonly string[]): string {
  const lines = names.map((name) => `  ${quote(name)},`).join('\n');
  return `const TAG_NAMES = [\n${lines}\n] as const;`;
}

function renderExerciseDefinitions(rows: readonly ExerciseRow[]): string {
  const byGroup = new Map<LoggingType, ExerciseRow[]>();
  for (const row of rows) {
    const bucket = byGroup.get(row.loggingType);
    if (bucket) bucket.push(row);
    else byGroup.set(row.loggingType, [row]);
  }
  for (const bucket of byGroup.values()) {
    bucket.sort((a, b) => a.primaryTag.localeCompare(b.primaryTag) || a.name.localeCompare(b.name));
  }

  const sections = GROUPS.map(({ loggingType, heading }) => {
    const rowsInGroup = byGroup.get(loggingType) ?? [];
    if (rowsInGroup.length === 0) return null;

    // Sam obiekt jest jednolinijkowy, jak w oryginale — prettier i tak zawinie
    // go na kilka linii, jeśli nie zmieści się w limicie szerokości. Wymuszony
    // z góry złam po `{` zablokowałby mu tę decyzję (prettier zachowuje ręcznie
    // wstawiony złam), więc każde ćwiczenie zajmowałoby kilka linii bez powodu.
    const entries = rowsInGroup
      .map((row) => {
        const fields = [
          `name: ${quote(row.name)}`,
          `loggingType: ${quote(row.loggingType)}`,
          `primaryTag: ${quote(row.primaryTag)}`,
        ];
        if (row.additionalTags.length > 0) {
          fields.push(`additionalTags: [${row.additionalTags.map(quote).join(', ')}]`);
        }
        return `  { ${fields.join(', ')} },`;
      })
      .join('\n');

    return `  // ${heading}\n${entries}`;
  }).filter((section): section is string => section !== null);

  return (
    `const EXERCISE_DEFINITIONS: readonly ExerciseDefinition[] = [\n` +
    `${sections.join('\n\n')}\n` +
    `];`
  );
}

export async function runRegenerateSeed(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  try {
    const tagRows = await connection.db
      .select()
      .from(tags)
      .where(isNull(tags.deletedAt))
      .orderBy(asc(tags.name));

    const exerciseRows = await connection.db
      .select()
      .from(exercises)
      .where(and(eq(exercises.authorId, SYSTEM_USER_ID), isNull(exercises.deletedAt)))
      .orderBy(asc(exercises.name));

    const exerciseIds = exerciseRows.map((row) => row.id);
    const additionalTagRows =
      exerciseIds.length === 0
        ? []
        : await connection.db
            .select()
            .from(exerciseTags)
            .where(inArray(exerciseTags.exerciseId, exerciseIds))
            .orderBy(asc(exerciseTags.position));

    const tagNameById = new Map(tagRows.map((tag) => [tag.id, tag.name]));
    const additionalByExercise = new Map<string, string[]>();
    for (const link of additionalTagRows) {
      const name = tagNameById.get(link.tagId);
      if (name === undefined) {
        throw new Error(
          `Ćwiczenie "${link.exerciseId}" ma tag dodatkowy "${link.tagId}", którego nie ma ` +
            'wśród aktywnych tagów (usunięty?) — popraw dane przed regeneracją seeda.',
        );
      }
      const bucket = additionalByExercise.get(link.exerciseId);
      if (bucket) bucket.push(name);
      else additionalByExercise.set(link.exerciseId, [name]);
    }

    const warnings: string[] = [];
    for (const tag of tagRows) {
      if (tagIdOf(tag.name) !== tag.id) {
        warnings.push(
          `Tag "${tag.name}" (${tag.id}) ma inne id niż wyliczone z aktualnej nazwy — ` +
            'był zmieniony po utworzeniu. Świeży seed od zera nada mu NOWE id.',
        );
      }
    }

    const exerciseDefinitions: ExerciseRow[] = exerciseRows.map((exercise) => {
      if (builtInExerciseId(exercise.name) !== exercise.id) {
        warnings.push(
          `Ćwiczenie "${exercise.name}" (${exercise.id}) ma inne id niż wyliczone z aktualnej ` +
            'nazwy — było zmienione po utworzeniu. Świeży seed od zera nada mu NOWE id.',
        );
      }
      const primaryTag = tagNameById.get(exercise.primaryTagId);
      if (primaryTag === undefined) {
        throw new Error(
          `Ćwiczenie "${exercise.name}" wskazuje tag główny "${exercise.primaryTagId}", ` +
            'którego nie ma wśród aktywnych tagów (usunięty?) — popraw dane przed regeneracją seeda.',
        );
      }
      return {
        name: exercise.name,
        loggingType: exercise.loggingType,
        primaryTag,
        additionalTags: additionalByExercise.get(exercise.id) ?? [],
      };
    });

    const original = await readFile(DATA_FILE, 'utf8');

    const withTags = original.replace(
      /const TAG_NAMES = \[[\s\S]*?\] as const;/,
      renderTagNames(tagRows.map((tag) => tag.name)),
    );
    if (withTags === original) {
      throw new Error(`Nie znaleziono bloku TAG_NAMES w ${DATA_FILE} — format pliku się zmienił.`);
    }

    const withExercises = withTags.replace(
      /const EXERCISE_DEFINITIONS: readonly ExerciseDefinition\[\] = \[[\s\S]*?\n\];/,
      renderExerciseDefinitions(exerciseDefinitions),
    );
    if (withExercises === withTags) {
      throw new Error(
        `Nie znaleziono bloku EXERCISE_DEFINITIONS w ${DATA_FILE} — format pliku się zmienił.`,
      );
    }

    await writeFile(DATA_FILE, withExercises);

    process.stderr.write(
      `Zregenerowano seed: ${String(tagRows.length)} tagów, ` +
        `${String(exerciseDefinitions.length)} ćwiczeń wbudowanych.\n` +
        `Uruchom "pnpm format" i sprawdź diff — kolejność ćwiczeń w pliku jest teraz ` +
        `deterministyczna (tag główny, potem nazwa), nie ręcznie ułożona.\n`,
    );
    for (const warning of warnings) process.stderr.write(`Uwaga: ${warning}\n`);
  } finally {
    await connection.close();
  }
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await runRegenerateSeed();
}
