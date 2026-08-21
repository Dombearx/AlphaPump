/**
 * Reguły tapety: co wolno wgrać, jak nazywa się kopia zdjęcia i co znaczy
 * uszkodzony rejestr.
 *
 * To jest jedyne miejsce w tej funkcji, w którym w ogóle zapadają decyzje —
 * warstwa Expo tylko je wykonuje.
 */

import { describe, expect, it } from 'vitest';
import {
  EMPTY_BACKGROUND_STATE,
  MAX_BACKGROUND_BYTES,
  backgroundProblem,
  parseBackgroundState,
  serializeBackgroundState,
  withDefaultBackground,
  withPickedBackground,
} from '../src/background/state';

const photo = { name: 'IMG_2031.JPG', mimeType: 'image/jpeg', size: 2_400_000 };

describe('wybór zdjęcia na tapetę', () => {
  it('przepuszcza JPG i PNG', () => {
    expect(backgroundProblem(photo)).toBeNull();
    expect(
      backgroundProblem({ name: 'zrzut.png', mimeType: 'image/png', size: 900_000 }),
    ).toBeNull();
  });

  it('odmawia plikom, które nie są obrazem', () => {
    const problem = backgroundProblem({
      name: 'trening.pdf',
      mimeType: 'application/pdf',
      size: 10,
    });
    expect(problem).toContain('JPG or PNG');
  });

  it('rozpoznaje format po nazwie, gdy system nie podaje typu', () => {
    // Dostawcy treści na Androidzie potrafią oddać `application/octet-stream`
    // albo nic — odmowa w tym miejscu ukryłaby przed użytkownikiem zdjęcie,
    // po które przyszedł.
    expect(backgroundProblem({ name: 'tapeta.png', mimeType: null, size: 100 })).toBeNull();
    expect(
      backgroundProblem({ name: 'tapeta.jpeg', mimeType: 'application/octet-stream', size: 100 }),
    ).toBeNull();
  });

  it('odmawia zdjęciu ponad limit i mówi, o ile', () => {
    const problem = backgroundProblem({ ...photo, size: MAX_BACKGROUND_BYTES + 1 });
    expect(problem).toContain('8.0 MB');
  });

  it('nie odmawia, gdy system nie zna rozmiaru', () => {
    // Brak rozmiaru to nie jest „plik ogromny": odmowa zablokowałaby wybór
    // zdjęcia, o którym po prostu nic nie wiadomo.
    expect(
      backgroundProblem({ name: 'tapeta.jpg', mimeType: 'image/jpeg', size: null }),
    ).toBeNull();
  });
});

describe('rejestr tapety', () => {
  it('nadaje kolejnym tapetom różne nazwy', () => {
    // Ta sama nazwa znaczyłaby ten sam adres, a więc zdjęcie z pamięci
    // podręcznej obrazów zamiast nowo wybranego.
    const first = withPickedBackground(EMPTY_BACKGROUND_STATE, photo);
    const second = withPickedBackground(first, {
      name: 'inne.png',
      mimeType: 'image/png',
      size: 10,
    });

    expect(first.file).toBe('background-1.jpg');
    expect(second.file).toBe('background-2.png');
  });

  it('nie zapisuje pliku, którego reguły nie przepuściły', () => {
    expect(() => withPickedBackground(EMPTY_BACKGROUND_STATE, { name: 'x.gif', size: 10 })).toThrow(
      /JPG or PNG/,
    );
  });

  it('powrót do tła domyślnego zostawia licznik nazw', () => {
    const set = withPickedBackground(EMPTY_BACKGROUND_STATE, photo);
    const cleared = withDefaultBackground(set);

    expect(cleared.file).toBeNull();
    expect(withPickedBackground(cleared, photo).file).toBe('background-2.jpg');
  });

  it('czyta z powrotem to, co zapisał', () => {
    const state = withPickedBackground(EMPTY_BACKGROUND_STATE, photo);
    expect(parseBackgroundState(serializeBackgroundState(state))).toEqual(state);
  });

  it('traktuje uszkodzony rejestr jak tło domyślne', () => {
    // Inaczej niż rejestr eksportu do FitNotesa: tam zgadywanie kosztuje
    // duplikat całej historii, tu — jedno kliknięcie użytkownika.
    expect(parseBackgroundState('{')).toEqual(EMPTY_BACKGROUND_STATE);
    expect(parseBackgroundState('{"file":7}')).toEqual(EMPTY_BACKGROUND_STATE);
  });
});
