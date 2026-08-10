import { describe, expect, it } from 'vitest';
import { isSlug, slug } from '../src/slug.js';

describe('slug', () => {
  it('sprowadza polskie znaki diakrytyczne do ASCII', () => {
    expect(slug('Wyciskanie sztangi leżąc')).toBe('wyciskanie-sztangi-lezac');
    expect(slug('Martwy ciąg')).toBe('martwy-ciag');
    expect(slug('ĄĆĘŁŃÓŚŹŻ')).toBe('acelnoszz');
    expect(slug('ąćęłńóśźż')).toBe('acelnoszz');
  });

  it('sprowadza do jednej postaci nazwy różniące się tylko wielkością liter', () => {
    expect(slug('Biceps')).toBe(slug('biceps'));
    expect(slug('BICEPS')).toBe(slug('biceps'));
  });

  it('nie zależy od formy normalizacji Unicode wejścia', () => {
    const composed = 'żałoba'.normalize('NFC');
    const decomposed = 'żałoba'.normalize('NFD');
    expect(slug(composed)).toBe(slug(decomposed));
  });

  it('zamienia każdą sekwencję znaków spoza [a-z0-9] na pojedynczy myślnik', () => {
    expect(slug('Nogi – przód')).toBe('nogi-przod');
    expect(slug('Triceps / ramię')).toBe('triceps-ramie');
    expect(slug('Podciąganie   (nachwyt)')).toBe('podciaganie-nachwyt');
    expect(slug('Wznosy bokiem — hantle')).toBe('wznosy-bokiem-hantle');
  });

  it('usuwa apostrofy zamiast zamieniać je na myślnik', () => {
    expect(slug("Farmer's walk")).toBe('farmers-walk');
    expect(slug('Farmer’s walk')).toBe('farmers-walk');
  });

  it('obcina myślniki z brzegów i zwija powtórzenia', () => {
    expect(slug('  Barki  ')).toBe('barki');
    expect(slug('---bieg---')).toBe('bieg');
    expect(slug('bieg -- 10 km')).toBe('bieg-10-km');
  });

  it('zachowuje cyfry', () => {
    expect(slug('Bieg 10 km')).toBe('bieg-10-km');
    expect(slug('Wyciskanie 45°')).toBe('wyciskanie-45');
  });

  it('jest idempotentny — slug ze sluga to ten sam slug', () => {
    const names = [
      'Wyciskanie sztangi leżąc',
      "Farmer's walk",
      'Nogi – przód',
      '  Barki  ',
      'Bieg 10 km',
    ];
    for (const name of names) {
      expect(slug(slug(name))).toBe(slug(name));
    }
  });

  it('zwraca pusty napis dla nazw bez liter i cyfr', () => {
    expect(slug('   ')).toBe('');
    expect(slug('---')).toBe('');
    expect(slug('!@#$%')).toBe('');
  });
});

describe('isSlug', () => {
  it('rozpoznaje napisy będące już slugiem', () => {
    expect(isSlug('martwy-ciag')).toBe(true);
    expect(isSlug('bieg-10-km')).toBe(true);
  });

  it('odrzuca napisy wymagające normalizacji oraz pusty napis', () => {
    expect(isSlug('Martwy ciąg')).toBe(false);
    expect(isSlug('-bieg')).toBe(false);
    expect(isSlug('')).toBe(false);
  });
});
