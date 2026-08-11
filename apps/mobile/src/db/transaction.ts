/**
 * Transakcja bazy lokalnej.
 *
 * Drizzle ma własne `db.transaction()`, ale jego sterownik `better-sqlite3` —
 * ten, na którym chodzą testy — zamyka transakcję **synchronicznie**, zaraz po
 * powrocie z funkcji. Funkcja `async` zwraca obietnicę natychmiast, więc
 * `COMMIT` poszedłby przed pierwszym `await` w środku, a reszta zapisów
 * wylądowałaby już poza transakcją. Na urządzeniu (`expo-sqlite`) działałoby to
 * poprawnie — czyli byłby to błąd widoczny wyłącznie tam, gdzie go nie testujemy.
 *
 * Dlatego transakcję prowadzimy sami, zwykłym SQL-em. `BEGIN`, `COMMIT`
 * i `ROLLBACK` dotyczą połączenia, a oba sterowniki trzymają jedno połączenie —
 * zapisy wykonane w środku tym samym uchwytem `db` należą więc do tej samej
 * transakcji, mimo że nie dostają osobnego obiektu `tx`.
 *
 * Transakcje **nie zagnieżdżają się**: SQLite nie zna zagnieżdżonego `BEGIN`,
 * a punkty zapisu byłyby ceremonią bez zastosowania. Funkcje zapisujące, które
 * wołają się nawzajem, dzielą się na warstwę „w transakcji" i cienką otoczkę.
 */

import type { SqliteDatabase } from '@alphapump/db/sqlite';
import { sql } from 'drizzle-orm';

export interface TransactionOptions {
  /**
   * Odracza sprawdzanie kluczy obcych do `COMMIT`.
   *
   * Potrzebne wyłącznie przy zapisie paczki pullu: przyjeżdża ona posortowana
   * po `server_seq`, czyli chronologicznie względem zapisu na serwerze, a nie
   * topologicznie względem zależności — seria potrafi więc wyprzedzić własne
   * ćwiczenie. Odroczenie nie jest osłabieniem więzów: niespójność, której nie
   * domyka żaden wiersz z tej samej paczki, dalej wywraca `COMMIT`.
   */
  deferForeignKeys?: boolean;
}

export async function withTransaction<T>(
  db: SqliteDatabase,
  run: () => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  await db.run(sql`begin`);

  try {
    // Pragma musi wejść **wewnątrz** transakcji — poza nią jest bez znaczenia,
    // a przy `COMMIT` wraca do wartości domyślnej.
    if (options.deferForeignKeys === true) await db.run(sql`pragma defer_foreign_keys = on`);

    const result = await run();
    await db.run(sql`commit`);
    return result;
  } catch (error) {
    await rollback(db);
    throw error;
  }
}

/**
 * Wycofanie nie może przesłonić błędu, który je wywołał — to on niesie przyczynę.
 * Nieudany `ROLLBACK` znaczy zwykle, że transakcja już nie żyje.
 */
async function rollback(db: SqliteDatabase): Promise<void> {
  try {
    await db.run(sql`rollback`);
  } catch {
    /* pusto — patrz komentarz */
  }
}
