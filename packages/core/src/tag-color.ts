/**
 * Kolor tagu.
 *
 * Kolor jest wybierany z **dwudziestoelementowej palety** wyraźnie różnych
 * barw, a nie liczony jako dowolny punkt koła barw. Powód jest taki, jaki
 * zgłosili użytkownicy: przy odcieniu z hasha (`hash % 360`) dwa niepowiązane
 * tagi potrafiły trafić o kilka stopni od siebie i na kropce wielkości ziarnka
 * grochu wyglądały identycznie. Duża przestrzeń kolorów nie pomaga, jeśli oko
 * i tak nie odróżnia sąsiadów — pomaga paleta, w której **każda** para jest
 * daleko od siebie.
 *
 * ## Skąd wzięło się tych dwadzieścia kolorów
 *
 * Z wyszukiwania zachłannego po kole barw, maksymalizującego najmniejszą
 * odległość CIEDE2000 między dowolną parą, przy jasności trzymanej w paśmie
 * czytelnym na ciemnym tle (L* 58–84). Najbliższa para w tej palecie ma ΔE2000
 * ≈ 16, czyli grubo powyżej progu „to inny kolor" (~10) — pilnuje tego test.
 *
 * Kolejność w tablicy nie jest kolejnością barw: sąsiednie sloty dzieli około
 * 126° odcienia. Przy kolizji szukamy pierwszego wolnego slotu **w przód**, więc
 * dwa tagi, które trafiły w to samo miejsce, rozjeżdżają się na przeciwne strony
 * koła zamiast wylądować w dwóch odcieniach tej samej zieleni.
 *
 * ## Unikalność wymaga znajomości zbioru
 *
 * Kolor nie jest już czystą funkcją sluga i nie może nią być: „żaden kolor nie
 * powtarza się między tagami" to własność **zbioru**, a nie pojedynczej nazwy.
 * Dlatego funkcje tutaj przyjmują kolory już zajęte, a wołający je podaje —
 * serwer z bazy, telefon ze swojej bazy lokalnej. Slug wyznacza tylko punkt
 * startowy szukania, więc przy pustym zbiorze kolor dalej wynika z samej nazwy.
 *
 * Powyżej dwudziestu tagów kolory zaczynają się powtarzać i tak ma być — paleta
 * z dwustoma barwami byłaby paletą, w której połowa par jest nieodróżnialna,
 * czyli dokładnie tym, od czego uciekamy.
 *
 * ## Kolor nie jest kontraktem danych
 *
 * Kontraktem są slug i identyfikator — ich zmiana przepisuje wiersze
 * i osierocone serie. Kolor jest wartością przydzieloną: zapisuje się
 * w `tags.color`, zmiana nazwy go nie rusza (inaczej poprawienie literówki
 * mogłoby wepchnąć tag na kolor sąsiada), a serwer normalizuje go przy starcie,
 * gdy wiersze pamiętają jeszcze starą formułę.
 */

import { slug } from './slug.js';

export type TagColor = `#${string}`;

/**
 * Paleta. Dwadzieścia kolorów, każdy z każdym wyraźnie różny — patrz nagłówek
 * pliku. Kolejność jest częścią zachowania: to po niej idzie szukanie wolnego
 * slotu, więc przestawienie tej tablicy przestawia kolory nowym tagom.
 */
export const TAG_PALETTE: readonly TagColor[] = [
  '#eb621e',
  '#31eda8',
  '#b769f2',
  '#ee9a3a',
  '#2db49d',
  '#f4a1f7',
  '#e4cf95',
  '#31e7ed',
  '#ef4da9',
  '#b4992d',
  '#2d9db4',
  '#f698ab',
  '#d1d813',
  '#8eccf5',
  '#f0565b',
  '#6fec27',
  '#3a8eee',
  '#f1bda7',
  '#2db44c',
  '#a5a5e9',
];

/**
 * FNV-1a, 32 bity. Wybrany, bo jest krótki, deterministyczny i nie zależy od
 * niczego z platformy — ta sama implementacja liczy tak samo w Node,
 * w Hermesie i w przeglądarce.
 */
export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Pierwszy wolny slot licząc od miejsca wskazanego przez slug. Dopisuje wynik
 * do zbioru zajętych, bo każdy wołający tej funkcji przydziela kolory po kolei.
 *
 * Gdy zajęte jest wszystko — czyli tagów jest ponad dwadzieścia — wraca kolor
 * spod hasha. Powtórzenie jest wtedy nieuniknione, a wybór spod hasha ma tę
 * zaletę, że nie zależy od kolejności przydzielania.
 */
function takeColor(tagSlug: string, taken: Set<string>): TagColor {
  const start = hashString(tagSlug) % TAG_PALETTE.length;

  for (let step = 0; step < TAG_PALETTE.length; step += 1) {
    const color = TAG_PALETTE[(start + step) % TAG_PALETTE.length]!;
    if (!taken.has(color)) {
      taken.add(color);
      return color;
    }
  }

  return TAG_PALETTE[start]!;
}

/**
 * Kolor dla jednego tagu, omijający kolory już zajęte przez pozostałe tagi.
 * Bez drugiego argumentu wynika z samego sluga — tyle wie telefon, który tworzy
 * pierwszy tag na czystej bazie.
 */
export function tagColorForSlug(tagSlug: string, taken: Iterable<string> = []): TagColor {
  return takeColor(tagSlug, new Set(taken));
}

/** Kolor tagu wyliczony z jego nazwy — „biceps", „Biceps" i „BICEPS" dają ten sam. */
export function tagColor(name: string, taken: Iterable<string> = []): TagColor {
  return tagColorForSlug(slug(name), taken);
}

export interface TagColorInput {
  slug: string;
  /** Kolor już zapisany w bazie, jeśli jest — zostaje, o ile jest z palety i wolny. */
  color?: string | null;
}

/**
 * Kolory dla całego zbioru tagów, w podanej kolejności.
 *
 * Przydział jest **zachowawczy**: tag, który ma już kolor z palety i nikt go
 * przed nim nie zajął, zatrzymuje swój. Przekolorowane zostają tylko tagi
 * z kolorem spoza palety (czyli sprzed tej zmiany) i te, które dublują kolor
 * wcześniejszego tagu. Dzięki temu funkcja jest idempotentna i nie tasuje
 * kolorów całej biblioteki za każdym razem, gdy przybędzie jeden tag.
 */
export function assignTagColors(tagsInOrder: readonly TagColorInput[]): TagColor[] {
  const palette = new Set<string>(TAG_PALETTE);
  const taken = new Set<string>();

  const kept = tagsInOrder.map((tag) => {
    const current = tag.color ?? null;
    if (current === null || !palette.has(current) || taken.has(current)) return null;
    taken.add(current);
    return current as TagColor;
  });

  return kept.map((color, index) => color ?? takeColor(tagsInOrder[index]!.slug, taken));
}
