import { defineConfig } from 'vitest/config';

/**
 * Dwa zestawy testów, bo sprawdzają dwie różne rzeczy.
 *
 * **`logika`** — klient API i przekształcenia danych, czyli warstwa, w której da
 * się popełnić błąd niewidoczny na ekranie. Chodzi w Node.
 *
 * **`komponenty`** — formularze i tabele renderowane naprawdę, w jsdom. Nie po
 * to, żeby sprawdzać, „czy tabela się wyświetliła" — to sprawdzałoby Reacta —
 * tylko po to, żeby sprawdzić reguły, które **istnieją wyłącznie w komponencie**:
 * co dokładnie wychodzi z formularza po zmianie jednego pola, i co pokazujemy
 * zamiast przycisku, gdy operacja jest zabroniona. Bez tego jedyną informacją
 * o zepsutym panelu jest czyjeś kliknięcie.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: { name: 'logika', include: ['tests/**/*.test.ts'], environment: 'node' },
      },
      {
        test: {
          name: 'komponenty',
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./tests/components/setup.ts'],
          testTimeout: 20_000,
        },
      },
    ],
  },
});
