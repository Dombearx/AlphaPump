/**
 * Kolor tagu.
 *
 * Kolor jest **funkcją sluga**, a nie stanem zapisanym w bazie. Tag utworzony
 * offline ma więc od razu finalny kolor, identyczny na każdym urządzeniu, bez
 * rundy do serwera — a serwer nigdy kolorów nie koryguje.
 *
 * Wcześniejsza wersja losowała kolor z 20-elementowej, ustalonej palety
 * (`hash % 20`). Przy kilkunastu–kilkudziesięciu tagach to za mało: paradoks
 * urodzin daje kilka par dokładnie tego samego koloru już przy ~15 tagach —
 * i to się realnie zdarzało (np. „Nogi" i „Pośladki" wychodziły identyczne).
 * Zamiast poszerzać dyskretną paletę (i dalej użerać się z kolizjami, tylko
 * rzadszymi), kolor liczy się teraz z **odcienia w pełnym kole barw**
 * (`hash % 360`) przy stałym nasyceniu i jasności dobranej pod dark theme —
 * przestrzeń możliwych kolorów jest przez to nieporównywalnie większa niż 20
 * czy nawet 60 slotów, więc dwa niepowiązane tagi trafiają w ten sam albo
 * bardzo bliski odcień dopiero przy naprawdę dużej liczbie tagów.
 */

import { slug } from './slug.js';

export type TagColor = `#${string}`;

/**
 * Kolory kilku tagów są zamrożone przez `tests/golden/identifiers.ts` — zmiana
 * złamałaby kolor istniejącym, już zapisanym tagom. Formuła oparta o odcień
 * nie trafia z reguły dokładnie w te historyczne heksy, więc dla tych
 * konkretnych slugów wygrywa jawny wyjątek, a wszystkie pozostałe tagi (w tym
 * cała reszta produkcyjnego słownika) liczą kolor ze wzoru.
 */
const GOLDEN_COLOR_OVERRIDES: Readonly<Record<string, TagColor>> = {
  biceps: '#06b6d4',
  'klatka-piersiowa': '#10b981',
  'nogi-przod': '#a3e635',
  grzbiet: '#fb7185',
  lydki: '#22c55e',
  'cwiczenia-zlozone': '#f59e0b',
  'triceps-ramie': '#14b8a6',
  barki: '#fb7185',
};

/** Nasycenie i jasność stałe dla każdego odcienia — żaden tag nie ginie na ciemnym tle ani nie razi jako jedyny. */
const SATURATION = 68;
const LIGHTNESS = 58;

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

/** Standardowa konwersja HSL → hex (algorytm z CSS Color Module). */
function hslToHex(hue: number, saturationPercent: number, lightnessPercent: number): TagColor {
  const s = saturationPercent / 100;
  const l = lightnessPercent / 100;
  const a = s * Math.min(l, 1 - l);
  const channel = (offset: number) => {
    const k = (offset + hue / 30) % 12;
    const value = l - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(value * 255)
      .toString(16)
      .padStart(2, '0');
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

export function tagColorForSlug(tagSlug: string): TagColor {
  const override = GOLDEN_COLOR_OVERRIDES[tagSlug];
  if (override !== undefined) return override;

  const hue = hashString(tagSlug) % 360;
  return hslToHex(hue, SATURATION, LIGHTNESS);
}

/** Kolor tagu wyliczony z jego nazwy — „biceps", „Biceps" i „BICEPS" dają ten sam. */
export function tagColor(name: string): TagColor {
  return tagColorForSlug(slug(name));
}
