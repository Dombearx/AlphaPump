import { describe, expect, it } from 'vitest';
import {
  TAG_PALETTE,
  assignTagColors,
  hashString,
  tagColor,
  tagColorForSlug,
} from '../src/tag-color.js';
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

/* --------------------------------------------------- odróżnialność palety */

/** sRGB → CIELAB (D65). Tyle matematyki, ile potrzeba do ΔE. */
function toLab(hex: string): [number, number, number] {
  const channel = (offset: number): number => {
    const value = Number.parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [channel(1), channel(3), channel(5)];

  const white = [0.95047, 1, 1.08883];
  const xyz = [
    (r * 0.4124 + g * 0.3576 + b * 0.1805) / white[0]!,
    (r * 0.2126 + g * 0.7152 + b * 0.0722) / white[1]!,
    (r * 0.0193 + g * 0.1192 + b * 0.9505) / white[2]!,
  ].map((value) => (value > 0.008856 ? Math.cbrt(value) : 7.787 * value + 16 / 116));

  return [116 * xyz[1]! - 16, 500 * (xyz[0]! - xyz[1]!), 200 * (xyz[1]! - xyz[2]!)];
}

/**
 * CIEDE2000 — miara „czy człowiek widzi różnicę". Próg zauważalności to ok. 2,
 * a „to inny kolor" zaczyna się w okolicach 10. Prostsza odległość euklidesowa
 * w Lab zawyżałaby wynik dla barw nasyconych, czyli dokładnie tam, gdzie leży
 * większość palety.
 */
function deltaE2000(first: string, second: string): number {
  const [l1, a1, b1] = toLab(first);
  const [l2, a2, b2] = toLab(second);
  const rad = Math.PI / 180;
  const deg = 180 / Math.PI;

  const c1 = Math.hypot(a1, b1);
  const c2 = Math.hypot(a2, b2);
  const meanC = (c1 + c2) / 2;
  const g = 0.5 * (1 - Math.sqrt(meanC ** 7 / (meanC ** 7 + 25 ** 7)));

  const ap1 = (1 + g) * a1;
  const ap2 = (1 + g) * a2;
  const cp1 = Math.hypot(ap1, b1);
  const cp2 = Math.hypot(ap2, b2);
  const hp1 = (Math.atan2(b1, ap1) * deg + 360) % 360;
  const hp2 = (Math.atan2(b2, ap2) * deg + 360) % 360;

  const deltaL = l2 - l1;
  const deltaC = cp2 - cp1;
  let deltaSmallH = 0;
  if (cp1 * cp2 !== 0) {
    deltaSmallH = hp2 - hp1;
    if (deltaSmallH > 180) deltaSmallH -= 360;
    else if (deltaSmallH < -180) deltaSmallH += 360;
  }
  const deltaH = 2 * Math.sqrt(cp1 * cp2) * Math.sin((deltaSmallH / 2) * rad);

  const meanL = (l1 + l2) / 2;
  const meanCp = (cp1 + cp2) / 2;
  let meanH = hp1 + hp2;
  if (cp1 * cp2 !== 0) {
    meanH = (hp1 + hp2) / 2;
    if (Math.abs(hp1 - hp2) > 180) meanH += hp1 + hp2 < 360 ? 180 : -180;
  }

  const t =
    1 -
    0.17 * Math.cos((meanH - 30) * rad) +
    0.24 * Math.cos(2 * meanH * rad) +
    0.32 * Math.cos((3 * meanH + 6) * rad) -
    0.2 * Math.cos((4 * meanH - 63) * rad);

  const sl = 1 + (0.015 * (meanL - 50) ** 2) / Math.sqrt(20 + (meanL - 50) ** 2);
  const sc = 1 + 0.045 * meanCp;
  const sh = 1 + 0.015 * meanCp * t;
  const rt =
    -Math.sin(2 * (30 * Math.exp(-(((meanH - 275) / 25) ** 2))) * rad) *
    (2 * Math.sqrt(meanCp ** 7 / (meanCp ** 7 + 25 ** 7)));

  return Math.sqrt(
    (deltaL / sl) ** 2 +
      (deltaC / sc) ** 2 +
      (deltaH / sh) ** 2 +
      rt * (deltaC / sc) * (deltaH / sh),
  );
}

describe('TAG_PALETTE', () => {
  it('ma dwadzieścia różnych kolorów w formacie #rrggbb', () => {
    expect(TAG_PALETTE).toHaveLength(20);
    expect(new Set(TAG_PALETTE).size).toBe(20);
    for (const color of TAG_PALETTE) expect(color).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('każda para jest wyraźnie różna, nie tylko odcieniem tego samego koloru', () => {
    let closest = { pair: '', distance: Number.POSITIVE_INFINITY };
    for (let first = 0; first < TAG_PALETTE.length; first += 1) {
      for (let second = first + 1; second < TAG_PALETTE.length; second += 1) {
        const distance = deltaE2000(TAG_PALETTE[first]!, TAG_PALETTE[second]!);
        if (distance < closest.distance) {
          closest = { pair: `${TAG_PALETTE[first]!} vs ${TAG_PALETTE[second]!}`, distance };
        }
      }
    }

    // Zgłoszenie brzmiało „część tagów ma ten sam kolor" — czyli progiem jest
    // odróżnialność, a nie sam fakt, że hexy się różnią.
    expect(closest.distance, closest.pair).toBeGreaterThan(12);
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
      expect(TAG_PALETTE).toContain(tagColor(nazwa));
    }
  });

  it('omija kolory już zajęte', () => {
    const wolny = tagColor('nogi');
    expect(tagColor('nogi', [wolny])).not.toBe(wolny);
    expect(TAG_PALETTE).toContain(tagColor('nogi', [wolny]));
  });

  it('nie zmienia koloru między wywołaniami — serwer nie musi go korygować', () => {
    const pierwszy = tagColorForSlug('klatka-piersiowa');
    const drugi = tagColorForSlug('klatka-piersiowa');
    expect(drugi).toBe(pierwszy);
  });
});

describe('assignTagColors', () => {
  it('daje dwadzieścia różnych kolorów dwudziestu tagom', () => {
    const tagi = Array.from({ length: 20 }, (_, index) => ({ slug: `tag-${index}` }));
    const kolory = assignTagColors(tagi);

    expect(new Set(kolory).size).toBe(20);
  });

  it('przydziela po kolei, więc każdy nowy tag omija zajęte', () => {
    // Tak liczy telefon i serwer: kolor po kolorze, każdy z listą zajętych.
    const slugi = Array.from({ length: 20 }, (_, index) => `tag-${index}`);
    const kolory: string[] = [];
    for (const tagSlug of slugi) kolory.push(tagColorForSlug(tagSlug, kolory));

    expect(new Set(kolory).size).toBe(20);
  });

  it('powyżej dwudziestu tagów kolory mogą się powtarzać', () => {
    const tagi = Array.from({ length: 25 }, (_, index) => ({ slug: `tag-${index}` }));
    const kolory = assignTagColors(tagi);

    expect(kolory).toHaveLength(25);
    expect(new Set(kolory).size).toBe(20);
    for (const kolor of kolory) expect(TAG_PALETTE).toContain(kolor);
  });

  it('zostawia kolory, które już są z palety i nie dublują się', () => {
    const tagi = [
      { slug: 'nogi', color: TAG_PALETTE[3] },
      { slug: 'barki', color: TAG_PALETTE[7] },
    ];

    expect(assignTagColors(tagi)).toEqual([TAG_PALETTE[3], TAG_PALETTE[7]]);
  });

  it('rozdziela duplikat i przekolorowuje kolor spoza palety', () => {
    const tagi = [
      { slug: 'nogi', color: TAG_PALETTE[3] },
      { slug: 'posladki', color: TAG_PALETTE[3] },
      { slug: 'barki', color: '#3f7fbf' },
      { slug: 'brzuch', color: null },
    ];

    const kolory = assignTagColors(tagi);

    expect(kolory[0]).toBe(TAG_PALETTE[3]);
    expect(new Set(kolory).size).toBe(4);
    for (const kolor of kolory) expect(TAG_PALETTE).toContain(kolor);
  });

  it('jest idempotentna — drugi przebieg niczego nie tasuje', () => {
    const tagi = Array.from({ length: 12 }, (_, index) => ({
      slug: `tag-${index}`,
      color: index % 3 === 0 ? '#123456' : null,
    }));

    const pierwszy = assignTagColors(tagi);
    const drugi = assignTagColors(tagi.map((tag, index) => ({ ...tag, color: pierwszy[index]! })));

    expect(drugi).toEqual(pierwszy);
  });
});
