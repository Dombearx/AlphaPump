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
  carryOverLastSet,
  isExerciselessVerdict,
  matchSpokenExercise,
  voiceSetResponseSchema,
  voiceSetVerdictSchema,
  type VoiceExercise,
  type VoiceRecentSet,
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
  exerciseName: 'Wyciskanie sztangi leżąc',
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

describe('uzupełnianie zdania bez nazwy ćwiczenia', () => {
  const TODAY = '2026-08-31';

  const recentSet = (overrides: Partial<VoiceRecentSet> = {}): VoiceRecentSet => ({
    exerciseId: BENCH.exerciseId,
    exerciseName: BENCH.name,
    performedOn: TODAY,
    measurements: { weightG: 80_000, reps: 10, durationS: null, distanceM: null },
    ...overrides,
  });

  const nameless = (overrides: Partial<VoiceSetVerdict> = {}): VoiceSetVerdict =>
    verdict({ exerciseIndex: null, exerciseName: null, reps: 8, ...overrides });

  it('zdanie bez nazwy to werdykt bez ćwiczenia, ale z liczbami', () => {
    expect(isExerciselessVerdict(nameless())).toBe(true);
    // Ciężar podany w zdaniu niczego nie zmienia: nazwa dalej nie padła.
    expect(isExerciselessVerdict(nameless({ weightKg: 80 }))).toBe(true);
    // Nazwa padła, choć model nie wskazał pozycji — to jest przypadek dla
    // dopasowania po nazwie, a nie dla historii.
    expect(isExerciselessVerdict(verdict({ exerciseIndex: null, exerciseName: 'przysiat' }))).toBe(
      false,
    );
    // Model wskazał ćwiczenie sam — nie ma czego uzupełniać.
    expect(isExerciselessVerdict(verdict({ exerciseIndex: 0, reps: 8 }))).toBe(false);
    // Zdanie bez jednej liczby nie jest serią.
    expect(isExerciselessVerdict(nameless({ reps: null }))).toBe(false);
  });

  it('dopisuje ćwiczenie i ciężar z ostatniej serii tego treningu', () => {
    const carried = carryOverLastSet([PLANK, BENCH], [recentSet()], nameless(), TODAY);

    if (carried === null) throw new Error('spodziewano się uzupełnionego werdyktu');

    expect(carried).toMatchObject({ exerciseIndex: 1, weightKg: 80, reps: 8 });
    expect(applyVoiceVerdict([PLANK, BENCH], carried)).toMatchObject({
      exerciseId: BENCH.exerciseId,
      weightG: 80_000,
      reps: 8,
      complete: true,
    });
  });

  it('bierze serię ostatnią, a nie pierwszą lepszą z historii', () => {
    const carried = carryOverLastSet(
      [BENCH, PLANK],
      [
        recentSet({ measurements: { weightG: 85_000, reps: 6, durationS: null, distanceM: null } }),
        recentSet(),
      ],
      nameless(),
      TODAY,
    );

    expect(carried).toMatchObject({ weightKg: 85 });
  });

  it('nie nadpisuje ciężaru, który padł w zdaniu', () => {
    // „Jeszcze osiem na siedemdziesiąt" — ćwiczenie z historii, ciężar z ust.
    const carried = carryOverLastSet([BENCH], [recentSet()], nameless({ weightKg: 70 }), TODAY);

    expect(carried).toMatchObject({ exerciseIndex: 0, weightKg: 70, reps: 8 });
  });

  it('sięga po serię z poprzedniego treningu i podpisuje ją datą', () => {
    // Dzień nie jest warunkiem: kto nie powiedział, co robi, robi dalej to samo.
    // Warunkiem był i kosztował trening po północy oraz pierwszą serię dnia.
    const carried = carryOverLastSet(
      [BENCH],
      [recentSet({ performedOn: '2026-08-30' })],
      nameless(),
      TODAY,
    );

    expect(carried).toMatchObject({ exerciseIndex: 0, weightKg: 80 });
    expect(carried?.reason).toContain('2026-08-30');
  });

  it('bez dnia z urządzenia uzupełnia tak samo', () => {
    expect(carryOverLastSet([BENCH], [recentSet()], nameless())).toMatchObject({
      exerciseIndex: 0,
      reps: 8,
    });
  });

  it('bez żadnej wcześniejszej serii nie ma z czego uzupełnić', () => {
    expect(carryOverLastSet([BENCH], [], nameless(), TODAY)).toBeNull();
  });

  it('ćwiczenie spoza listy podanej modelowi nie ma jak zostać wskazane', () => {
    expect(carryOverLastSet([PLANK], [recentSet()], nameless(), TODAY)).toBeNull();
  });

  it('ćwiczenie bez ciężaru dopisuje się bez niego', () => {
    const carried = carryOverLastSet(
      [PLANK],
      [
        recentSet({
          exerciseId: PLANK.exerciseId,
          exerciseName: PLANK.name,
          measurements: { weightG: null, reps: null, durationS: 60, distanceM: null },
        }),
      ],
      nameless(),
      TODAY,
    );

    expect(carried).toMatchObject({ exerciseIndex: 0, weightKg: null });
  });
});

/**
 * Nazwa przekręcona przez rozpoznawanie mowy.
 *
 * To jest warstwa, która ratuje dyktowanie wtedy, gdy model powiedział „nie
 * wiem": deterministyczna, bez sieci i bez kosztu, a przy tym ostrożna —
 * wskazuje wyłącznie nazwę, która **w całości** znalazła się w tym, co
 * powiedziano.
 */
describe('matchSpokenExercise', () => {
  const library = [BENCH, PLANK, RUN];

  it('wybacza literówkę i odmianę', () => {
    expect(matchSpokenExercise(library, 'wyciskanei sztangi leżąc')).toBe(0);
    expect(matchSpokenExercise(library, 'wyciskanie sztangą leżac')).toBe(0);
    expect(matchSpokenExercise(library, 'deska')).toBe(1);
    expect(matchSpokenExercise(library, 'bieg')).toBe(2);
  });

  it('wybacza literówkę w słowie krótkim, gdzie same trigramy nie wystarczają', () => {
    expect(matchSpokenExercise(library, 'bensh press')).toBe(0);
    expect(matchSpokenExercise(library, 'plonk')).toBe(1);
  });

  it('szuka nazwy wewnątrz całego zdania, pomijając liczby', () => {
    expect(matchSpokenExercise(library, 'bench press 80 na 8')).toBe(0);
    expect(matchSpokenExercise(library, 'zrobiłem deskę 60 sekund')).toBe(1);
  });

  it('nie wskazuje niczego, gdy nazwa nie padła albo padła w kawałku', () => {
    expect(matchSpokenExercise(library, 'osiem powtórzeń')).toBeNull();
    // Sam człon „wyciskanie" to w bibliotece początek kilkunastu nazw —
    // i dlatego nazwa musi paść w całości, a nie w większości.
    expect(matchSpokenExercise(library, 'wyciskanie')).toBeNull();
    expect(matchSpokenExercise(library, 'wyciskanie leżąc')).toBeNull();
    expect(matchSpokenExercise(library, '')).toBeNull();
    expect(matchSpokenExercise([], 'deska')).toBeNull();
  });

  it('woli nazwę, która zgodziła się większą liczbą członów', () => {
    const SQUAT: VoiceExercise = {
      exerciseId: '00000000-0000-4000-8000-000000000004',
      name: 'Przysiad',
      loggingType: 'weight_reps',
      aliases: [],
    };
    const BULGARIAN: VoiceExercise = {
      exerciseId: '00000000-0000-4000-8000-000000000005',
      name: 'Przysiad bułgarski',
      loggingType: 'weight_reps',
      aliases: [],
    };

    expect(matchSpokenExercise([SQUAT, BULGARIAN], 'przysiad bułgarski 20 na 10')).toBe(1);
    // A samo „przysiad" zostaje przysiadem: nazwa dłuższa nie jest pokryta.
    expect(matchSpokenExercise([SQUAT, BULGARIAN], 'przysiad 100 na 5')).toBe(0);
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
