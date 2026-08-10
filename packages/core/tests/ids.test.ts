import { describe, expect, it } from 'vitest';
import { v5 as uuidv5 } from 'uuid';
import {
  builtInExerciseId,
  exerciseId,
  exerciseIdKey,
  isUuid,
  newCycleId,
  newSetId,
  NS_ALPHAPUMP,
  NS_EXERCISE,
  NS_TAG,
  SYSTEM_USER_ID,
  tagId,
} from '../src/ids.js';
import { slug } from '../src/slug.js';
import { tagColor } from '../src/tag-color.js';
import {
  GOLDEN_AUTHOR_ID,
  GOLDEN_EXERCISES,
  GOLDEN_NAMESPACES,
  GOLDEN_TAGS,
} from './golden/identifiers.js';

describe('kontrakt złotych wartości', () => {
  it('przestrzenie nazw i konto systemowe są niezmienione', () => {
    expect({ NS_ALPHAPUMP, NS_EXERCISE, NS_TAG, SYSTEM_USER_ID }).toEqual(GOLDEN_NAMESPACES);
  });

  it('przestrzenie nazw odpowiadają swojemu wyprowadzeniu', () => {
    expect(NS_ALPHAPUMP).toBe(uuidv5('alphapump.app', uuidv5.DNS));
    expect(NS_EXERCISE).toBe(uuidv5('exercise', NS_ALPHAPUMP));
    expect(NS_TAG).toBe(uuidv5('tag', NS_ALPHAPUMP));
    expect(SYSTEM_USER_ID).toBe(uuidv5('system-user', NS_ALPHAPUMP));
  });

  it.each(GOLDEN_TAGS)('tag $name zachowuje slug, id i kolor', (golden) => {
    expect(slug(golden.name)).toBe(golden.slug);
    expect(tagId(golden.name)).toBe(golden.id);
    expect(tagColor(golden.name)).toBe(golden.color);
  });

  it.each(GOLDEN_EXERCISES)('ćwiczenie $name zachowuje slug i id', (golden) => {
    expect(slug(golden.name)).toBe(golden.slug);
    expect(builtInExerciseId(golden.name)).toBe(golden.builtInId);
    expect(exerciseId(GOLDEN_AUTHOR_ID, golden.name)).toBe(golden.authoredId);
  });
});

describe('identyfikatory ćwiczeń', () => {
  it('są zbudowane z autora i sluga nazwy', () => {
    expect(exerciseIdKey(GOLDEN_AUTHOR_ID, 'Martwy ciąg')).toBe(`${GOLDEN_AUTHOR_ID}/martwy-ciag`);
  });

  it('to samo ćwiczenie utworzone offline na dwóch urządzeniach dostaje to samo id', () => {
    const naPierwszym = exerciseId(GOLDEN_AUTHOR_ID, 'Martwy ciąg');
    const naDrugim = exerciseId(GOLDEN_AUTHOR_ID, '  martwy   CIĄG  ');
    expect(naDrugim).toBe(naPierwszym);
  });

  it('ta sama nazwa u dwóch autorów daje różne id', () => {
    const autora = exerciseId(GOLDEN_AUTHOR_ID, 'Martwy ciąg');
    const systemowe = builtInExerciseId('Martwy ciąg');
    expect(autora).not.toBe(systemowe);
  });

  it('ćwiczenie wbudowane jest ćwiczeniem konta systemowego', () => {
    expect(builtInExerciseId('Bieg')).toBe(exerciseId(SYSTEM_USER_ID, 'Bieg'));
  });
});

describe('identyfikatory tagów', () => {
  it('deduplikują tagi różniące się tylko zapisem', () => {
    const id = tagId('biceps');
    expect(tagId('Biceps')).toBe(id);
    expect(tagId('BICEPS')).toBe(id);
    expect(tagId('  biceps  ')).toBe(id);
  });

  it('nie zależą od autora — tag jest bytem globalnym', () => {
    expect(tagId('Grzbiet')).not.toBe(tagId('Barki'));
  });
});

describe('identyfikatory nadawane na kliencie', () => {
  it('są poprawnymi UUID-ami w wersji 7', () => {
    const id = newSetId();
    expect(isUuid(id)).toBe(true);
    expect(id[14]).toBe('7');
  });

  it('są unikalne', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newSetId()));
    expect(ids.size).toBe(1000);
  });

  it('rosną w czasie, więc sortują się chronologicznie', async () => {
    const first = newCycleId();
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = newCycleId();
    expect(second > first).toBe(true);
  });
});

describe('isUuid', () => {
  it('odrzuca wartości, które nie są UUID-em', () => {
    expect(isUuid('martwy-ciag')).toBe(false);
    expect(isUuid('')).toBe(false);
    expect(isUuid(42)).toBe(false);
    expect(isUuid(null)).toBe(false);
  });
});
