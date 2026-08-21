/**
 * Kolejność wierszy w pullu a klucze obce.
 *
 * Pull przywozi wiersze posortowane po `server_seq` — chronologicznie względem
 * zapisu na serwerze, a nie topologicznie względem zależności. Ćwiczenie
 * potrafi więc przyjechać przed swoim autorem albo przed swoim tagiem.
 *
 * Ten plik dowodzi mechanizmu, na którym stoi pull: `defer_foreign_keys`
 * przenosi sprawdzenie więzów na `COMMIT`, więc kolejność **wewnątrz paczki**
 * przestaje mieć znaczenie, a niespójność faktyczna dalej nie przechodzi.
 * Alternatywa — zdjęcie kluczy obcych z telefonu — kupowałaby to samo za cenę
 * bazy lokalnej, w której nikt już niczego nie pilnuje.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestSqlite, type TestSqlite } from './databases.js';

const NOW = Date.now();

const AUTHOR = ['u-1', 'kuba@example.com', 'Kuba', 'user', NOW, NOW];
const TAG = ['t-1', 'Biceps', 'biceps', '#06b6d4', NOW, NOW];
const EXERCISE = ['e-1', 'Uginanie', 'uginanie', 'u-1', 'weight_reps', 't-1', NOW, NOW];

const INSERT_USER = `INSERT INTO users (id, email, nickname, role, created_at, updated_at)
                     VALUES (?, ?, ?, ?, ?, ?)`;
const INSERT_TAG = `INSERT INTO tags (id, name, slug, color, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?)`;
const INSERT_EXERCISE = `INSERT INTO exercises
                           (id, name, slug, author_id, logging_type, primary_tag_id, created_at, updated_at)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;

describe('kolejność wierszy w pullu', () => {
  let sqlite: TestSqlite;

  beforeEach(() => {
    sqlite = createTestSqlite();
  });

  afterEach(() => {
    sqlite.close();
  });

  it('bez odroczenia odrzuca ćwiczenie, które wyprzedziło swojego autora', () => {
    // To jest dokładnie ten scenariusz, którego pull nie może przeżyć: wiersz
    // poprawny, tylko przyjechał za wcześnie.
    expect(() => sqlite.client.prepare(INSERT_EXERCISE).run(...EXERCISE)).toThrow(/FOREIGN KEY/i);
  });

  it('z odroczeniem przyjmuje paczkę w dowolnej kolejności', () => {
    sqlite.client.exec('BEGIN');
    sqlite.client.pragma('defer_foreign_keys = ON');

    // Kolejność odwrotna do zależności — tak, jak potrafi przyjść z serwera.
    sqlite.client.prepare(INSERT_EXERCISE).run(...EXERCISE);
    sqlite.client.prepare(INSERT_TAG).run(...TAG);
    sqlite.client.prepare(INSERT_USER).run(...AUTHOR);

    expect(() => sqlite.client.exec('COMMIT')).not.toThrow();

    const rows = sqlite.client
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM exercises')
      .all();
    expect(rows[0]?.count).toBe(1);
  });

  it('odroczenie nie przepuszcza niespójności, której nikt nie domyka', () => {
    sqlite.client.exec('BEGIN');
    sqlite.client.pragma('defer_foreign_keys = ON');
    sqlite.client.prepare(INSERT_EXERCISE).run(...EXERCISE);
    sqlite.client.prepare(INSERT_TAG).run(...TAG);
    // Autora brak — i nie przyjdzie w tej paczce.

    expect(() => sqlite.client.exec('COMMIT')).toThrow(/FOREIGN KEY/i);
    sqlite.client.exec('ROLLBACK');

    const rows = sqlite.client
      .prepare<[], { count: number }>('SELECT COUNT(*) AS count FROM exercises')
      .all();
    expect(rows[0]?.count).toBe(0);
  });

  it('odroczenie obowiązuje tylko w swojej transakcji', () => {
    sqlite.client.exec('BEGIN');
    sqlite.client.pragma('defer_foreign_keys = ON');
    sqlite.client.prepare(INSERT_USER).run(...AUTHOR);
    sqlite.client.exec('COMMIT');

    // Po zamknięciu transakcji pragma wraca do zera — poza pullem więzy działają
    // natychmiastowo i błąd w kodzie aplikacji wychodzi od razu, nie na końcu.
    expect(() => sqlite.client.prepare(INSERT_EXERCISE).run(...EXERCISE)).toThrow(/FOREIGN KEY/i);
  });
});
