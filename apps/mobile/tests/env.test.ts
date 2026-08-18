/**
 * Odczyt zmiennych środowiskowych dla `app.config.js`.
 *
 * To jest ten fragment, który psuje się w CI i nigdzie indziej: na maszynie
 * dewelopera nieustawiona zmienna jest `undefined`, a GitHub Actions ustawia
 * `env:` z nieistniejącego `vars.*` na pusty napis. Różnica między jednym
 * a drugim kosztowała wydanie, które instalowało się poprawnie i zamykało
 * natychmiast po uruchomieniu.
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { envValue } = require('../config/env');

describe('odczyt zmiennej środowiskowej', () => {
  it('oddaje wartość, gdy zmienna jest ustawiona', () => {
    expect(envValue('X', { X: 'web.apps.googleusercontent.com' })).toBe(
      'web.apps.googleusercontent.com',
    );
  });

  it('traktuje brak zmiennej jak brak wartości', () => {
    expect(envValue('X', {})).toBeNull();
  });

  it('traktuje pustą zmienną jak brak wartości', () => {
    // Tak wygląda `${{ vars.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID }}` w GitHub
    // Actions, gdy zmiennej repozytorium nikt nie ustawił.
    expect(envValue('X', { X: '' })).toBeNull();
    expect(envValue('X', { X: '   ' })).toBeNull();
  });
});
