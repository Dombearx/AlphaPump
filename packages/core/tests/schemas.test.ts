import { describe, expect, it } from 'vitest';
import {
  createCycleInputSchema,
  createExerciseInputSchema,
  createSetInputSchema,
  cycleGoalSchema,
  cycleSchema,
  displayNameSchema,
  exerciseSchema,
  isoDateSchema,
  setInputSchemaFor,
  slugSchema,
  updateExerciseInputSchema,
  userSchema,
  workoutSetSchema,
} from '../src/schemas.js';

const NOW = '2026-08-10T18:30:00Z';
const ID_A = '0193f0a0-1c2d-7e3f-8a9b-0c1d2e3f4a5b';
const ID_B = '0193f0a0-1c2d-7e3f-8a9b-0c1d2e3f4a5c';
const ID_C = '0193f0a0-1c2d-7e3f-8a9b-0c1d2e3f4a5d';

const sync = { createdAt: NOW, updatedAt: NOW, deletedAt: null };

describe('pola wspólne', () => {
  it('slug musi być już znormalizowany', () => {
    expect(slugSchema.safeParse('martwy-ciag').success).toBe(true);
    expect(slugSchema.safeParse('Martwy ciąg').success).toBe(false);
  });

  it('dzień musi istnieć w kalendarzu', () => {
    expect(isoDateSchema.safeParse('2026-08-10').success).toBe(true);
    expect(isoDateSchema.safeParse('2026-02-30').success).toBe(false);
  });

  it('nazwa musi dawać niepusty slug', () => {
    expect(displayNameSchema.safeParse('Martwy ciąg').success).toBe(true);
    expect(displayNameSchema.safeParse('   ').success).toBe(false);
    expect(displayNameSchema.safeParse('!!!').success).toBe(false);
  });
});

describe('użytkownik', () => {
  it('przyjmuje poprawny profil', () => {
    const result = userSchema.safeParse({
      id: ID_A,
      email: 'kuba@example.com',
      nickname: 'kuba',
      role: 'user',
      ...sync,
    });
    expect(result.success).toBe(true);
  });

  it('odrzuca nieznaną rolę', () => {
    const result = userSchema.safeParse({
      id: ID_A,
      email: 'kuba@example.com',
      nickname: 'kuba',
      role: 'moderator',
      ...sync,
    });
    expect(result.success).toBe(false);
  });
});

describe('ćwiczenie', () => {
  const exercise = {
    id: ID_A,
    name: 'Martwy ciąg',
    slug: 'martwy-ciag',
    authorId: ID_B,
    loggingType: 'weight_reps',
    primaryTagId: ID_C,
    additionalTagIds: [],
    note: null,
    ...sync,
  };

  it('przyjmuje ćwiczenie z jednym tagiem głównym', () => {
    expect(exerciseSchema.safeParse(exercise).success).toBe(true);
  });

  it('nie pozwala powtórzyć tagu głównego wśród dodatkowych', () => {
    const result = exerciseSchema.safeParse({ ...exercise, additionalTagIds: [ID_C] });
    expect(result.success).toBe(false);
  });

  it('nie pozwala zdublować tagu dodatkowego', () => {
    const result = exerciseSchema.safeParse({ ...exercise, additionalTagIds: [ID_A, ID_A] });
    expect(result.success).toBe(false);
  });

  it('formularz tworzenia uzupełnia wartości domyślne', () => {
    const result = createExerciseInputSchema.parse({
      name: 'Bieg',
      loggingType: 'distance_time',
      primaryTagId: ID_C,
    });
    expect(result).toMatchObject({ additionalTagIds: [], note: null });
  });

  it('edycja nie pozwala zmienić typu logowania', () => {
    expect('loggingType' in updateExerciseInputSchema.shape).toBe(false);
  });
});

describe('seria', () => {
  const set = {
    id: ID_A,
    userId: ID_B,
    exerciseId: ID_C,
    performedOn: '2026-08-10',
    position: 0,
    weightG: 80_000,
    reps: 5,
    durationS: null,
    distanceM: null,
    bodyweightG: null,
    note: null,
    ...sync,
  };

  it('przyjmuje poprawną serię', () => {
    expect(workoutSetSchema.safeParse(set).success).toBe(true);
  });

  it('odrzuca wartości niecałkowite i ujemne', () => {
    expect(workoutSetSchema.safeParse({ ...set, weightG: 80_000.5 }).success).toBe(false);
    expect(workoutSetSchema.safeParse({ ...set, weightG: -1 }).success).toBe(false);
    expect(workoutSetSchema.safeParse({ ...set, reps: 0 }).success).toBe(false);
  });

  it('formularz tworzenia nie wymaga pól pomiarowych spoza typu', () => {
    const result = createSetInputSchema.parse({
      exerciseId: ID_C,
      performedOn: '2026-08-10',
      weightG: 80_000,
      reps: 5,
      durationS: null,
      distanceM: null,
    });
    expect(result).toMatchObject({ bodyweightG: null, note: null });
  });
});

describe('setInputSchemaFor', () => {
  const base = { exerciseId: ID_C, performedOn: '2026-08-10' };
  const puste = { weightG: null, reps: null, durationS: null, distanceM: null };

  it('wymaga pól właściwych dla typu logowania', () => {
    const schema = setInputSchemaFor('weight_reps');
    expect(schema.safeParse({ ...base, ...puste, weightG: 80_000, reps: 5 }).success).toBe(true);
    expect(schema.safeParse({ ...base, ...puste, weightG: 80_000 }).success).toBe(false);
  });

  it('odrzuca pola spoza typu logowania', () => {
    const schema = setInputSchemaFor('weight_reps');
    const result = schema.safeParse({
      ...base,
      ...puste,
      weightG: 80_000,
      reps: 5,
      distanceM: 100,
    });
    expect(result.success).toBe(false);
  });

  it('dopuszcza masę ciała tylko przy typach, które jej używają', () => {
    const bodyweight = setInputSchemaFor('bodyweight_reps');
    expect(bodyweight.safeParse({ ...base, ...puste, reps: 12, bodyweightG: 82_000 }).success).toBe(
      true,
    );

    const weight = setInputSchemaFor('weight_reps');
    const result = weight.safeParse({
      ...base,
      ...puste,
      weightG: 80_000,
      reps: 5,
      bodyweightG: 82_000,
    });
    expect(result.success).toBe(false);
  });

  it('przyjmuje serię biegową dla dystansu i czasu', () => {
    const schema = setInputSchemaFor('distance_time');
    const result = schema.safeParse({ ...base, ...puste, distanceM: 10_000, durationS: 3000 });
    expect(result.success).toBe(true);
  });
});

describe('cykl', () => {
  const goal = { id: ID_A, metric: 'sets', target: 12, exerciseId: null, tagId: ID_C };
  const cycle = {
    id: ID_A,
    userId: ID_B,
    name: 'Sierpień na biceps',
    startsOn: '2026-08-01',
    endsOn: '2026-08-31',
    archivedAt: null,
    goals: [goal],
    ...sync,
  };

  it('przyjmuje cykl z pozycją celu', () => {
    expect(cycleSchema.safeParse(cycle).success).toBe(true);
  });

  it('pozycja celu musi wskazywać dokładnie jedno: ćwiczenie albo tag', () => {
    expect(cycleGoalSchema.safeParse({ ...goal, exerciseId: ID_B }).success).toBe(false);
    expect(cycleGoalSchema.safeParse({ ...goal, tagId: null }).success).toBe(false);
    expect(cycleGoalSchema.safeParse({ ...goal, tagId: null, exerciseId: ID_B }).success).toBe(
      true,
    );
  });

  it('wymaga przynajmniej jednej pozycji celu', () => {
    expect(cycleSchema.safeParse({ ...cycle, goals: [] }).success).toBe(false);
  });

  it('koniec nie może wyprzedzać początku', () => {
    expect(cycleSchema.safeParse({ ...cycle, endsOn: '2026-07-01' }).success).toBe(false);
  });

  it('cykl bez daty końca jest poprawny', () => {
    expect(cycleSchema.safeParse({ ...cycle, endsOn: null }).success).toBe(true);
  });

  it('formularz tworzenia nie wymaga identyfikatorów pozycji', () => {
    const result = createCycleInputSchema.safeParse({
      name: 'Sierpień na biceps',
      startsOn: '2026-08-01',
      goals: [{ metric: 'sets', target: 12, exerciseId: null, tagId: ID_C }],
    });
    expect(result.success).toBe(true);
    expect(result.success && result.data.endsOn).toBeNull();
  });
});
