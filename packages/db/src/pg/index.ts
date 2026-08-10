/** Wejście `@alphapump/db/pg` — schemat serwerowy i jego seed. */

export * from './schema.js';
export { seedPostgres, truncatePostgres, type PostgresDatabase } from '../seed/pg.js';
