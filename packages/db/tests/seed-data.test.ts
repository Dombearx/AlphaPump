/**
 * Katalog ćwiczeń wbudowanych.
 */

import { describe, expect, it } from 'vitest';
import { SEED_EXERCISES } from '../src/seed/data.js';

describe('katalog ćwiczeń wbudowanych', () => {
  it('zawiera pompki bez obciążenia, obok wariantów z obciążeniem', () => {
    // Zgłoszenie #103: dyktowanie „Push up twenty four reps" z Pebble nie
    // znajdowało ćwiczenia „Push up" — katalog miał wyłącznie warianty
    // z obciążeniem, bez podstawowego ruchu na samej masie ciała.
    const pushUp = SEED_EXERCISES.find((exercise) => exercise.name === 'Push up');

    expect(pushUp).toBeDefined();
    expect(pushUp?.loggingType).toBe('bodyweight_reps');
  });
});
