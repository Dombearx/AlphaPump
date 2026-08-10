import { describe, expect, it } from 'vitest';
import { hashString, tagColor, tagColorForSlug, TAG_COLORS } from '../src/tag-color.js';
import { slug } from '../src/slug.js';

describe('paleta', () => {
  it('ma dwadzieścia różnych kolorów w formacie #rrggbb', () => {
    expect(TAG_COLORS).toHaveLength(20);
    expect(new Set(TAG_COLORS).size).toBe(TAG_COLORS.length);
    for (const color of TAG_COLORS) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe('hashString', () => {
  it('jest deterministyczny i mieści się w 32 bitach bez znaku', () => {
    const hash = hashString('biceps');
    expect(hashString('biceps')).toBe(hash);
    expect(hash).toBeGreaterThanOrEqual(0);
    expect(hash).toBeLessThan(2 ** 32);
  });

  it('różnicuje bliskie napisy', () => {
    expect(hashString('biceps')).not.toBe(hashString('bicepsy'));
  });
});

describe('tagColor', () => {
  it('jest funkcją sluga, więc zapis nazwy nie ma znaczenia', () => {
    const kolor = tagColor('biceps');
    expect(tagColor('Biceps')).toBe(kolor);
    expect(tagColor('BICEPS')).toBe(kolor);
    expect(tagColor('  biceps  ')).toBe(kolor);
    expect(tagColorForSlug(slug('Biceps'))).toBe(kolor);
  });

  it('zawsze zwraca kolor z palety', () => {
    const nazwy = ['biceps', 'grzbiet', 'nogi', 'barki', 'brzuch', 'cardio', 'klatka', ''];
    for (const nazwa of nazwy) {
      expect(TAG_COLORS).toContain(tagColor(nazwa));
    }
  });

  it('rozkłada kilkadziesiąt tagów po dużej części palety', () => {
    const tagi = Array.from({ length: 40 }, (_, index) => `tag-${index}`);
    const uzyte = new Set(tagi.map((tag) => tagColorForSlug(tag)));
    expect(uzyte.size).toBeGreaterThanOrEqual(12);
  });

  it('nie zmienia koloru między wywołaniami — serwer nie musi go korygować', () => {
    const pierwszy = tagColorForSlug('klatka-piersiowa');
    const drugi = tagColorForSlug('klatka-piersiowa');
    expect(drugi).toBe(pierwszy);
  });
});
