/**
 * Reguła i choreografia animacji zwycięstwa.
 *
 * Sprawdzamy dokładnie to, czego nie widać na ekranie: że animacja odpala się
 * **tylko** po dopisaniu serii z zaznaczonym polem, że okrzyki idą po kolei
 * zamiast powtarzać jeden napis, i że okna glifów wybuchu da się przeliczyć na
 * rosnący zakres interpolacji — bo niemalejący zakres wywraca `Animated`
 * dopiero na telefonie.
 */

import { describe, expect, it } from 'vitest';
import {
  VICTORY_BURST_MS,
  VICTORY_SPARK_COUNT,
  victoryFires,
  victoryShout,
  victorySparks,
} from '../src/victory';

describe('kiedy leci animacja zwycięstwa', () => {
  it('po dopisaniu serii z zaznaczonym polem', () => {
    expect(victoryFires('create', true)).toBe(true);
  });

  it('nie leci, gdy pole zostało odznaczone', () => {
    expect(victoryFires('create', false)).toBe(false);
  });

  it('nie leci przy poprawianiu ani usuwaniu serii', () => {
    // Zaznaczenie zjeżdża przy wejściu w edycję, ale reguła nie ma się opierać
    // na tym, że ktoś o tym pamiętał w ekranie.
    expect(victoryFires('update', true)).toBe(false);
    expect(victoryFires('delete', true)).toBe(false);
  });
});

describe('okrzyki', () => {
  it('druga animacja pod rząd krzyczy co innego', () => {
    expect(victoryShout(1)).not.toBe(victoryShout(0));
  });

  it('kolejne numery zawijają się na liście, a nie kończą pustką', () => {
    const shouts = Array.from({ length: 40 }, (_, round) => victoryShout(round));

    expect(shouts.every((shout) => shout.length > 0)).toBe(true);
    expect(new Set(shouts).size).toBeGreaterThan(1);
  });
});

describe('glify wybuchu', () => {
  const sparks = victorySparks();

  it('wypełniają okrąg równo i do końca', () => {
    expect(sparks).toHaveLength(VICTORY_SPARK_COUNT);
    expect(sparks.map((spark) => spark.angle)).toEqual([
      0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330,
    ]);
  });

  it('dosypują się po kolei, każdy w swoim oknie wewnątrz wybuchu', () => {
    const delays = sparks.map((spark) => spark.delayMs);

    expect(delays[0]).toBeGreaterThan(0);
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(new Set(delays).size).toBe(delays.length);
    expect(Math.max(...delays)).toBeLessThan(VICTORY_BURST_MS);
  });

  it('nie są wszystkie na jednym promieniu', () => {
    expect(new Set(sparks.map((spark) => spark.radiusRatio)).size).toBe(2);
  });

  it('mniejsza liczba glifów też rozkłada się po całym okręgu', () => {
    const few = victorySparks(4);

    expect(few.map((spark) => spark.angle)).toEqual([0, 90, 180, 270]);
    expect(few.every((spark) => spark.glyph.length > 0)).toBe(true);
  });
});
