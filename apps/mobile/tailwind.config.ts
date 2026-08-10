/**
 * Tailwind dla NativeWind.
 *
 * Kolory pochodzą z `src/theme.ts`, a nie są wpisane tu drugi raz — ten sam
 * zestaw obsługuje klasy Tailwinda i te miejsca, w których React Navigation
 * chce zwykłego napisu z kolorem. Konfiguracja jest w TypeScripcie właśnie po
 * to, żeby dało się go zaimportować.
 */
import type { Config } from 'tailwindcss';
// eslint-disable-next-line @typescript-eslint/no-require-imports -- preset Tailwinda jest CJS
const nativewindPreset = require('nativewind/preset');
import { COLORS } from './src/theme';

export default {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}'],
  presets: [nativewindPreset],
  theme: {
    extend: {
      colors: COLORS,
    },
  },
  plugins: [],
} satisfies Config;
