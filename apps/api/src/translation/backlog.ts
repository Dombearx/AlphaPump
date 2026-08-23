/**
 * Tłumaczenie nazw **poza** ścieżką żądania.
 *
 * ## Dlaczego to nie może dziać się w trakcie zapisu
 *
 * Z tego samego powodu, dla którego poza żądaniem liczą się wektory (patrz
 * `duplicates/backlog.ts`): tłumaczenie jest wywołaniem u dostawcy modeli,
 * a paczka `POST /sync/push` potrafi nieść pięćset ćwiczeń utworzonych offline.
 * Tłumaczenie ich po kolei w środku żądania przekroczyłoby limit czasu telefonu
 * (15 s), a ten pokazałby „offline" mimo działającej sieci i ponowił push.
 *
 * Jest też powód drugi, którego przy wektorach nie było: **zapis nie ma na co
 * czekać**. Ćwiczenie zapisuje się z nazwą, którą ktoś wpisał, i ta nazwa
 * wystarcza — `localizedName` cofa się do niej wszędzie tam, gdzie tłumaczenia
 * jeszcze nie ma. Tłumaczenie jest ulepszeniem wiersza, który już istnieje,
 * a nie warunkiem jego powstania.
 *
 * ## Dlaczego kolejka, a nie „odpal i zapomnij"
 *
 * Bo `void fillTranslations(...)` przy paczce z pięćdziesięcioma ćwiczeniami to
 * pięćdziesiąt równoległych wywołań u dostawcy — czyli limit żądań na minutę
 * i rachunek. Jedna kolejka z jednym wykonawcą szereguje je niezależnie od tego,
 * ile żądań je zgłosiło, i pozwala zapytać, czy coś jeszcze trwa.
 *
 * Zgłoszenie do kolejki nie czeka, nie rzuca i nie ma jak wywrócić zapisu, który
 * je wywołał — `enqueue` nie zwraca obietnicy właśnie po to, żeby nikt nie
 * spróbował na nią zaczekać.
 */

import { missingLanguages } from '@alphapump/core';
import { asc, isNull } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exercises, tags } from '../schema.js';
import { fillTranslations, type TranslatableEntity, type TranslationTarget } from './fill.js';
import type { Translator } from './translator.js';

export interface TranslationBacklogStatus {
  /** Czy jest czym tłumaczyć — model włączony i klucz na miejscu. */
  enabled: boolean;
  /** Czy wykonawca właśnie pracuje. */
  running: boolean;
  /** Ile wierszy czeka w kolejce. */
  pending: number;
  /** Zestawy domknięte od startu procesu. */
  written: number;
  /** Wiersze, które komplet nazw miały już wcześniej. */
  complete: number;
  /** Wywołania, które się nie udały — model nie odpowiedział albo nie znał nazwy. */
  failed: number;
}

export interface TranslationBacklog {
  /** Zgłasza wiersze do przetłumaczenia. Nie czeka i nie rzuca. */
  enqueue(targets: readonly TranslationTarget[]): void;
  /**
   * Zgłasza **wszystkie** tagi i ćwiczenia, którym brakuje nazwy w którymś
   * z języków. Zwraca liczbę wierszy, które weszły do kolejki, albo `null`, gdy
   * nie ma czym tłumaczyć.
   *
   * To jest jednorazowe uzupełnienie danych utworzonych, zanim tłumaczenie
   * w ogóle istniało — z panelu albo z `pnpm --filter api translate`.
   */
  enqueueMissing(): Promise<number | null>;
  status(): TranslationBacklogStatus;
  /** Czeka na opróżnienie kolejki. Istnieje dla testów i dla CLI — serwer nie czeka. */
  drain(): Promise<void>;
}

/** Klucz w kolejce — para „rodzaj + identyfikator", bo id tagu i ćwiczenia mogą się zejść. */
const keyOf = (target: TranslationTarget): string => `${target.entity}:${target.id}`;

function targetOf(key: string): TranslationTarget {
  const separator = key.indexOf(':');
  return {
    entity: key.slice(0, separator) as TranslatableEntity,
    id: key.slice(separator + 1),
  };
}

export function createTranslationBacklog(
  db: Database,
  translator: Translator | null,
): TranslationBacklog {
  const queue = new Set<string>();
  let worker: Promise<void> | null = null;
  let written = 0;
  let complete = 0;
  let failed = 0;

  const run = async (): Promise<void> => {
    // Zdejmujemy po jednym, dopóki cokolwiek zostaje — zgłoszenie, które
    // przyszło w trakcie pracy, dołącza do tego samego przebiegu.
    while (queue.size > 0) {
      const [key] = queue;
      queue.delete(key as string);

      const outcome = await fillTranslations(db, translator, targetOf(key as string));
      if (outcome === 'written') written += 1;
      else if (outcome === 'complete') complete += 1;
      else if (outcome === 'failed') failed += 1;
      // `gone` i `stale` nie są ani sukcesem, ani porażką tłumaczenia: wiersz
      // zniknął albo zdążył zmienić nazwę i wrócił do kolejki z zapisu, który
      // ją zmienił.
    }
  };

  const wake = (): void => {
    if (translator === null || worker !== null || queue.size === 0) return;
    worker = run().finally(() => {
      worker = null;
      // Zgłoszenie, które przyszło dokładnie w chwili kończenia przebiegu, nie
      // może zostać w kolejce bez wykonawcy.
      wake();
    });
  };

  /**
   * Żywe wiersze bez kompletu nazw.
   *
   * O tym, czego brakuje, rozstrzyga `missingLanguages` z rdzenia, a nie
   * warunek w SQL-u — bo to ono zna regułę „nazwa z samych białych znaków to
   * brak nazwy", a przy okazji wie, ile jest języków. Czytamy więc bibliotekę
   * i odsiewamy w pamięci: tagów jest kilkanaście, ćwiczeń setki, a przebieg
   * jest jednorazowy.
   *
   * Wiersze z tombstonem pomijamy: dla użytkownika nie istnieją, a wywołanie
   * modelu dla każdego z nich to rachunek za nazwy, których nikt nie zobaczy.
   */
  const incomplete = async (): Promise<TranslationTarget[]> => {
    const tagRows = await db
      .select({ id: tags.id, translations: tags.translations })
      .from(tags)
      .where(isNull(tags.deletedAt))
      .orderBy(asc(tags.name));

    const exerciseRows = await db
      .select({ id: exercises.id, translations: exercises.translations })
      .from(exercises)
      .where(isNull(exercises.deletedAt))
      .orderBy(asc(exercises.name));

    return [
      ...tagRows
        .filter((row) => missingLanguages(row.translations).length > 0)
        .map((row) => ({ entity: 'tag' as const, id: row.id })),
      ...exerciseRows
        .filter((row) => missingLanguages(row.translations).length > 0)
        .map((row) => ({ entity: 'exercise' as const, id: row.id })),
    ];
  };

  return {
    enqueue(targets) {
      if (translator === null) return;
      for (const target of targets) queue.add(keyOf(target));
      wake();
    },

    async enqueueMissing() {
      if (translator === null) return null;

      const targets = await incomplete();
      for (const target of targets) queue.add(keyOf(target));
      wake();
      return targets.length;
    },

    status() {
      return {
        enabled: translator !== null,
        running: worker !== null,
        pending: queue.size,
        written,
        complete,
        failed,
      };
    },

    async drain() {
      while (worker !== null) await worker;
    },
  };
}

/** Kolejka, która niczego nie robi — dla złożeń bez tłumaczenia. */
export const NO_TRANSLATIONS: TranslationBacklog = {
  enqueue() {},
  enqueueMissing: async () => null,
  status: () => ({
    enabled: false,
    running: false,
    pending: 0,
    written: 0,
    complete: 0,
    failed: 0,
  }),
  drain: async () => undefined,
};
