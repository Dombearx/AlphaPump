/**
 * Kody odrzuceń. Zakres wprost:
 *
 * > serwer przysyła kod, a zdanie powstaje po stronie, która je pokazuje.
 *
 * Test pilnuje dwóch rzeczy, których nie widać w żadnym innym: że **każdy** kod
 * ma zdanie (kod bez zdania wyszedłby na ekran jako `undefined`) i że żadne
 * z tych zdań nie jest po polsku — bo aplikacja jest po angielsku, a to jest
 * dokładnie ta ścieżka, którą polskie komunikaty serwera trafiały wcześniej
 * do odznaki synchronizacji.
 */

import { describe, expect, it } from 'vitest';
import { SYNC_REJECTIONS, describeRejection, isRetryableRejection } from '../src/index.js';

describe('kody odrzuceń', () => {
  it('każdy kod ma zdanie', () => {
    for (const code of SYNC_REJECTIONS) {
      expect(describeRejection(code), code).toBeTruthy();
    }
  });

  it('żadne zdanie nie jest po polsku', () => {
    for (const code of SYNC_REJECTIONS) {
      expect(describeRejection(code, 'detail'), code).not.toMatch(/[ąćęłńóśźż]/i);
    }
  });

  it('wstawia szczegół tam, gdzie komunikat go przewiduje', () => {
    expect(describeRejection('missing_tags', 'a, b')).toContain('a, b');
    expect(describeRejection('measurements_mismatch', 'weight_reps')).toContain('weight_reps');
    expect(describeRejection('slug_taken', 'Biceps')).toContain('Biceps');
  });

  it('radzi sobie bez szczegółu, choć go oczekuje', () => {
    // Odrzucenie ze starego serwera nie niesie `detail`. Ekran ma pokazać
    // niepełne zdanie, a nie wywrócić się na `undefined` w środku napisu.
    expect(describeRejection('missing_tags')).not.toContain('undefined');
  });

  it('ponawiać warto wyłącznie wiersz, który zniknął w trakcie zapisu', () => {
    // Reszta jest rozstrzygnięciem reguły: ten sam wiersz wysłany ponownie
    // odbije się tak samo, więc kolejka wysyłki nie ma na co czekać.
    const retryable = SYNC_REJECTIONS.filter(isRetryableRejection);
    expect(retryable).toEqual(['vanished']);
  });
});
