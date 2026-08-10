import { defineConfig } from 'drizzle-kit';

/**
 * Migracje SQLite — baza lokalna telefonu. Ten sam zestaw plików uruchamiają
 * testy, więc „przechodzi na czystym pliku SQLite" jest sprawdzane w CI,
 * a nie deklarowane.
 */
export default defineConfig({
  dialect: 'sqlite',
  schema: './src/sqlite/schema.ts',
  out: './migrations/sqlite',
  dbCredentials: {
    url: process.env.SQLITE_URL ?? 'file:./local.db',
  },
});
