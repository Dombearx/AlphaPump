/**
 * Normalizacja nazw.
 *
 * > **KONTRAKT.** Wynik `slug()` wchodzi do klucza deterministycznych
 * > identyfikatorów ćwiczeń i tagów (patrz `ids.ts`). Zmiana normalizacji
 * > przelicza identyfikatory istniejących wierszy — a więc osierocą serie
 * > wskazujące na stare id. Ta funkcja **nie może się zmienić**; jej zachowanie
 * > pilnują testy golden (`tests/golden/identifiers.ts`), traktowane jak
 * > kontrakt, a nie jak zwykłe asercje.
 *
 * Zasady: małe litery, ogonki sprowadzone do ASCII, apostrofy usunięte, każda
 * inna sekwencja znaków spoza `[a-z0-9]` zamieniona na pojedynczy myślnik,
 * myślniki obcięte z brzegów.
 */

/**
 * Litery, których rozkład NFD nie sprowadza do ASCII, bo znak bazowy jest
 * przekreślony lub przecięty (`ł`), albo jest osobną literą (`ß`, `æ`).
 */
const NON_DECOMPOSABLE: Readonly<Record<string, string>> = {
  ł: 'l',
  đ: 'd',
  ð: 'd',
  ø: 'o',
  æ: 'ae',
  œ: 'oe',
  ß: 'ss',
  þ: 'th',
};

const APOSTROPHES = /['\u2018\u2019`\u00b4]/g;
const COMBINING_MARKS = /[\u0300-\u036f]/g;
const NON_SLUG_CHARACTERS = /[^a-z0-9]+/g;
const EDGE_HYPHENS = /^-+|-+$/g;

export function slug(input: string): string {
  const withoutDiacritics = input
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .toLowerCase()
    .replace(/[łđðøæœßþ]/g, (character) => NON_DECOMPOSABLE[character] ?? character);

  return withoutDiacritics
    .replace(APOSTROPHES, '')
    .replace(NON_SLUG_CHARACTERS, '-')
    .replace(EDGE_HYPHENS, '');
}

/** Czy napis jest już slugiem — to znaczy czy `slug(value) === value`. */
export function isSlug(value: string): boolean {
  return value.length > 0 && slug(value) === value;
}
