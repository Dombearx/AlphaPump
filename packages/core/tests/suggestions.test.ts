import { describe, expect, it } from 'vitest';
import { nextPosition, suggestNextSet } from '../src/suggestions.js';
import { makeSet, weightReps } from './helpers.js';

describe('suggestNextSet', () => {
  it('zwraca nic, gdy ćwiczenie nie było jeszcze nigdy wykonywane', () => {
    expect(suggestNextSet('weight_reps', [], '2026-08-10')).toBeNull();
  });

  it('podpowiada wartości z ostatniej serii tego samego dnia', () => {
    const sets = [
      weightReps(60, 10, { performedOn: '2026-08-10', position: 0 }),
      weightReps(60, 8, { performedOn: '2026-08-10', position: 1 }),
    ];

    const suggestion = suggestNextSet('weight_reps', sets, '2026-08-10');

    expect(suggestion?.reason).toBe('same-day');
    expect(suggestion?.measurements).toMatchObject({ weightG: 60_000, reps: 8 });
  });

  it('podpowiada pierwszą serię z ostatniego wcześniejszego dnia (przykład ze specyfikacji)', () => {
    const poniedzialek = [10, 9, 6, 4].map((reps, position) =>
      weightReps(60, reps, { performedOn: '2026-08-10', position }),
    );

    const sroda = suggestNextSet('weight_reps', poniedzialek, '2026-08-12');

    expect(sroda?.reason).toBe('previous-day');
    expect(sroda?.measurements.reps).toBe(10);
  });

  it('po wpisaniu pierwszej serii w nowym dniu podpowiada już z tego dnia', () => {
    const poniedzialek = [10, 9, 6, 4].map((reps, position) =>
      weightReps(60, reps, { performedOn: '2026-08-10', position }),
    );
    const sroda = weightReps(60, 8, { performedOn: '2026-08-12', position: 0 });

    const kolejna = suggestNextSet('weight_reps', [...poniedzialek, sroda], '2026-08-12');

    expect(kolejna?.reason).toBe('same-day');
    expect(kolejna?.measurements.reps).toBe(8);
  });

  it('bierze najświeższy wcześniejszy dzień, a nie najstarszy', () => {
    const sets = [
      weightReps(50, 5, { performedOn: '2026-07-01', position: 0 }),
      weightReps(70, 7, { performedOn: '2026-08-01', position: 0 }),
      weightReps(60, 6, { performedOn: '2026-07-15', position: 0 }),
    ];

    const suggestion = suggestNextSet('weight_reps', sets, '2026-08-10');
    expect(suggestion?.measurements).toMatchObject({ weightG: 70_000, reps: 7 });
  });

  it('uzupełnianie historii wstecz nie podpowiada z przyszłości', () => {
    const sets = [
      weightReps(50, 5, { performedOn: '2026-07-01', position: 0 }),
      weightReps(90, 9, { performedOn: '2026-08-20', position: 0 }),
    ];

    const suggestion = suggestNextSet('weight_reps', sets, '2026-08-10');
    expect(suggestion?.reason).toBe('previous-day');
    expect(suggestion?.measurements).toMatchObject({ weightG: 50_000, reps: 5 });
  });

  it('nie zależy od kolejności serii w wejściu', () => {
    const sets = [
      weightReps(60, 10, { id: 'a', performedOn: '2026-08-10', position: 0 }),
      weightReps(60, 8, { id: 'b', performedOn: '2026-08-10', position: 1 }),
    ];

    const wPrzod = suggestNextSet('weight_reps', sets, '2026-08-10');
    const wTyl = suggestNextSet('weight_reps', [...sets].reverse(), '2026-08-10');
    expect(wTyl?.source.id).toBe(wPrzod?.source.id);
  });

  it('podaje wyłącznie pola istotne dla typu logowania', () => {
    const sets = [makeSet({ performedOn: '2026-08-10', distanceM: 5000, durationS: 1500 })];
    const suggestion = suggestNextSet('distance_time', sets, '2026-08-10');

    expect(suggestion?.measurements).toEqual({
      weightG: null,
      reps: null,
      durationS: 1500,
      distanceM: 5000,
    });
  });

  it('przenosi masę ciała tylko dla typów, które jej używają', () => {
    const sets = [makeSet({ performedOn: '2026-08-10', reps: 12, bodyweightG: 82_000 })];

    expect(suggestNextSet('bodyweight_reps', sets, '2026-08-10')?.bodyweightG).toBe(82_000);
    expect(suggestNextSet('weight_reps', sets, '2026-08-10')?.bodyweightG).toBeNull();
  });
});

describe('nextPosition', () => {
  it('nowa seria ląduje na końcu listy danego dnia', () => {
    const sets = [
      makeSet({ performedOn: '2026-08-10', position: 0 }),
      makeSet({ performedOn: '2026-08-10', position: 3 }),
      makeSet({ performedOn: '2026-08-11', position: 9 }),
    ];
    expect(nextPosition(sets, '2026-08-10')).toBe(4);
  });

  it('pierwsza seria dnia dostaje pozycję zero', () => {
    expect(nextPosition([], '2026-08-10')).toBe(0);
    expect(nextPosition([makeSet({ performedOn: '2026-08-09', position: 7 })], '2026-08-10')).toBe(
      0,
    );
  });
});
