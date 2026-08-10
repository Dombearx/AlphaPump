/**
 * Kolor tagu.
 *
 * Kolor jest **funkcją sluga**, a nie stanem zapisanym w bazie. Tag utworzony
 * offline ma więc od razu finalny kolor, identyczny na każdym urządzeniu, bez
 * rundy do serwera — a serwer nigdy kolorów nie koryguje.
 *
 * Przy kilkudziesięciu tagach kolizje się zdarzą i dwa tagi dostaną ten sam
 * kolor. Specyfikacja wymaga odróżnialności „w możliwie praktycznym stopniu",
 * więc to akceptowalna cena za stabilność i brak koordynacji.
 */

import { slug } from './slug.js';

/**
 * Paleta dobrana pod dark theme — nasycone barwy o zbliżonej jasności, żeby
 * żadna nie znikała na ciemnym tle ani nie raziła jako jedyna.
 */
export const TAG_COLORS = [
  '#ef4444',
  '#f97316',
  '#f59e0b',
  '#eab308',
  '#a3e635',
  '#4ade80',
  '#22c55e',
  '#10b981',
  '#14b8a6',
  '#06b6d4',
  '#0ea5e9',
  '#3b82f6',
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
  '#fb7185',
  '#94a3b8',
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

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

export function tagColorForSlug(tagSlug: string): TagColor {
  const index = hashString(tagSlug) % TAG_COLORS.length;
  // Indeks jest zawsze w zakresie palety, ale `noUncheckedIndexedAccess`
  // o tym nie wie — pierwszy kolor jest tu wyłącznie domknięciem typu.
  return TAG_COLORS[index] ?? TAG_COLORS[0];
}

/** Kolor tagu wyliczony z jego nazwy — „biceps", „Biceps" i „BICEPS" dają ten sam. */
export function tagColor(name: string): TagColor {
  return tagColorForSlug(slug(name));
}
