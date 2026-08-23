/**
 * Wybór języka zapisany na urządzeniu.
 *
 * Reguła, którą warto tu przypilnować, jest regułą **odporności**: rejestr
 * uszkodzony, pusty albo z kodem języka, którego już nie obsługujemy, ma dawać
 * język domyślny, a nie błąd. Ustawienie interfejsu nie jest danymi
 * użytkownika — jego utrata kosztuje jedno stuknięcie, a wyjątek przy starcie
 * kosztuje aplikację, która się nie uruchamia.
 */

import { DEFAULT_LANGUAGE } from '@alphapump/core';
import { describe, expect, it } from 'vitest';
import { parseLanguage, serializeLanguage } from '../src/language/state';

describe('rejestr języka', () => {
  it('czyta zapisany wybór', () => {
    expect(parseLanguage(serializeLanguage('pl'))).toBe('pl');
    expect(parseLanguage(serializeLanguage('en'))).toBe('en');
  });

  it('nieczytelny rejestr znaczy język domyślny', () => {
    expect(parseLanguage('to nie jest JSON')).toBe(DEFAULT_LANGUAGE);
  });

  it('nieznany kod języka znaczy język domyślny', () => {
    expect(parseLanguage(JSON.stringify({ language: 'de' }))).toBe(DEFAULT_LANGUAGE);
    expect(parseLanguage(JSON.stringify({}))).toBe(DEFAULT_LANGUAGE);
  });
});
