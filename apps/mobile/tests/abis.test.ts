/**
 * Architektury wchodzące do pliku `.apk`.
 *
 * Sprawdzane z tego samego powodu, co wyjątki cleartext obok: literówka tutaj
 * nie zatrzymuje budowy. Gradle nie znajduje bibliotek pod nieznaną nazwą,
 * pakuje plik bez nich, plik instaluje się normalnie — i wywala się dopiero
 * przy starcie na czyimś telefonie.
 */

import { describe, expect, it } from 'vitest';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseAbis, DEFAULT_ABIS, SUPPORTED_ABIS } = require('../config/abis');

describe('lista architektur', () => {
  it('domyślnie pakuje samo arm64 — każdy telefon po 2017 roku', () => {
    expect(parseAbis(null)).toEqual(['arm64-v8a']);
    expect(parseAbis(undefined)).toEqual(['arm64-v8a']);
  });

  it('traktuje pustą zmienną jak nieustawioną', () => {
    // Tak samo jak `config/env.js`: GitHub Actions ustawia `env:`
    // z nieistniejącego `vars.*` na pusty napis, nie na `undefined`.
    expect(parseAbis('')).toEqual(DEFAULT_ABIS);
    expect(parseAbis('  ')).toEqual(DEFAULT_ABIS);
    expect(parseAbis(' , ')).toEqual(DEFAULT_ABIS);
  });

  it('przyjmuje listę i znosi spacje wokół nazw', () => {
    expect(parseAbis('arm64-v8a, armeabi-v7a')).toEqual(['arm64-v8a', 'armeabi-v7a']);
  });

  it('odrzuca nazwę spoza listy NDK, zamiast zbudować plik bez bibliotek', () => {
    expect(() => parseAbis('arm64')).toThrow(/Nieznana architektura: arm64/);
    expect(() => parseAbis('arm64-v8a,x87')).toThrow(/x87/);
  });

  it('nie powtarza tej samej architektury', () => {
    expect(parseAbis('arm64-v8a,arm64-v8a')).toEqual(['arm64-v8a']);
  });

  it('zna wszystkie cztery architektury, które rozumie NDK', () => {
    expect(SUPPORTED_ABIS).toEqual(['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64']);
    expect(parseAbis(SUPPORTED_ABIS.join(','))).toEqual(SUPPORTED_ABIS);
  });

  it('nie oddaje własnej tablicy domyślnej do modyfikacji', () => {
    // Wywołujący dostaje kopię — inaczej dopisanie architektury po stronie
    // `app.config.js` zmieniłoby domyślną listę dla całego procesu.
    const first = parseAbis(null);
    first.push('x86');
    expect(parseAbis(null)).toEqual(['arm64-v8a']);
  });
});
