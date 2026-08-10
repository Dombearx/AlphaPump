import { describe, expect, it } from 'vitest';
import {
  compareSetsChronologically,
  computeRecords,
  computeRecordsByExercise,
  dominates,
  evaluateRecord,
  paretoFront,
  pointsEqual,
  projectSet,
} from '../src/records.js';
import type { LoggingType } from '../src/logging-type.js';
import { makeSet, weightReps, type TestSet } from './helpers.js';

describe('dominacja', () => {
  it('wymaga bycia nie gorszym wszędzie i lepszym gdzieś', () => {
    expect(dominates([100, 10], [90, 10])).toBe(true);
    expect(dominates([100, 10], [100, 9])).toBe(true);
    expect(dominates([100, 10], [90, 9])).toBe(true);
  });

  it('nie zachodzi przy dokładnym remisie', () => {
    expect(dominates([100, 10], [100, 10])).toBe(false);
  });

  it('nie zachodzi, gdy punkty są nieporównywalne', () => {
    expect(dominates([100, 5], [50, 20])).toBe(false);
    expect(dominates([50, 20], [100, 5])).toBe(false);
  });

  it('odrzuca porównanie punktów o różnej liczbie osi', () => {
    expect(() => dominates([100], [100, 10])).toThrow(RangeError);
  });
});

describe('pointsEqual', () => {
  it('porównuje punkt po punkcie', () => {
    expect(pointsEqual([100, 10], [100, 10])).toBe(true);
    expect(pointsEqual([100, 10], [100, 11])).toBe(false);
    expect(pointsEqual([100], [100, 10])).toBe(false);
  });
});

describe('paretoFront', () => {
  it('zachowuje wszystkie punkty nieporównywalne', () => {
    const front = paretoFront(
      [
        [100, 5],
        [50, 20],
        [75, 10],
      ],
      (point) => point,
    );
    expect(front).toHaveLength(3);
  });

  it('odsiewa punkty zdominowane', () => {
    const front = paretoFront(
      [
        [100, 10],
        [90, 9],
        [100, 5],
      ],
      (point) => point,
    );
    expect(front).toEqual([[100, 10]]);
  });

  it('zachowuje oba egzemplarze dokładnego remisu — odsiewanie to sprawa prezentacji', () => {
    const front = paretoFront(
      [
        [100, 10],
        [100, 10],
      ],
      (point) => point,
    );
    expect(front).toHaveLength(2);
  });

  it('pomija elementy bez punktu', () => {
    const front = paretoFront([1, 2, 3], (value) => (value === 2 ? null : [value]));
    expect(front).toEqual([3]);
  });
});

describe('projectSet', () => {
  const cases: ReadonlyArray<[LoggingType, TestSet, number[] | null]> = [
    ['weight_reps', makeSet({ weightG: 80_000, reps: 5 }), [80_000, 5]],
    ['weight_time', makeSet({ weightG: 20_000, durationS: 60 }), [20_000, 60]],
    ['bodyweight_reps', makeSet({ reps: 12, bodyweightG: 82_000 }), [12]],
    ['bodyweight_time', makeSet({ durationS: 90, bodyweightG: 82_000 }), [90]],
    ['distance_time', makeSet({ distanceM: 5000, durationS: 1500 }), [5000, 1500]],
    ['weight_reps', makeSet({ weightG: 80_000 }), null],
    ['distance_time', makeSet({ distanceM: 5000 }), null],
  ];

  it.each(cases)('%s rzutuje na właściwe osie', (loggingType, set, expected) => {
    expect(projectSet(loggingType, set)).toEqual(expected);
  });

  it('dopuszcza zerowy ciężar, ale nie zerowe powtórzenia', () => {
    expect(projectSet('weight_reps', makeSet({ weightG: 0, reps: 10 }))).toEqual([0, 10]);
    expect(projectSet('weight_reps', makeSet({ weightG: 80_000, reps: 0 }))).toBeNull();
  });

  it('nie bierze masy ciała pod uwagę', () => {
    const lzejszy = makeSet({ reps: 10, bodyweightG: 70_000 });
    const ciezszy = makeSet({ reps: 10, bodyweightG: 95_000 });
    expect(projectSet('bodyweight_reps', lzejszy)).toEqual(projectSet('bodyweight_reps', ciezszy));
  });
});

describe('computeRecords', () => {
  it('utrzymuje na froncie wyniki nieporównywalne (przykład ze specyfikacji)', () => {
    const sets = [weightReps(15, 10), weightReps(10, 20)];
    const records = computeRecords('weight_reps', sets);
    expect(records).toHaveLength(2);
  });

  it('usuwa wyniki zdominowane', () => {
    const sets = [weightReps(100, 5), weightReps(90, 5), weightReps(100, 3)];
    const records = computeRecords('weight_reps', sets);
    expect(records.map((set) => [set.weightG, set.reps])).toEqual([[100_000, 5]]);
  });

  it('przy remisie zostawia pierwszą serię w porządku chronologicznym', () => {
    const wczesniejsza = weightReps(100, 5, { id: 'a', performedOn: '2026-08-01' });
    const pozniejsza = weightReps(100, 5, { id: 'b', performedOn: '2026-08-05' });
    const records = computeRecords('weight_reps', [wczesniejsza, pozniejsza]);
    expect(records).toHaveLength(1);
    expect(records[0]?.id).toBe('a');
  });

  it('sortuje malejąco po kolejnych osiach', () => {
    const sets = [weightReps(10, 20), weightReps(15, 10), weightReps(20, 3)];
    const records = computeRecords('weight_reps', sets);
    expect(records.map((set) => set.weightG)).toEqual([20_000, 15_000, 10_000]);
  });

  it('pomija serie bez kompletu pomiarów', () => {
    const sets = [weightReps(100, 5), makeSet({ weightG: 200_000 })];
    expect(computeRecords('weight_reps', sets)).toHaveLength(1);
  });

  it('dla masy ciała + powtórzeń liczy się wyłącznie liczba powtórzeń', () => {
    const sets = [
      makeSet({ reps: 12, bodyweightG: 95_000 }),
      makeSet({ reps: 15, bodyweightG: 70_000 }),
    ];
    const records = computeRecords('bodyweight_reps', sets);
    expect(records).toHaveLength(1);
    expect(records[0]?.reps).toBe(15);
  });

  it('dla dystansu i czasu dalszy oraz dłuższy bieg mogą być rekordami naraz', () => {
    const dalej = makeSet({ distanceM: 10_000, durationS: 3000 });
    const dluzej = makeSet({ distanceM: 8000, durationS: 3600 });
    expect(computeRecords('distance_time', [dalej, dluzej])).toHaveLength(2);
  });

  it('jest przeliczalny od zera — usunięcie serii cofa rekord', () => {
    const stary = weightReps(100, 5);
    const nowy = weightReps(120, 5);
    expect(computeRecords('weight_reps', [stary, nowy])).toHaveLength(1);
    expect(computeRecords('weight_reps', [stary])).toEqual([stary]);
  });

  it('nie zależy od kolejności wejścia poza rozstrzyganiem remisów', () => {
    const sets = [weightReps(10, 20), weightReps(15, 10), weightReps(12, 12)];
    const wPrzod = computeRecords('weight_reps', sets);
    const wTyl = computeRecords('weight_reps', [...sets].reverse());
    expect(wTyl).toEqual(wPrzod);
  });

  it('zwraca pustą listę dla braku serii', () => {
    expect(computeRecords('weight_reps', [])).toEqual([]);
  });
});

describe('evaluateRecord', () => {
  it('pierwsza seria ćwiczenia jest rekordem', () => {
    const wynik = evaluateRecord('weight_reps', [], weightReps(60, 8));
    expect(wynik).toMatchObject({ outcome: 'new', isRecord: true, beaten: [] });
  });

  it('rozpoznaje poprawę i wskazuje pobity rekord', () => {
    const poprzedni = weightReps(100, 5);
    const wynik = evaluateRecord('weight_reps', [poprzedni], weightReps(105, 5));
    expect(wynik.outcome).toBe('improved');
    expect(wynik.isRecord).toBe(true);
    expect(wynik.beaten).toEqual([poprzedni]);
  });

  it('rozpoznaje nowy punkt nieporównywalny z dotychczasowymi', () => {
    const wynik = evaluateRecord('weight_reps', [weightReps(100, 5)], weightReps(60, 20));
    expect(wynik.outcome).toBe('new');
    expect(wynik.isRecord).toBe(true);
    expect(wynik.beaten).toEqual([]);
  });

  it('dokładny remis nie jest rekordem — brak komunikatu', () => {
    const wynik = evaluateRecord('weight_reps', [weightReps(100, 5)], weightReps(100, 5));
    expect(wynik.outcome).toBe('tie');
    expect(wynik.isRecord).toBe(false);
    expect(wynik.beaten).toEqual([]);
  });

  it('seria zdominowana nie jest rekordem', () => {
    const wynik = evaluateRecord('weight_reps', [weightReps(100, 10)], weightReps(90, 5));
    expect(wynik.outcome).toBe('none');
    expect(wynik.isRecord).toBe(false);
  });

  it('seria równa dotychczasowej na jednej osi, lepsza na drugiej, jest rekordem', () => {
    const wynik = evaluateRecord('weight_reps', [weightReps(100, 5)], weightReps(100, 6));
    expect(wynik.outcome).toBe('improved');
    expect(wynik.isRecord).toBe(true);
  });

  it('pobija naraz kilka dotychczasowych rekordów', () => {
    const poprzednie = [weightReps(100, 5), weightReps(80, 10)];
    const wynik = evaluateRecord('weight_reps', poprzednie, weightReps(110, 12));
    expect(wynik.outcome).toBe('improved');
    expect(wynik.beaten).toHaveLength(2);
  });

  it('seria historyczna jest oceniana tak samo jak dzisiejsza', () => {
    const dzisiejsza = weightReps(100, 5, { performedOn: '2026-08-10' });
    const historyczna = weightReps(120, 5, { performedOn: '2026-01-02' });
    const wynik = evaluateRecord('weight_reps', [dzisiejsza], historyczna);
    expect(wynik.outcome).toBe('improved');
    expect(wynik.isRecord).toBe(true);
  });

  it('seria bez kompletu pomiarów nie bierze udziału w rekordach', () => {
    const wynik = evaluateRecord('weight_reps', [weightReps(100, 5)], makeSet({ reps: 5 }));
    expect(wynik.outcome).toBe('incomplete');
    expect(wynik.isRecord).toBe(false);
    expect(wynik.point).toBeNull();
  });

  it('masa ciała nie zmienia oceny rekordu', () => {
    const poprzednia = makeSet({ reps: 10, bodyweightG: 70_000 });
    const nowa = makeSet({ reps: 10, bodyweightG: 95_000 });
    expect(evaluateRecord('bodyweight_reps', [poprzednia], nowa).outcome).toBe('tie');
  });

  it.each([
    ['weight_time', { weightG: 20_000, durationS: 61 }, { weightG: 20_000, durationS: 60 }],
    ['bodyweight_time', { durationS: 121 }, { durationS: 120 }],
    [
      'distance_time',
      { distanceM: 10_100, durationS: 3000 },
      { distanceM: 10_000, durationS: 3000 },
    ],
  ] as const)('%s rozpoznaje poprawę', (loggingType, lepsza, gorsza) => {
    const wynik = evaluateRecord(loggingType, [makeSet(gorsza)], makeSet(lepsza));
    expect(wynik.outcome).toBe('improved');
  });
});

describe('compareSetsChronologically', () => {
  it('porządkuje po dniu, potem po pozycji, na końcu po id', () => {
    const sets = [
      makeSet({ id: 'c', performedOn: '2026-08-10', position: 1 }),
      makeSet({ id: 'a', performedOn: '2026-08-09', position: 5 }),
      makeSet({ id: 'b', performedOn: '2026-08-10', position: 0 }),
    ];
    expect([...sets].sort(compareSetsChronologically).map((set) => set.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('daje porządek całkowity także dla serii o tym samym dniu i pozycji', () => {
    const first = makeSet({ id: 'a', position: 0 });
    const second = makeSet({ id: 'b', position: 0 });
    expect(compareSetsChronologically(first, second)).toBeLessThan(0);
    expect(compareSetsChronologically(second, first)).toBeGreaterThan(0);
    expect(compareSetsChronologically(first, first)).toBe(0);
  });
});

describe('computeRecordsByExercise', () => {
  it('liczy rekordy osobno dla każdego ćwiczenia, zgodnie z jego typem logowania', () => {
    const typy: Record<string, LoggingType> = {
      wyciskanie: 'weight_reps',
      bieg: 'distance_time',
    };
    const sets = [
      weightReps(100, 5, { exerciseId: 'wyciskanie' }),
      weightReps(90, 5, { exerciseId: 'wyciskanie' }),
      makeSet({ exerciseId: 'bieg', distanceM: 5000, durationS: 1500 }),
    ];

    const records = computeRecordsByExercise(sets, (id) => typy[id]);

    expect(records.get('wyciskanie')).toHaveLength(1);
    expect(records.get('bieg')).toHaveLength(1);
  });

  it('pomija ćwiczenia o nieznanym typie logowania', () => {
    const sets = [weightReps(100, 5, { exerciseId: 'nieznane' })];
    expect(computeRecordsByExercise(sets, () => undefined).size).toBe(0);
  });
});
