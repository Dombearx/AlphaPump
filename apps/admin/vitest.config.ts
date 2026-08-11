import { defineConfig } from 'vitest/config';

/**
 * Testy panelu obejmują warstwę, w której da się popełnić błąd niewidoczny na
 * ekranie: klienta API i przekształcenia danych. Renderowania komponentów tu nie
 * ma — dla panelu tej wielkości test „czy tabela się wyświetliła" sprawdzałby
 * głównie React, a nie nasz kod, za cenę całego stosu jsdom w CI.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
