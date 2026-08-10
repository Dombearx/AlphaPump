import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Migracje PGlite i SQLite stawiają bazę od zera przy każdym pliku testowym.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
