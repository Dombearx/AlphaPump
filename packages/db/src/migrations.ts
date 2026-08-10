/**
 * Ścieżki do katalogów migracji.
 *
 * Migracje są zwykłymi plikami SQL wygenerowanymi przez drizzle-kit i leżą
 * w paczce, a nie w aplikacji — dzięki temu serwer i testy uruchamiają
 * dokładnie ten sam zestaw, a nie dwie kopie, które mogą się rozjechać.
 *
 * Moduł jest wystawiony pod osobnym wejściem `@alphapump/db/migrations`, bo
 * sięga po `node:url` — czego pakiet aplikacji mobilnej nie powinien wciągać.
 */

import { fileURLToPath } from 'node:url';

/** Migracje PostgreSQL — dla `drizzle-orm/…/migrator` po stronie serwera. */
export const pgMigrationsFolder = fileURLToPath(new URL('../migrations/pg', import.meta.url));

/** Migracje SQLite — dla bazy lokalnej na telefonie i dla testów. */
export const sqliteMigrationsFolder = fileURLToPath(
  new URL('../migrations/sqlite', import.meta.url),
);
