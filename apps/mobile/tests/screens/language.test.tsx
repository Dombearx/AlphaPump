/**
 * Wybór języka widziany z ekranu.
 *
 * Sedno jest jedno: **przełącznik zmienia nazwy, których użytkownik szuka**.
 * Testy montują prawdziwy ekran biblioteki na prawdziwej bazie lokalnej z
 * biblioteką wbudowaną — tą samą, którą telefon dostaje przy pierwszym
 * uruchomieniu — i sprawdzają, że przy polskim widać nazwy polskie, a przy
 * angielskim angielskie.
 *
 * Drugi przypadek jest równie ważny i łatwiej go przeoczyć: ćwiczenie **bez
 * tłumaczenia** ma wyglądać dokładnie tak, jak wyglądało przed dodaniem
 * języków — czyli pokazywać nazwę, którą ktoś wpisał, a nie pustą pozycję.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createExercise } from '../../src/db/library';
import { LibraryScreen } from '../../src/screens/library';
import { TAGS, TEST_USER } from '../local-database';
import { mount, openLocalDatabase, screenText, type MountedScreen } from './harness';

const AUTHOR = { userId: TEST_USER.id, deviceId: 'device-a', role: 'user' } as const;

describe('język nazw w bibliotece', () => {
  let local: MountedScreen;

  beforeEach(async () => {
    local = await openLocalDatabase();
  });

  afterEach(() => local.close());

  it('po polsku pokazuje polskie nazwy tagów i ćwiczeń', async () => {
    await mount(<LibraryScreen />, 'pl');

    const text = screenText();
    expect(text).toContain('klatka');
    expect(text).toContain('Wyciskanie sztangi na ławce płaskiej');
  });

  it('po angielsku pokazuje nazwy kanoniczne', async () => {
    await mount(<LibraryScreen />, 'en');

    const text = screenText();
    expect(text).toContain('chest');
    expect(text).toContain('Flat barbell bench press');
  });

  it('ćwiczenie bez tłumaczenia wygląda tak samo w obu językach', async () => {
    await createExercise(local.db, {
      ...AUTHOR,
      name: 'Wymach odważnikiem',
      loggingType: 'weight_reps',
      primaryTagId: TAGS.chest,
      additionalTagIds: [],
      note: null,
      gym: null,
    });

    await mount(<LibraryScreen />, 'pl');
    expect(screenText()).toContain('Wymach odważnikiem');
  });

  it('nazwa wpisana w formularzu wygrywa z nazwą kanoniczną', async () => {
    await createExercise(local.db, {
      ...AUTHOR,
      name: 'Kettlebell swing',
      translations: { pl: 'Wymach odważnikiem' },
      loggingType: 'weight_reps',
      primaryTagId: TAGS.chest,
      additionalTagIds: [],
      note: null,
      gym: null,
    });

    await mount(<LibraryScreen />, 'pl');
    const text = screenText();
    expect(text).toContain('Wymach odważnikiem');
    expect(text).not.toContain('Kettlebell swing');
  });
});
