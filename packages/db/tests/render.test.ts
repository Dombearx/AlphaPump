/**
 * Regeneracja `data.ts` z żywych danych (`render.ts`) — druga strona seeda.
 *
 * Test karmi `renderSeedDataFile` dokładnie tym, co wynika z obecnego
 * `data.ts` (nazwy, nie identyfikatory — dokładnie to, co dostałby endpoint
 * panelu z bazy), zapisuje wynik na dysk i **wykonuje go jako prawdziwy
 * moduł TS**. Sama treść jako tekst nie wystarcza: literówka w cudzysłowach
 * (`quote`) albo w szablonie ujawniłaby się dopiero jako błąd składni albo
 * runtime — coś, czego porównanie napisów nie złapie, a `tsx` uruchomiony
 * ręcznie na tym samym pliku złapał podczas budowy tego modułu.
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_EXERCISES, SEED_TAGS } from '../src/seed/data.js';
import { renderSeedDataFile, type RenderSeedExercise } from '../src/seed/render.js';

// Wykonywany moduł importuje `@alphapump/core` gołym specyfikatorem — Node
// rozwiązuje go, wędrując w górę od katalogu pliku. System `tmpdir()` leży
// poza workspace'em i nic by nie znalazł; katalog wewnątrz `packages/db`
// trafia na jego `node_modules` (workspace'owy symlink) tak samo, jak trafiłby
// prawdziwy import w tym pakiecie.
const TESTS_DIR = path.dirname(fileURLToPath(import.meta.url));

describe('renderSeedDataFile', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(TESTS_DIR, '.tmp-render-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('daje plik, który po wykonaniu odtwarza ten sam seed co oryginał', async () => {
    const tagNameById = new Map(SEED_TAGS.map((tag) => [tag.id, tag.name]));
    const exercises: RenderSeedExercise[] = SEED_EXERCISES.map((exercise) => ({
      name: exercise.name,
      loggingType: exercise.loggingType,
      primaryTag: tagNameById.get(exercise.primaryTagId)!,
      additionalTags: exercise.additionalTagIds.map((id) => tagNameById.get(id)!),
    }));

    const content = renderSeedDataFile({
      tagNames: SEED_TAGS.map((tag) => tag.name),
      exercises,
    });

    const file = path.join(dir, 'data.generated.ts');
    await writeFile(file, content);

    const generated = (await import(file)) as {
      SEED_TAGS: typeof SEED_TAGS;
      SEED_EXERCISES: typeof SEED_EXERCISES;
    };

    const byId = (rows: { id: string }[]) => new Map(rows.map((row) => [row.id, row]));
    expect(byId(generated.SEED_TAGS)).toEqual(byId(SEED_TAGS));
    expect(byId(generated.SEED_EXERCISES)).toEqual(byId(SEED_EXERCISES));
  });

  it('cytuje nazwy z apostrofem tak, żeby plik dalej był poprawnym TS-em', async () => {
    const content = renderSeedDataFile({
      tagNames: ['Chwyt szczypcowy'],
      exercises: [
        {
          name: "Farmer's walk",
          loggingType: 'weight_time',
          primaryTag: 'Chwyt szczypcowy',
          additionalTags: [],
        },
      ],
    });

    const file = path.join(dir, 'data.apostrophe.ts');
    await writeFile(file, content);

    const generated = (await import(file)) as { SEED_EXERCISES: { name: string }[] };
    expect(generated.SEED_EXERCISES.map((exercise) => exercise.name)).toEqual(["Farmer's walk"]);
  });

  it('nie gubi ćwiczeń bez tagów dodatkowych ani grup pustych z braku ćwiczeń danego typu', () => {
    const content = renderSeedDataFile({
      tagNames: ['Chest'],
      exercises: [
        {
          name: 'Push-ups',
          loggingType: 'bodyweight_reps',
          primaryTag: 'Chest',
          additionalTags: [],
        },
      ],
    });

    expect(content).toContain('// bodyweight + reps');
    expect(content).not.toContain('// weight + reps');
    // `additionalTags?:` w interfejsie zostaje — tego pilnujemy, żeby nie
    // złapać go zamiast prawdziwego wpisu `additionalTags: [...]` przy ćwiczeniu.
    expect(content).not.toContain('additionalTags: [');
  });
});
