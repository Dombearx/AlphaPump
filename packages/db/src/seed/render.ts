/**
 * Wygenerowanie treści `data.ts` z żywych danych.
 *
 * Odwraca kierunek `data.ts`: zamiast być źródłem, z którego seed wypełnia
 * bazę, ten moduł bierze to, co administrator ustawił w bazie (przez panel
 * albo bezpośrednio), i składa z tego plik gotowy do wklejenia z powrotem do
 * repozytorium. Używają go dwa miejsca — `apps/api/src/cli/regenerate-seed.ts`
 * (developer z dostępem do bazy piszący prosto na dysk) i endpoint panelu
 * `GET /admin/seed/export` (produkcja, gdzie repo nie ma — obraz API niesie
 * tylko skompilowane `dist/`, patrz `deploy/Dockerfile.api`) — dlatego treść
 * jest tu składana **od zera** z szablonu, a nie przez podmianę fragmentu
 * istniejącego pliku.
 *
 * Szablon jest celowo bajt w bajt zgodny z ręcznie pisanym oryginałem: dopóki
 * nikt nic nie zmienił w adminie, regeneracja daje identyczną treść (patrz
 * `tests/render.test.ts`), a jedyna różnica po realnej zmianie to dwa bloki
 * niżej.
 */

import type { LoggingType } from '@alphapump/core';

export interface RenderSeedExercise {
  name: string;
  loggingType: LoggingType;
  primaryTag: string;
  additionalTags: readonly string[];
}

export interface RenderSeedDataFileInput {
  tagNames: readonly string[];
  exercises: readonly RenderSeedExercise[];
}

/** Kolejność sekcji ćwiczeń i ich nagłówki — te same, co w ręcznie pisanym oryginale. */
const GROUPS: readonly { loggingType: LoggingType; heading: string }[] = [
  { loggingType: 'weight_reps', heading: 'weight + reps' },
  { loggingType: 'bodyweight_reps', heading: 'bodyweight + reps' },
  { loggingType: 'bodyweight_time', heading: 'bodyweight + time' },
  { loggingType: 'weight_time', heading: 'weight + time' },
  { loggingType: 'distance_time', heading: 'distance + time' },
];

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function renderTagNames(names: readonly string[]): string {
  const lines = names.map((name) => `  ${quote(name)},`).join('\n');
  return `const TAG_NAMES = [\n${lines}\n] as const;`;
}

function renderExerciseDefinitions(rows: readonly RenderSeedExercise[]): string {
  const byGroup = new Map<LoggingType, RenderSeedExercise[]>();
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

export function renderSeedDataFile(input: RenderSeedDataFileInput): string {
  return `/**
 * Dane startowe — konto systemowe, tagi i ćwiczenia wbudowane.
 *
 * Zestaw jest **dialekt-agnostyczny**: to zwykłe obiekty, które seed
 * PostgreSQL i seed SQLite wstawiają jednym i tym samym wsadem. Identyfikatory
 * i kolory nie są tu wpisane ręcznie, tylko liczone funkcjami z \`@alphapump/core\`
 * — czyli dokładnie tak, jak policzy je telefon, tworząc tag offline.
 *
 * To jest sedno kryterium ukończenia etapu 2: seed po obu stronach daje
 * **identyczne identyfikatory** ćwiczeń wbudowanych, bo obie strony liczą je
 * z tej samej nazwy tym samym kodem.
 *
 * Ćwiczenia wbudowane potrzebują autora, bo \`authorId\` wchodzi w klucz
 * identyfikatora. Stałe konto systemowe sprawia, że ich id są takie same
 * w seedzie, w bazie i po odtworzeniu z kopii zapasowej.
 *
 * Ten plik da się zregenerować z żywej bazy poleceniem
 * \`pnpm --filter api regenerate-seed\` albo przyciskiem w panelu admina
 * (zakładka „Biblioteka") — patrz \`packages/db/src/seed/render.ts\`.
 */

import {
  SYSTEM_USER_ID,
  builtInExerciseId,
  slug,
  tagColor,
  tagId,
  type LoggingType,
} from '@alphapump/core';

/**
 * Znacznik czasu wierszy z seeda. Stały, a nie „teraz", z dwóch powodów: seed
 * uruchomiony dwa razy daje ten sam wynik, a wiersz wbudowany nigdy nie wygra
 * LWW z edycją użytkownika, bo jego \`updated_at\` leży w przeszłości.
 */
export const SEED_TIMESTAMP = new Date('2026-01-01T00:00:00.000Z');

/** Konto systemowe — autor wszystkich ćwiczeń wbudowanych. Nikt się na nie nie loguje. */
export const SYSTEM_USER = {
  id: SYSTEM_USER_ID,
  name: 'AlphaPump',
  nickname: 'AlphaPump',
  email: 'system@alphapump.local',
  role: 'admin',
} as const;

/** Ile wierszy słownikowych zawiera seed — do potwierdzenia w logu wdrożenia. */
export interface SeedSummary {
  tags: number;
  exercises: number;
}

export interface SeedTag {
  id: string;
  name: string;
  slug: string;
  color: string;
}

export interface SeedExercise {
  id: string;
  name: string;
  slug: string;
  authorId: string;
  loggingType: LoggingType;
  primaryTagId: string;
  additionalTagIds: string[];
}

/**
 * Tagi startowe. Lista jest krótka celowo — tagi tworzą użytkownicy, a te
 * poniżej mają tylko sprawić, że pierwsze ćwiczenie da się dodać bez zakładania
 * słownika od zera.
 */
${renderTagNames(input.tagNames)}

export type SeedTagName = (typeof TAG_NAMES)[number];

function makeTag(name: string): SeedTag {
  return { id: tagId(name), name, slug: slug(name), color: tagColor(name) };
}

export const SEED_TAGS: readonly SeedTag[] = TAG_NAMES.map(makeTag);

interface ExerciseDefinition {
  name: string;
  loggingType: LoggingType;
  primaryTag: SeedTagName;
  additionalTags?: readonly SeedTagName[];
}

/**
 * Ćwiczenia wbudowane. Każdy z pięciu typów logowania jest reprezentowany —
 * inaczej cała ścieżka „wybierz ćwiczenie, zapisz serię" byłaby przetestowana
 * tylko dla ciężaru z powtórzeniami.
 */
${renderExerciseDefinitions(input.exercises)}

export const SEED_EXERCISES: readonly SeedExercise[] = EXERCISE_DEFINITIONS.map((definition) => ({
  id: builtInExerciseId(definition.name),
  name: definition.name,
  slug: slug(definition.name),
  authorId: SYSTEM_USER.id,
  loggingType: definition.loggingType,
  primaryTagId: tagId(definition.primaryTag),
  additionalTagIds: (definition.additionalTags ?? []).map(tagId),
}));
`;
}
