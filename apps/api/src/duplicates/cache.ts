/**
 * Cache odpowiedzi re-rankera.
 *
 * Powód istnienia jest prosty: warstwa 3 kosztuje pieniądze i sekundy, a pytanie
 * „czy to duplikat" jest przy tworzeniu ćwiczenia zadawane wielokrotnie — formularz
 * pyta w trakcie pisania nazwy, a użytkownik po zapisie wraca poprawić literówkę.
 *
 * ## Klucz to nie sam slug
 *
 * Werdykt modelu zależy od **dwóch** rzeczy: od nazwy i od zestawu kandydatów.
 * Cache po samym slugu oddawałby po dodaniu nowego ćwiczenia odpowiedź, która
 * o nim nie wie — i nic by jej nie unieważniło, bo slug się nie zmienił. Dlatego
 * kluczem jest para slug + odcisk listy kandydatów, a modelem trzeci składnik:
 * zmiana modelu też unieważnia werdykt.
 *
 * Odcisk liczymy z identyfikatorów **w kolejności ze scalenia RRF**, bo werdykty
 * odnoszą się do pozycji na liście. Ta sama lista w innej kolejności to inne
 * wejście dla modelu, więc musi być innym kluczem.
 *
 * ## Dlaczego w bazie, a nie w pamięci
 *
 * Cache w pamięci procesu ginie przy każdym wdrożeniu i nie jest dzielony między
 * urządzeniami. Tu wpisów jest mało (jeden na nazwę i zestaw kandydatów),
 * a tabela jest usuwalna w całości bez konsekwencji — brak cache'u znaczy tylko,
 * że model zostanie zapytany ponownie.
 */

import { createHash } from 'node:crypto';
import { rerankVerdictSchema, slug, type RerankVerdict } from '@alphapump/core';
import { and, eq, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import type { Database } from '../db.js';
import { duplicateCheckCache } from '../schema.js';

/** Domyślne okno retencji wpisów cache'u — po tym czasie pytamy model od nowa. */
export const DEFAULT_CACHE_RETENTION_DAYS = 90;

const verdictsSchema = z.array(rerankVerdictSchema);

/**
 * Odcisk zestawu kandydatów. SHA-256 skrócony do 32 znaków — kolizja przy
 * kilkuset ćwiczeniach jest zdarzeniem, którego nie zobaczy nikt, a klucz zostaje
 * czytelny w podglądzie tabeli.
 */
export function candidatesFingerprint(exerciseIds: readonly string[]): string {
  return createHash('sha256').update(exerciseIds.join('|')).digest('hex').slice(0, 32);
}

export interface CacheKey {
  querySlug: string;
  candidatesFingerprint: string;
  model: string;
}

export function cacheKey(query: string, exerciseIds: readonly string[], model: string): CacheKey {
  return {
    querySlug: slug(query),
    candidatesFingerprint: candidatesFingerprint(exerciseIds),
    model,
  };
}

/**
 * Czyta werdykty z cache'u. Wpis o nieznanym kształcie traktujemy jak brak wpisu —
 * kolumna jest JSON-em, więc jej zawartość mogła powstać w starszej wersji kodu.
 */
export async function readCachedVerdicts(
  db: Database,
  key: CacheKey,
): Promise<RerankVerdict[] | null> {
  const [row] = await db
    .select({ verdicts: duplicateCheckCache.verdicts })
    .from(duplicateCheckCache)
    .where(
      and(
        eq(duplicateCheckCache.querySlug, key.querySlug),
        eq(duplicateCheckCache.candidatesFingerprint, key.candidatesFingerprint),
        eq(duplicateCheckCache.model, key.model),
      ),
    )
    .limit(1);

  if (!row) return null;

  const parsed = verdictsSchema.safeParse(row.verdicts);
  return parsed.success ? parsed.data : null;
}

export async function writeCachedVerdicts(
  db: Database,
  key: CacheKey,
  verdicts: readonly RerankVerdict[],
  now: Date = new Date(),
): Promise<void> {
  const values = { ...key, verdicts: [...verdicts], createdAt: now };

  await db
    .insert(duplicateCheckCache)
    .values(values)
    .onConflictDoUpdate({
      target: [
        duplicateCheckCache.querySlug,
        duplicateCheckCache.candidatesFingerprint,
        duplicateCheckCache.model,
      ],
      set: { verdicts: values.verdicts, createdAt: now },
    });
}

/** Zdejmuje wpisy starsze niż okno retencji. Zadanie porządkowe administratora. */
export async function pruneCache(
  db: Database,
  olderThanDays: number = DEFAULT_CACHE_RETENTION_DAYS,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - olderThanDays * 24 * 60 * 60 * 1000);

  const removed = await db
    .delete(duplicateCheckCache)
    .where(lt(duplicateCheckCache.createdAt, cutoff))
    .returning({ querySlug: duplicateCheckCache.querySlug });

  return removed.length;
}

/** Liczba wpisów w cache'u — do wglądu w dane systemowe w panelu. */
export async function countCache(db: Database): Promise<number> {
  const [row] = await db.select({ total: sql<number>`count(*)::int` }).from(duplicateCheckCache);
  return row?.total ?? 0;
}
