/**
 * Kolejność i widoczność tagów w rzędzie chipsów.
 *
 * Rząd tagów rósł razem ze słownikiem i pokazywał wszystko bez względu na to,
 * czy użytkownik kiedykolwiek z danego obszaru coś zapisał — a to on, a nie
 * alfabet, mówi, czego szuka. Dlatego na wierzchu stoją tagi z **jego**
 * seriami, od tych, w których ma ich najwięcej, a tagi bez ani jednej serii
 * schodzą pod jedno naciśnięcie: trzeba je móc znaleźć, kiedy obszar jest nowy,
 * ale nie trzeba ich mieć przed oczami przy każdym zapisie serii.
 *
 * Kolejność remisów zostawiamy taką, w jakiej tagi przyszły z zapytania, czyli
 * alfabetyczną (patrz `tagLibrary`) — `Array.prototype.sort` jest stabilny,
 * więc sortowanie po liczbie serii jej nie rusza.
 *
 * Moduł jest czysty i nie dotyka bazy: to ten sam podział dla każdego ekranu
 * z rzędem tagów, a licznik przychodzi gotowy z `tagSetCounts`.
 */

import type { TagSetCountRow } from './db/queries';

/** Liczba serii na tag, z wierszy `tagSetCounts`; brak wiersza znaczy zero. */
export function tagSetCountMap(rows: readonly TagSetCountRow[]): ReadonlyMap<string, number> {
  return new Map(rows.map((row) => [row.tagId, row.setCount]));
}

export interface TagSplit<Tag> {
  /** Tagi widoczne od razu — używane przez użytkownika, najczęstsze pierwsze. */
  shown: Tag[];
  /** Tagi do pokazania na życzenie — takie, z których nie ma ani jednej serii. */
  hidden: Tag[];
}

/**
 * Dzieli tagi na widoczne od razu i te spod „pokaż więcej".
 *
 * `pinned` zostaje na wierzchu nawet bez ani jednej serii: tak trzyma się tam
 * tag objęty celem aktywnego cyklu, bo rząd chipsów jest **jednocześnie**
 * podpowiedzią, gdzie ta robota czeka (patrz `pick-exercise.tsx`), a schowanie
 * go odebrałoby jej jedyne miejsce na ekranie.
 */
export function splitTagsByUsage<Tag extends { id: string }>(
  tags: readonly Tag[],
  counts: ReadonlyMap<string, number>,
  pinned: ReadonlySet<string> = new Set<string>(),
): TagSplit<Tag> {
  const used = (tag: Tag) => (counts.get(tag.id) ?? 0) > 0 || pinned.has(tag.id);

  const shown = tags
    .filter(used)
    .sort((left, right) => (counts.get(right.id) ?? 0) - (counts.get(left.id) ?? 0));

  return { shown, hidden: tags.filter((tag) => !used(tag)) };
}
