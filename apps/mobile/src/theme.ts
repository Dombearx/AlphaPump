/**
 * Paleta.
 *
 * Jeden motyw — ciemny. Specyfikacja wymaga dark theme, a przełącznik oznaczałby
 * dwa zestawy kolorów do utrzymania i dwa razy więcej miejsc, w których ekran
 * może wyglądać źle.
 *
 * Te same wartości wchodzą do Tailwinda (`tailwind.config.js`) i do miejsc,
 * w których React Navigation chce zwykłego napisu z kolorem — dlatego mieszkają
 * w module TypeScript, a nie w samej konfiguracji Tailwinda.
 */

export const COLORS = {
  /** Tło ekranu. */
  base: '#0b0b0f',
  /** Karty, nagłówki, pola formularzy. */
  surface: '#16161d',
  /** Obramowania i separatory. */
  border: '#2a2a35',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#f97316',
  danger: '#f87171',
  success: '#4ade80',
} as const;

export type ColorName = keyof typeof COLORS;
