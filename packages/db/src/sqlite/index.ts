/** Wejście `@alphapump/db/sqlite` — schemat lokalny i jego seed. */

export * from './schema.js';
export { seedSqlite, truncateSqlite, type SqliteDatabase } from '../seed/sqlite.js';
