import { describe, expect, it } from 'vitest';
import { hashString, tagColor, tagColorForSlug } from '../src/tag-color.js';
import { slug } from '../src/slug.js';

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

  it('zawsze zwraca kolor w formacie #rrggbb', () => {
    const nazwy = ['biceps', 'grzbiet', 'nogi', 'barki', 'brzuch', 'cardio', 'klatka', ''];
    for (const nazwa of nazwy) {
      expect(tagColor(nazwa)).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('rozkłada kilkadziesiąt tagów po odcieniach — kolizje rzadsze niż przy małej, ustalonej palecie', () => {
    const tagi = Array.from({ length: 40 }, (_, index) => `tag-${index}`);
    const uzyte = new Set(tagi.map((tag) => tagColorForSlug(tag)));
    expect(uzyte.size).toBeGreaterThanOrEqual(30);
  });

  it('nie zmienia koloru między wywołaniami — serwer nie musi go korygować', () => {
    const pierwszy = tagColorForSlug('klatka-piersiowa');
    const drugi = tagColorForSlug('klatka-piersiowa');
    expect(drugi).toBe(pierwszy);
  });
});
