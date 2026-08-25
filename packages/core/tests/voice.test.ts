/**
 * Nakładanie werdyktu modelu na listę ćwiczeń przy dyktowaniu serii.
 *
 * Testy pilnują tego, czego model nie ma prawa zepsuć: indeks spoza listy nie
 * może wybrać cudzego ćwiczenia, liczba spoza osi typu logowania nie może
 * wjechać do serii, a seria niepełna musi wrócić jako niepełna — a nie zniknąć.
 */

import { describe, expect, it } from 'vitest';
import {
  applyVoiceVerdict,
  voiceSetResponseSchema,
  voiceSetVerdictSchema,
  type VoiceExercise,
  type VoiceSetVerdict,
} from '../src/voice.js';

const BENCH: VoiceExercise = {
  exerciseId: '00000000-0000-4000-8000-000000000001',
  name: 'Wyciskanie sztangi leżąc',
  loggingType: 'weight_reps',
  aliases: ['Bench press'],
};

const PLANK: VoiceExercise = {
  exerciseId: '00000000-0000-4000-8000-000000000002',
  name: 'Deska',
  loggingType: 'bodyweight_time',
  aliases: ['Plank'],
};

const RUN: VoiceExercise = {
  exerciseId: '00000000-0000-4000-8000-000000000003',
  name: 'Bieg',
  loggingType: 'distance_time',
  aliases: [],
};

const verdict = (overrides: Partial<VoiceSetVerdict> = {}): VoiceSetVerdict => ({
  exerciseIndex: 0,
  weightKg: null,
  reps: null,
  durationS: null,
  distanceM: null,
  bodyweightKg: null,
  note: null,
  reason: 'Zrozumiałem serię',
  ...overrides,
});

describe('applyVoiceVerdict', () => {
  it('zamienia kilogramy na gramy i domyka kompletną serię', () => {
    const match = applyVoiceVerdict(
      [BENCH, PLANK],
      verdict({ exerciseIndex: 0, weightKg: 82.5, reps: 8 }),
    );

    expect(match).toMatchObject({
      exerciseId: BENCH.exerciseId,
      name: 'Wyciskanie sztangi leżąc',
      loggingType: 'weight_reps',
      weightG: 82_500,
      reps: 8,
      complete: true,
    });
  });

  it('brak dopasowania zwraca null, a nie pierwsze z brzegu', () => {
    expect(applyVoiceVerdict([BENCH], verdict({ exerciseIndex: null, reps: 8 }))).toBeNull();
  });

  it('indeks spoza listy nie wybiera cudzego ćwiczenia', () => {
    expect(applyVoiceVerdict([BENCH, PLANK], verdict({ exerciseIndex: 7 }))).toBeNull();
    expect(applyVoiceVerdict([], verdict({ exerciseIndex: 0 }))).toBeNull();
  });

  it('wycina pomiary spoza osi typu logowania', () => {
    // „Dwadzieścia powtórzeń deski" — powtórzeń to ćwiczenie nie ma gdzie zapisać.
    const match = applyVoiceVerdict(
      [PLANK],
      verdict({ exerciseIndex: 0, reps: 20, durationS: 60, weightKg: 40 }),
    );

    expect(match).toMatchObject({ reps: null, weightG: null, durationS: 60, complete: true });
  });

  it('seria bez kompletu pól wraca jako niekompletna', () => {
    const match = applyVoiceVerdict([BENCH], verdict({ exerciseIndex: 0, weightKg: 80 }));

    expect(match).toMatchObject({ weightG: 80_000, reps: null, complete: false });
  });

  it('zerowy ciężar jest kompletną serią, zerowy dystans już nie', () => {
    expect(applyVoiceVerdict([BENCH], verdict({ weightKg: 0, reps: 12 }))).toMatchObject({
      weightG: 0,
      complete: true,
    });
    expect(applyVoiceVerdict([RUN], verdict({ durationS: 1500 }))).toMatchObject({
      distanceM: null,
      complete: false,
    });
  });

  it('masa ciała zapisuje się tylko tam, gdzie ma sens', () => {
    expect(applyVoiceVerdict([PLANK], verdict({ durationS: 60, bodyweightKg: 78 }))).toMatchObject({
      bodyweightG: 78_000,
    });
    expect(
      applyVoiceVerdict([BENCH], verdict({ weightKg: 80, reps: 5, bodyweightKg: 78 })),
    ).toMatchObject({ bodyweightG: null });
  });

  it('pusta notatka nie zostaje pustym napisem', () => {
    expect(
      applyVoiceVerdict([BENCH], verdict({ weightKg: 80, reps: 5, note: '   ' })),
    ).toMatchObject({ note: null });
    expect(
      applyVoiceVerdict([BENCH], verdict({ weightKg: 80, reps: 5, note: ' bolało kolano ' })),
    ).toMatchObject({ note: 'bolało kolano' });
  });
});

describe('schematy dyktowania', () => {
  it('odrzuca werdykt z ujemnym indeksem i z zerem powtórzeń', () => {
    expect(voiceSetVerdictSchema.safeParse(verdict({ exerciseIndex: -1 })).success).toBe(false);
    expect(voiceSetVerdictSchema.safeParse(verdict({ reps: 0 })).success).toBe(false);
  });

  it('przepuszcza odpowiedź bez dopasowania, ale z transkrypcją', () => {
    const parsed = voiceSetResponseSchema.safeParse({
      transcript: 'zrobiłem coś',
      match: null,
      reason: 'Nie wiem, o które ćwiczenie chodzi',
    });

    expect(parsed.success).toBe(true);
  });
});
