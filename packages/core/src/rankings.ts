/**
 * Rekordy globalne i rankingi — jedyny obszar produktu, który sięga po dane
 * innych osób.
 *
 * Obowiązuje tu jedna twarda granica prywatności: **serie są prywatne**. Na
 * zewnątrz wychodzą wyłącznie wartość, nick, data i notatka serii — nigdy
 * historia, nigdy identyfikator serii, nigdy nic, po czym dałoby się tę
 * historię odpytać. Kształt `globalRecordSchema` jest tej reguły zapisem: nie
 * ma w nim pola, którego by nie dopuszczała specyfikacja, więc żaden endpoint
 * nie odda przypadkiem więcej, niż wolno.
 *
 * Rekordy globalne liczy **ten sam** front Pareto, co rekordy indywidualne
 * (`records.ts`) — różnica jest wyłącznie w zbiorze wejściowym: serie wszystkich
 * użytkowników zamiast serii jednego. Drugiej implementacji tu nie ma i być nie
 * może, bo rozjazd między rekordem w aplikacji a rekordem w rankingu jest
 * niewidoczny w kodzie i natychmiast widoczny dla użytkownika.
 *
 * Rankingi są globalne i bez przedziału czasu — tak stanowi specyfikacja.
 */

import { z } from 'zod';
import { isoDateSchema, noteSchema, setMeasurementsSchema, uuidSchema } from './schemas.js';

/* ------------------------------------------------------------ rekord globalny */

/**
 * Rekord globalny ćwiczenia w postaci wystawianej na zewnątrz.
 *
 * Pomiary są tu tymi samymi polami, co w serii, bo to ta sama wartość — ale bez
 * `id`, `userId` i `exerciseId` serii. Nick wystarczy do pokazania, czyj to
 * rekord; identyfikator serii dałby punkt zaczepienia do cudzej historii.
 */
export const globalRecordSchema = z
  .object({
    nickname: z.string().min(1),
    performedOn: isoDateSchema,
    note: noteSchema.nullable(),
  })
  .extend(setMeasurementsSchema.shape);

export type GlobalRecord = z.infer<typeof globalRecordSchema>;

export const globalRecordsResponseSchema = z.object({
  exerciseId: uuidSchema,
  records: z.array(globalRecordSchema),
});

export type GlobalRecordsResponse = z.infer<typeof globalRecordsResponseSchema>;

/* --------------------------------------------------------------------- metryki */

/**
 * Metryki rankingów wymagane przez specyfikację:
 *
 * | Metryka    | Co liczy                                   | Jednostka        |
 * | ---------- | ------------------------------------------ | ---------------- |
 * | `volume`   | suma ciężaru × powtórzenia                 | gramy × powtórz. |
 * | `distance` | suma dystansu wszystkich serii biegowych   | metry            |
 * | `records`  | liczba posiadanych rekordów globalnych     | sztuki           |
 *
 * Wartości są całkowite, w jednostkach bazy — zamiana na kilogramy i kilometry
 * należy do warstwy prezentacji, tak samo jak przy pojedynczej serii.
 */
export const RANKING_METRICS = ['volume', 'distance', 'records'] as const;

export type RankingMetric = (typeof RANKING_METRICS)[number];

export const rankingMetricSchema = z.enum(RANKING_METRICS);

/**
 * Objętość jednej serii: ciężar razy powtórzenia, w gramorepetycjach.
 *
 * Mnożymy gramy, a nie kilogramy, bo wynik ma zostać liczbą całkowitą —
 * sumowanie liczb zmiennoprzecinkowych po kilku tysiącach serii daje ranking
 * zależny od kolejności składników. Seria bez kompletu obu pól nie wnosi nic:
 * ćwiczenie na czas nie ma jak mieć objętości.
 */
export function setVolume(set: { weightG: number | null; reps: number | null }): number {
  if (set.weightG === null || set.reps === null) return 0;
  return set.weightG * set.reps;
}

/* -------------------------------------------------------------------- ranking */

export interface RankingCandidate {
  userId: string;
  nickname: string;
  /** Wartość w jednostkach metryki; zawsze całkowita i nieujemna. */
  value: number;
}

export interface RankingEntry extends RankingCandidate {
  /** Miejsce liczone od jedynki; przy remisie wspólne dla wszystkich remisujących. */
  position: number;
}

export const rankingEntrySchema = z.object({
  userId: uuidSchema,
  nickname: z.string().min(1),
  value: z.int().min(0),
  position: z.int().positive(),
});

export const rankingResponseSchema = z.object({
  metric: rankingMetricSchema,
  entries: z.array(rankingEntrySchema),
});

export type RankingResponse = z.infer<typeof rankingResponseSchema>;

/**
 * Porządkuje kandydatów w ranking.
 *
 * Zero znaczy „nie startuje w tej konkurencji", a nie „ostatnie miejsce": kto
 * nigdy nie biegał, nie ma czego robić w rankingu dystansu. Remis daje wspólne
 * miejsce, a kolejne miejsce przeskakuje o liczbę remisujących — tak jak na
 * podium, gdzie po dwóch drugich nie ma trzeciego.
 *
 * Przy równych wartościach kolejność rozstrzyga nick, a potem identyfikator.
 * Nie jest to kosmetyka: bez pełnego porządku dwa wywołania tego samego
 * rankingu potrafiłyby oddać wiersze w innej kolejności.
 */
export function rankCandidates(candidates: readonly RankingCandidate[]): RankingEntry[] {
  const sorted = candidates
    .filter((candidate) => candidate.value > 0)
    .sort(
      (a, b) =>
        b.value - a.value ||
        a.nickname.localeCompare(b.nickname) ||
        (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0),
    );

  let position = 0;
  let previousValue: number | null = null;

  return sorted.map((candidate, index) => {
    if (previousValue === null || candidate.value !== previousValue) {
      position = index + 1;
      previousValue = candidate.value;
    }
    return { ...candidate, position };
  });
}
