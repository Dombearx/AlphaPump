import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/coverage/**',
      '**/.turbo/**',
      '**/.expo/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    /**
     * Pliki konfiguracyjne narzędzi (Babel, Metro, `app.config.js`) i wtyczki
     * Expo są CommonJS-em — czyta je Node, a nie bundler aplikacji. Bez tego
     * bloku `require`, `module` i `__dirname` wyglądają jak niezadeklarowane
     * globalne, a `require()` jak zakazany import.
     */
    files: ['**/*.js', '**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: {
        module: 'writable',
        exports: 'writable',
        require: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        console: 'readonly',
        URL: 'readonly',
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    /**
     * PebbleKit JS — połowa aplikacji na zegarek, wykonywana w piaskowce
     * **wewnątrz aplikacji Pebble na telefonie**. Ani Node, ani przeglądarka:
     * ma `localStorage` i `XMLHttpRequest`, nie ma `window`, a `Pebble` wstawia
     * do niej gospodarz. Bez tego bloku wszystkie trzy wyglądają jak literówki.
     */
    files: ['services/pebble/src/pkjs/**/*.js'],
    languageOptions: {
      globals: {
        Pebble: 'readonly',
        localStorage: 'readonly',
        XMLHttpRequest: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        // `caughtErrors` obejmuje też `catch (error)`, którego nikt nie czyta —
        // a takie miejsca istnieją tam, gdzie nie wolno użyć `catch {}` bez
        // wiązania: PebbleKit JS chodzi w piaskowce starszej niż ES2019.
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      /**
       * Konsola tylko tam, gdzie jest wyjściem procesu: `apps/api/src/logger.ts`
       * wypisuje linie JSON i wyłącza regułę u siebie, CLI pisze przez
       * `process.stdout`. Wcześniej reguła przepuszczała `warn` i `error`, więc
       * poziom logu wybierało się tak, żeby lint nie krzyczał — a nie tak, jak
       * wynikało z treści komunikatu.
       */
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  prettier,
);
