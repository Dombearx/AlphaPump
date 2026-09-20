import { describe, expect, it } from 'vitest';
import { INTENSITIES, intensityWeight, isIntensity } from '../src/intensity.js';

describe('intensityWeight', () => {
  it('liczy wysiłek wysokiej intensywności podwójnie w celu umiarkowanym', () => {
    // Równoważność z wytycznych WHO: minuta intensywnego = dwie umiarkowanego.
    expect(intensityWeight('moderate', 'high')).toBe(2);
    expect(intensityWeight('moderate', 'moderate')).toBe(1);
  });

  it('nie wpuszcza aktywności lekkiej do celów wyższych', () => {
    expect(intensityWeight('moderate', 'low')).toBe(0);
    expect(intensityWeight('high', 'low')).toBe(0);
  });

  it('cel wysoki liczy wyłącznie wysiłek wysoki, cel niski wyłącznie niski', () => {
    expect(intensityWeight('high', 'high')).toBe(1);
    expect(intensityWeight('high', 'moderate')).toBe(0);
    expect(intensityWeight('low', 'low')).toBe(1);
    expect(intensityWeight('low', 'moderate')).toBe(0);
  });

  it('ćwiczenie bez określonej intensywności nie zasila żadnego celu', () => {
    for (const goal of INTENSITIES) expect(intensityWeight(goal, null)).toBe(0);
  });
});

describe('isIntensity', () => {
  it('rozpoznaje wartości z listy i odrzuca resztę', () => {
    expect(isIntensity('moderate')).toBe(true);
    expect(isIntensity('extreme')).toBe(false);
    expect(isIntensity(null)).toBe(false);
  });
});
