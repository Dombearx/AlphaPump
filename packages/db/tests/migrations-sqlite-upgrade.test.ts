/**
 * Migracje SQLite na bazie, w której **już są dane**.
 *
 * `migrations-sqlite.test.ts` sprawdza czystą bazę i tym samym nie widzi całej
 * klasy błędów: telefon nie instaluje się od nowa przy każdym wydaniu, tylko
 * dokłada kolejne migracje do bazy pełnej serii, ćwiczeń i cykli. Migracja,
 * która przepisuje tabelę, potrafi na czystej bazie przejść bez zająknięcia,
 * a na pełnej zgubić wiersze albo odbić się o kolumnę, której jeszcze nie ma.
 *
 * Dlatego migracje są tu wykonywane **po kolei, wprost z plików**: najpierw
 * wszystkie oprócz ostatniej, potem wsad danych, a na końcu ostatnia. Tego
 * migrator Drizzle nie umożliwia — on stosuje cały zestaw naraz.
 */

import BetterSqlite3 from 'better-sqlite3';
import { readdirSync, readFileSync } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sqliteMigrationsFolder } from '../src/migrations.js';

const files = readdirSync(sqliteMigrationsFolder)
  .filter((name) => name.endsWith('.sql'))
  .sort();

function run(client: BetterSqlite3.Database, file: string): void {
  const sql = readFileSync(join(sqliteMigrationsFolder, file), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed.length > 0) client.exec(trimmed);
  }
}

describe('ostatnia migracja SQLite na bazie z danymi', () => {
  let directory: string;
  let client: BetterSqlite3.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'alphapump-upgrade-'));
    client = new BetterSqlite3(join(directory, 'alphapump.db'));
    client.pragma('foreign_keys = ON');
    for (const file of files.slice(0, -1)) run(client, file);
  });

  afterEach(() => {
    client.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it('zachowuje cykle, pozycje celu i serie', () => {
    client.exec(`
      INSERT INTO users (id, nickname, created_at, updated_at)
        VALUES ('user-1', 'Ja', 0, 0);
      INSERT INTO tags (id, name, slug, color, created_at, updated_at)
        VALUES ('tag-1', 'Klatka', 'klatka', '#aabbcc', 0, 0);
      INSERT INTO exercises (id, name, slug, author_id, logging_type, primary_tag_id, created_at, updated_at)
        VALUES ('ex-1', 'Ławka', 'lawka', 'user-1', 'weight_reps', 'tag-1', 0, 0);
      INSERT INTO workout_sets (id, user_id, exercise_id, performed_on, position, weight_g, reps, created_at, updated_at)
        VALUES ('set-1', 'user-1', 'ex-1', '2026-08-10', 0, 60000, 8, 0, 0);
      INSERT INTO cycles (id, user_id, name, starts_on, created_at, updated_at)
        VALUES ('cycle-1', 'user-1', 'Sierpień', '2026-08-01', 0, 0);
      INSERT INTO cycle_goals (id, cycle_id, metric, target, tag_id, position)
        VALUES ('goal-1', 'cycle-1', 'sets', 12, 'tag-1', 0);
    `);

    run(client, files[files.length - 1] ?? '');

    const goal = client
      .prepare<[], { id: string; target: number; tag_id: string | null }>(
        'SELECT id, target, tag_id FROM cycle_goals',
      )
      .get();
    expect(goal).toEqual({ id: 'goal-1', target: 12, tag_id: 'tag-1' });

    const counts = client
      .prepare<[], { sets: number; exercises: number }>(
        'SELECT (SELECT count(*) FROM workout_sets) AS sets, (SELECT count(*) FROM exercises) AS exercises',
      )
      .get();
    expect(counts).toEqual({ sets: 1, exercises: 1 });
  });

  it('dokłada nowe kolumny jako puste', () => {
    client.exec(`
      INSERT INTO users (id, nickname, created_at, updated_at)
        VALUES ('user-1', 'Ja', 0, 0);
      INSERT INTO tags (id, name, slug, color, created_at, updated_at)
        VALUES ('tag-1', 'Klatka', 'klatka', '#aabbcc', 0, 0);
      INSERT INTO exercises (id, name, slug, author_id, logging_type, primary_tag_id, created_at, updated_at)
        VALUES ('ex-1', 'Ławka', 'lawka', 'user-1', 'weight_reps', 'tag-1', 0, 0);
      INSERT INTO cycles (id, user_id, name, starts_on, created_at, updated_at)
        VALUES ('cycle-1', 'user-1', 'Sierpień', '2026-08-01', 0, 0);
      INSERT INTO cycle_goals (id, cycle_id, metric, target, tag_id, position)
        VALUES ('goal-1', 'cycle-1', 'sets', 12, 'tag-1', 0);
    `);

    run(client, files[files.length - 1] ?? '');

    const row = client
      .prepare<[], { stretch_target: number | null; intensity: string | null }>(
        'SELECT stretch_target, intensity FROM cycle_goals',
      )
      .get();
    expect(row).toEqual({ stretch_target: null, intensity: null });

    const exercise = client
      .prepare<[], { intensity: string | null }>('SELECT intensity FROM exercises')
      .get();
    expect(exercise).toEqual({ intensity: null });
  });

  it('po migracji przyjmuje cel intensywnościowy z dwoma poziomami', () => {
    client.exec(`
      INSERT INTO users (id, nickname, created_at, updated_at)
        VALUES ('user-1', 'Ja', 0, 0);
      INSERT INTO cycles (id, user_id, name, starts_on, created_at, updated_at)
        VALUES ('cycle-1', 'user-1', 'WHO', '2026-08-01', 0, 0);
    `);

    run(client, files[files.length - 1] ?? '');

    client.exec(`
      INSERT INTO cycle_goals (id, cycle_id, metric, target, stretch_target, intensity, position)
        VALUES ('goal-who', 'cycle-1', 'duration', 9000, 18000, 'moderate', 0);
    `);

    expect(() =>
      client.exec(`
        INSERT INTO cycle_goals (id, cycle_id, metric, target, intensity, tag_id, position)
          VALUES ('goal-dwa-zakresy', 'cycle-1', 'duration', 9000, 'moderate', 'tag-1', 1);
      `),
    ).toThrow();
  });
});
