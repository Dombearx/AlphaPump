import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Każdy plik testowy stawia własną bazę PGlite z kompletem migracji.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
