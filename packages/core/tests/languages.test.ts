/**
 * Wielojęzyczne nazwy tagów i ćwiczeń.
 *
 * Najważniejsza reguła tego modułu jest regułą **braku**: wiersz bez
 * tłumaczenia ma wyglądać dokładnie tak, jak wyglądał przed dodaniem języków.
 * Biblioteka sprzed migracji, ćwiczenie utworzone offline i nazwa, której
 * automat nie zdążył przetłumaczyć, nie mogą pokazać pustej pozycji.
 */

import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  isLanguage,
  localizedName,
  mergeTranslations,
  missingLanguages,
} from '../src/languages.js';

describe('języki', () => {
  it('zna polski i angielski, a domyślny jest wśród nich', () => {
    expect([...LANGUAGES].sort()).toEqual(['en', 'pl']);
    expect(LANGUAGES).toContain(DEFAULT_LANGUAGE);
  });

  it('rozpoznaje kod języka', () => {
    expect(isLanguage('pl')).toBe(true);
    expect(isLanguage('de')).toBe(false);
    expect(isLanguage(null)).toBe(false);
  });
});

describe('nazwa do pokazania', () => {
  it('bierze tłumaczenie na wybrany język', () => {
    const tag = { name: 'chest', translations: { pl: 'klatka', en: 'chest' } };
    expect(localizedName(tag, 'pl')).toBe('klatka');
  });

  it('cofa się do nazwy kanonicznej, gdy tłumaczenia nie ma', () => {
    expect(localizedName({ name: 'Zercher squat', translations: null }, 'pl')).toBe(
      'Zercher squat',
    );
    expect(localizedName({ name: 'Calf raise', translations: { en: 'Calf raise' } }, 'pl')).toBe(
      'Calf raise',
    );
  });

  it('traktuje puste tłumaczenie jak jego brak', () => {
    expect(localizedName({ name: 'Deadlift', translations: { pl: '   ' } }, 'pl')).toBe('Deadlift');
  });
});

describe('braki do uzupełnienia', () => {
  it('wskazuje języki bez nazwy', () => {
    expect(missingLanguages(null).sort()).toEqual(['en', 'pl']);
    expect(missingLanguages({ pl: 'klatka' })).toEqual(['en']);
    expect(missingLanguages({ pl: 'klatka', en: 'chest' })).toEqual([]);
  });
});

describe('domykanie zestawu tłumaczeń', () => {
  it('uzupełnia wyłącznie luki — wpisane ręcznie ma pierwszeństwo', () => {
    expect(mergeTranslations({ pl: 'klatka' }, { pl: 'pierś', en: 'chest' })).toEqual({
      pl: 'klatka',
      en: 'chest',
    });
  });

  it('przycina białe znaki i pomija puste nazwy', () => {
    expect(mergeTranslations(null, { pl: '  klatka  ', en: '' })).toEqual({ pl: 'klatka' });
  });

  it('oddaje null, gdy nie ma czego zapisać', () => {
    expect(mergeTranslations(null, null)).toBeNull();
  });
});
