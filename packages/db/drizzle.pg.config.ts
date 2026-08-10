import { defineConfig } from 'drizzle-kit';

/**
 * Migracje PostgreSQL. `pnpm --filter @alphapump/db generate:pg` po każdej
 * zmianie w `src/pg/schema.ts` — wygenerowanego SQL-a nie piszemy ręcznie.
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/pg/schema.ts', './src/pg/auth-schema.ts'],
  out: './migrations/pg',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://alphapump@localhost:5432/alphapump',
  },
});
