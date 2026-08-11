/**
 * Wykrywanie duplikatów ćwiczeń — kształt odpowiedzi warstw serwerowych.
 *
 * Warstw jest trzy i różnią się **dostępnością**, nie tylko trafnością:
 *
 * | Warstwa | Gdzie liczona            | Kiedy działa            |
 * | ------- | ------------------------ | ----------------------- |
 * | 1       | telefon (`similarity.ts`) | zawsze, także offline   |
 * | 2       | serwer, hybrydowa         | gdy jest łączność       |
 * | 3       | serwer, re-ranker LLM     | gdy warstwa jest włączona |
 *
 * Ten moduł opisuje wyłącznie to, co wychodzi z warstw 2 i 3 — warstwa 1 jest
 * czystą funkcją i mieszka w `similarity.ts`. Schematy są tutaj, w rdzeniu, bo
 * czyta je i serwer, i telefon: rozjazd między „co API zwraca" a „co aplikacja
 * umie przeczytać" jest wtedy niemożliwy z definicji.
 *
 * Dwa pola niosą całą informację o tym, **jak głęboko** poszło zapytanie:
 * `layer` mówi, która warstwa faktycznie się wykonała, a `sources` przy każdym
 * kandydacie — która go znalazła. Bez nich wyłączenie warstwy semantycznej albo
 * re-rankera byłoby dla aplikacji nierozpoznawalne od „nic nie znalazłem", a to
 * są dwie zupełnie różne sytuacje: pierwsza znaczy „pokaż ostrzeżenie lokalne",
 * druga — „nie ma duplikatu".
 *
 * Ostrzeżenie **nigdy nie blokuje zapisu**, niezależnie od warstwy. Granica
 * między „to samo ćwiczenie" a „wariant, który chcę mieć osobno" należy do
 * użytkownika.
 */

import { z } from 'zod';
import { displayNameSchema, noteSchema, uuidSchema } from './schemas.js';

/** Skąd wziął się kandydat. Wpis z obu list jest mocniejszym sygnałem niż z jednej. */
export const DUPLICATE_SOURCES = ['lexical', 'semantic'] as const;
export type DuplicateSource = (typeof DUPLICATE_SOURCES)[number];
export const duplicateSourceSchema = z.enum(DUPLICATE_SOURCES);

/**
 * Najgłębsza warstwa, która się wykonała.
 *
 * `lexical` znaczy „warstwa semantyczna jest wyłączona albo nie miała czym
 * policzyć podobieństwa" — odpowiedź jest wtedy tym samym, co dawał etap 8,
 * tylko policzonym po stronie serwera.
 */
export const DUPLICATE_LAYERS = ['lexical', 'hybrid', 'llm'] as const;
export type DuplicateLayer = (typeof DUPLICATE_LAYERS)[number];
export const duplicateLayerSchema = z.enum(DUPLICATE_LAYERS);

/** Ilu kandydatów wychodzi ze scalenia RRF — wejście dla re-rankera i dla ekranu. */
export const DUPLICATE_CANDIDATE_LIMIT = 10;

/**
 * Kandydat na duplikat.
 *
 * Nick autora jest tu dlatego, że komunikat ma brzmieć „to wygląda na to samo co
 * «Wyciskanie sztangi leżąc» (autor: Kuba)" — bez autora użytkownik nie wie, czy
 * patrzy na własny wpis, czy na cudzy, a to zmienia decyzję.
 */
export const duplicateCandidateSchema = z.object({
  exerciseId: uuidSchema,
  name: displayNameSchema,
  authorNickname: z.string().min(1),
  primaryTagName: z.string().min(1),
  /** Wynik scalenia RRF. Ma sens wyłącznie w porównaniu z innymi kandydatami. */
  score: z.number(),
  sources: z.array(duplicateSourceSchema).min(1),
  /**
   * Slug identyczny z zapytaniem. Dla ćwiczenia tego samego autora znaczy to,
   * że zapis trafi w ten wiersz zamiast utworzyć nowy — bo identyfikator
   * wylicza się z pary autor + slug.
   */
  identical: z.boolean(),
  /**
   * Werdykt re-rankera: `true` — to ten sam ruch, `false` — coś innego,
   * `null` — warstwa 3 nie działała i nikt tego nie oceniał.
   */
  duplicate: z.boolean().nullable(),
  /** Uzasadnienie werdyktu, po polsku, do pokazania wprost. */
  reason: noteSchema.nullable(),
});

export type DuplicateCandidate = z.infer<typeof duplicateCandidateSchema>;

export const duplicateCheckResponseSchema = z.object({
  /** Nazwa, o którą pytano — echo wejścia, bo odpowiedź bywa cache'owana. */
  query: z.string().min(1),
  layer: duplicateLayerSchema,
  candidates: z.array(duplicateCandidateSchema),
});

export type DuplicateCheckResponse = z.infer<typeof duplicateCheckResponseSchema>;

/**
 * Werdykt jednej pozycji zwracany przez model jako structured output.
 *
 * Model dostaje kandydatów z indeksami i oddaje werdykty po indeksach, a nie po
 * identyfikatorach. UUID w odpowiedzi generatywnego modelu bywa przepisany
 * z błędem — a wtedy werdykt trafiałby w nieistniejący wiersz albo, gorzej,
 * w cudzy. Indeks z małego zakresu jest odporny na tę klasę pomyłek i łatwy do
 * odrzucenia, gdy wypadnie z zakresu.
 */
export const rerankVerdictSchema = z.object({
  index: z.int().min(0),
  duplicate: z.boolean(),
  reason: z.string().min(1).max(300),
});

export type RerankVerdict = z.infer<typeof rerankVerdictSchema>;

export const rerankResultSchema = z.object({
  verdicts: z.array(rerankVerdictSchema),
});

export type RerankResult = z.infer<typeof rerankResultSchema>;

/**
 * Nakłada werdykty modelu na listę kandydatów.
 *
 * Funkcja jest tutaj, a nie przy wywołaniu modelu, z dwóch powodów: jest czysta
 * (więc testowalna bez sieci) i musi być **odporna na model**. Odpowiedź LLM-a
 * jest danymi wejściowymi z zewnątrz, nawet gdy przeszła walidację schematu:
 * indeks potrafi wypaść z zakresu albo powtórzyć się, a wtedy werdykt trzeba
 * zignorować, a nie doklejać do przypadkowego wpisu. Kandydat bez werdyktu
 * zostaje z `duplicate: null` — czyli „nikt tego nie oceniał", a nie „nie jest
 * duplikatem".
 */
export function applyVerdicts(
  candidates: readonly DuplicateCandidate[],
  verdicts: readonly RerankVerdict[],
): DuplicateCandidate[] {
  const byIndex = new Map<number, RerankVerdict>();
  for (const verdict of verdicts) {
    if (verdict.index >= candidates.length) continue;
    // Pierwszy werdykt dla danego indeksu wygrywa — model, który wypowiedział
    // się dwa razy o tej samej pozycji, nie może przeważyć sam siebie.
    if (!byIndex.has(verdict.index)) byIndex.set(verdict.index, verdict);
  }

  return candidates.map((candidate, index) => {
    const verdict = byIndex.get(index);
    if (!verdict) return candidate;
    return { ...candidate, duplicate: verdict.duplicate, reason: verdict.reason };
  });
}

/**
 * Porządkuje kandydatów po ocenie modelu: najpierw uznane za duplikat, potem
 * nieocenione, na końcu odrzucone. Wewnątrz grupy zostaje kolejność z RRF.
 *
 * Bez tego kroku pozycja odrzucona przez model mogłaby stać nad tą, którą uznał
 * za duplikat — i ekran pokazywałby jako pierwsze to, o czym model powiedział
 * wprost, że nie ma związku.
 */
export function orderByVerdict(candidates: readonly DuplicateCandidate[]): DuplicateCandidate[] {
  const rank = (candidate: DuplicateCandidate): number =>
    candidate.duplicate === true ? 0 : candidate.duplicate === null ? 1 : 2;

  return [...candidates]
    .map((candidate, index) => ({ candidate, index }))
    .sort((a, b) => rank(a.candidate) - rank(b.candidate) || a.index - b.index)
    .map((entry) => entry.candidate);
}
