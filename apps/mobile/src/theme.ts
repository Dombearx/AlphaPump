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
  /**
   * Tło ekranu. Ciemny szary, nie czerń — `#0b0b0f` czytało się jako czarny
   * ekran, a paleta ma się trzymać szarości, zostawiając czerń i biel na
   * krańcach, których dotyka tylko tekst.
   */
  base: '#232327',
  /** Karty, nagłówki, pola formularzy — o stopień jaśniej od tła. */
  surface: '#2f2f34',
  /** Obramowania i separatory — jeszcze jaśniejszy szary. */
  border: '#46464d',
  text: '#f4f4f5',
  muted: '#a1a1aa',
  accent: '#f97316',
  danger: '#f87171',
  success: '#4ade80',
} as const;

export type ColorName = keyof typeof COLORS;
