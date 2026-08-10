import { defineConfig } from 'vitest/config';

/**
 * Testy jednostkowe warstwy niezależnej od React Native.
 *
 * Ekranów nie renderujemy w Node — komponenty RN wymagają natywnego runtime'u,
 * a atrapy sprawdzałyby atrapy. Testujemy to, co da się sprawdzić uczciwie:
 * czystą logikę konfiguracji, wyjątków sieciowych i mapowania danych do bazy
 * lokalnej. Kompletność samego schematu lokalnego pilnują testy `@alphapump/db`.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
