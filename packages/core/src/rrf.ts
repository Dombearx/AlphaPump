/**
 * Reciprocal Rank Fusion — scalanie kilku list wyników w jedną.
 *
 * Wyszukiwanie hybrydowe (etap 12) pyta bazę dwa razy: raz leksykalnie
 * (`pg_trgm` i `tsvector`), raz semantycznie (odległość kosinusowa embeddingów).
 * Obie listy są uporządkowane, ale ich **wyniki liczbowe nie są porównywalne** —
 * `similarity()` z trigramów i `1 - (a <=> b)` z pgvectora mieszkają w innych
 * skalach i inaczej się rozkładają. Normalizowanie ich do wspólnej skali wymaga
 * znajomości rozkładu, którego nie mamy przy kilkuset wierszach biblioteki.
 *
 * RRF omija problem, bo **nie patrzy na wyniki, tylko na miejsca**. Pozycja
 * `rank` (licząc od 1) wnosi `waga / (k + rank)`, a wkłady się sumują. Wpis
 * znaleziony przez obie warstwy wychodzi wyżej niż wpis znaleziony tylko przez
 * jedną — czyli dokładnie to, po co warstwy są dwie.
 *
 * Stała `k` tłumi ogon listy: przy `k = 60` różnica między miejscem 1 i 2 jest
 * wyraźna, a między 40 i 41 — praktycznie żadna. Wartość jest tą z oryginalnej
 * pracy (Cormack, Clarke, Büttcher 2009) i nie ma powodu jej ruszać: wynik jest
 * na nią mało czuły, a każda inna wymagałaby uzasadnienia pomiarem, którego
 * przy tej skali danych nie da się sensownie zrobić.
 *
 * Funkcja jest tutaj, a nie w API, bo jest czystą regułą porządkowania —
 * bez I/O, w całości testowalna i bez pojęcia o tym, skąd wzięły się listy.
 */

/** Stała tłumiąca; patrz komentarz modułu. */
export const RRF_K = 60;

/** Jedna lista wejściowa: nazwa warstwy i identyfikatory w kolejności trafień. */
export interface RankedList {
  /** Skąd lista pochodzi — trafia do wyniku, żeby dało się pokazać „i tak, i tak". */
  source: string;
  /** Identyfikatory od najlepszego. Powtórzenia liczą się raz, po pierwszym trafieniu. */
  ids: readonly string[];
  /**
   * Waga listy. Domyślnie 1 — obie warstwy są równoprawne, bo żadna nie jest
   * systematycznie lepsza: leksykalna łapie literówki, semantyczna synonimy.
   */
  weight?: number;
}

export interface FusedResult {
  id: string;
  /** Suma wkładów `waga / (k + rank)`. Sensowna tylko do porównań między wynikami. */
  score: number;
  /** Warstwy, które ten wpis znalazły — w kolejności podanych list. */
  sources: string[];
}

export interface FuseOptions {
  k?: number;
  /** Ile pozycji zostawić. Bez limitu wracają wszystkie. */
  limit?: number;
}

/**
 * Scala listy w jedną, od najlepszego wpisu.
 *
 * Remis rozstrzyga liczba warstw, które wpis znalazły, a potem identyfikator —
 * porządek musi być **deterministyczny**, bo ta lista jedzie potem do
 * re-rankera i do cache'u kluczowanego jej zawartością.
 */
export function fuseRankings(
  lists: readonly RankedList[],
  options: FuseOptions = {},
): FusedResult[] {
  const { k = RRF_K, limit } = options;

  const byId = new Map<string, FusedResult>();

  for (const list of lists) {
    const weight = list.weight ?? 1;
    const seen = new Set<string>();
    let rank = 0;

    for (const id of list.ids) {
      // Powtórzenie w obrębie jednej listy nie może dopłacać wpisowi drugi raz
      // ani przesuwać miejsc pozostałym.
      if (seen.has(id)) continue;
      seen.add(id);
      rank += 1;

      const existing = byId.get(id);
      const contribution = weight / (k + rank);

      if (existing) {
        existing.score += contribution;
        if (!existing.sources.includes(list.source)) existing.sources.push(list.source);
      } else {
        byId.set(id, { id, score: contribution, sources: [list.source] });
      }
    }
  }

  const fused = [...byId.values()].sort(
    (a, b) => b.score - a.score || b.sources.length - a.sources.length || a.id.localeCompare(b.id),
  );

  return limit === undefined ? fused : fused.slice(0, limit);
}
