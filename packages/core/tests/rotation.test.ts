/**
 * Kolejność podpowiadanych ćwiczeń.
 *
 * Sprawdzany jest scenariusz, dla którego ta funkcja powstała: w cyklu zostały
 * serie na biceps i na triceps, a użytkownik robi dwa ćwiczenia **na zmianę**,
 * seria za serią. Po każdej serii ekran ma podpowiedzieć to drugie ćwiczenie —
 * i ma to wynikać z samej historii dnia, bez żadnego stanu pamiętanego między
 * wejściami na ekran.
 */

import { describe, expect, it } from 'vitest';
import {
  orderByRotation,
  rotationFatigue,
  rotationScore,
  type RotatedExercise,
  type RotationContext,
} from '../src/rotation.js';

const TAGS = {
  biceps: 'tag-biceps',
  triceps: 'tag-triceps',
  back: 'tag-back',
  quads: 'tag-quads',
  cardio: 'tag-cardio',
} as const;

function exercise(
  id: string,
  primaryTagId: string,
  additionalTagIds: readonly string[] = [],
): RotatedExercise {
  return { id, primaryTagId, additionalTagIds };
}

/** Uginanie ramion — biceps, przy okazji plecy. */
const curl = exercise('curl', TAGS.biceps, [TAGS.back]);
/** Wyciskanie francuskie — sam triceps. */
const french = exercise('french', TAGS.triceps);
/** Wiosłowanie — plecy, przy okazji biceps. */
const row = exercise('row', TAGS.back, [TAGS.biceps]);
/** Przysiad — nic wspólnego z górą ciała. */
const squat = exercise('squat', TAGS.quads);
/** Bieg — wyłączony z podpowiadania. */
const run = exercise('run', TAGS.cardio);

function context(overrides: Partial<RotationContext> = {}): RotationContext {
  return {
    performed: [],
    tagNeed: new Map(),
    exerciseNeed: new Map(),
    excludedTagIds: new Set([TAGS.cardio]),
    ...overrides,
  };
}

/** Cykl z dwunastoma seriami na biceps i dwunastoma na triceps. */
function needAfter(bicepsSets: number, tricepsSets: number): ReadonlyMap<string, number> {
  return new Map([
    [TAGS.biceps, 1 - bicepsSets / 12],
    [TAGS.triceps, 1 - tricepsSets / 12],
  ]);
}

const LIBRARY = [curl, french, row, squat, run];

function order(ctx: RotationContext): string[] {
  return orderByRotation(LIBRARY, ctx).map((item) => item.id);
}

describe('zmęczenie z historii dnia', () => {
  it('pusty dzień nie męczy niczego', () => {
    expect(rotationFatigue(curl, [])).toBe(0);
  });

  it('to samo ćwiczenie co przed chwilą jest najgorszym przypadkiem', () => {
    expect(rotationFatigue(curl, [curl])).toBe(1);
  });

  it('ćwiczenie bez wspólnych tagów nie jest męczące', () => {
    expect(rotationFatigue(squat, [curl, french])).toBe(0);
  });

  it('wspólny tag dodatkowy męczy słabiej niż wspólny główny', () => {
    // Przysiad Zerchera bierze biceps pomocniczo, uginanie ramion — wprost.
    const zercher = exercise('zercher', TAGS.quads, [TAGS.biceps]);
    expect(rotationFatigue(zercher, [curl])).toBeLessThan(rotationFatigue(curl, [curl]));
    expect(rotationFatigue(zercher, [curl])).toBeGreaterThan(0);
  });

  it('wymiana tagów w obie strony jest tak samo zła jak powtórka', () => {
    // Wiosłowanie po uginaniu: jego tag główny jest dodatkowym uginania i na
    // odwrót. Obie partie dopiero co pracowały, więc gorzej być nie może.
    expect(rotationFatigue(row, [curl])).toBe(1);
  });

  it('ćwiczenie sprzed dwóch waży mniej niż ostatnie', () => {
    expect(rotationFatigue(curl, [curl, french])).toBeLessThan(
      rotationFatigue(curl, [french, curl]),
    );
  });

  it('kolejne serie tego samego ćwiczenia liczą się jako jedno wejście', () => {
    const czterySerieLawki = rotationFatigue(french, [curl, curl, curl, curl]);
    const jednaSeriaLawki = rotationFatigue(french, [curl]);
    expect(czterySerieLawki).toBe(jednaSeriaLawki);
  });
});

describe('naprzemienność dwóch ćwiczeń', () => {
  it('pusty dzień zostawia kolejność biblioteki', () => {
    expect(order(context({ tagNeed: needAfter(0, 0) }))).toEqual([
      'curl',
      'french',
      'row',
      'squat',
      'run',
    ]);
  });

  it('po serii na biceps na górę wchodzi triceps', () => {
    const ordered = order(context({ performed: [curl], tagNeed: needAfter(1, 0) }));
    expect(ordered[0]).toBe('french');
  });

  it('po serii na triceps wraca ćwiczenie na biceps', () => {
    const ordered = order(context({ performed: [curl, french], tagNeed: needAfter(1, 1) }));
    expect(ordered[0]).toBe('curl');
  });

  it('zamiana trzyma się przez kolejne rundy', () => {
    const trzecia = order(context({ performed: [curl, french, curl], tagNeed: needAfter(2, 1) }));
    expect(trzecia[0]).toBe('french');

    const czwarta = order(
      context({ performed: [curl, french, curl, french], tagNeed: needAfter(2, 2) }),
    );
    expect(czwarta[0]).toBe('curl');
  });

  it('serie tego samego ćwiczenia pod rząd nie psują zamiany', () => {
    const ordered = order(
      context({ performed: [curl, curl, curl, french], tagNeed: needAfter(3, 1) }),
    );
    expect(ordered[0]).toBe('curl');
  });
});

describe('rozdzielność partii', () => {
  it('ćwiczenie dzielące partie z poprzednim spada pod ćwiczenie świeże', () => {
    const ordered = order(context({ performed: [curl] }));
    expect(ordered.indexOf('squat')).toBeLessThan(ordered.indexOf('row'));
    expect(ordered.indexOf('squat')).toBeLessThan(ordered.indexOf('curl'));
  });

  it('bez cyklu w ogóle kolejność dalej rozdziela partie', () => {
    const ordered = order(context({ performed: [french] }));
    expect(ordered.at(-1)).toBe('french');
  });
});

describe('braki w cyklu', () => {
  it('większy brak idzie przed mniejszym', () => {
    const ctx = context({ tagNeed: needAfter(11, 0) });
    expect(rotationScore(french, ctx)).toBeGreaterThan(rotationScore(curl, ctx));
  });

  it('pozycja wskazująca wprost ćwiczenie podbija je ponad jego tag', () => {
    const ctx = context({ exerciseNeed: new Map([['row', 1]]) });
    expect(order(ctx)[0]).toBe('row');
  });

  it('pozycja zrobiona w całości nie podbija niczego', () => {
    const ctx = context({ tagNeed: needAfter(12, 12) });
    expect(rotationScore(curl, ctx)).toBe(0);
    expect(rotationScore(french, ctx)).toBe(0);
  });

  it('ćwiczenie z cyklu wygrywa z ćwiczeniem spoza cyklu także po swojej serii', () => {
    // Cykl prosi wyłącznie o biceps: po serii na biceps dalej ma być biceps,
    // bo nie ma innej niedokończonej pozycji, którą dałoby się w zamian zrobić.
    const ctx = context({ performed: [curl], tagNeed: new Map([[TAGS.biceps, 11 / 12]]) });
    expect(rotationScore(curl, ctx)).toBeGreaterThan(rotationScore(squat, ctx));
  });
});

describe('cardio', () => {
  it('nie jest podpowiadane, nawet gdy cykl o nie prosi', () => {
    const ctx = context({ tagNeed: new Map([[TAGS.cardio, 1]]) });
    expect(rotationScore(run, ctx)).toBe(0);
    expect(order(ctx)[0]).not.toBe('run');
  });

  it('nie jest też spychane na dół', () => {
    const ctx = context({ performed: [curl] });
    expect(rotationScore(run, ctx)).toBe(0);
    expect(order(ctx).indexOf('run')).toBeLessThan(order(ctx).indexOf('curl'));
  });

  it('wyłączenie obejmuje tag dodatkowy', () => {
    const marsz = exercise('marsz', TAGS.quads, [TAGS.cardio]);
    expect(rotationScore(marsz, context({ tagNeed: new Map([[TAGS.quads, 1]]) }))).toBe(0);
  });
});
