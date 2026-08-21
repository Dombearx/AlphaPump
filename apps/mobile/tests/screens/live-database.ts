/**
 * Uchwyt do bazy, przez który ekran widzi tę samą bazę, co test.
 *
 * Ekrany importują `db` z `src/db/client` jako **moduł**, a nie przez propsy —
 * tak jest w aplikacji i tak ma zostać, bo baza lokalna jest tam jedna i żyje
 * tak długo jak proces. Atrapa modułu musi więc oddawać coś, co powstaje później
 * niż ona sama: stąd ten uchwyt, ustawiany w `beforeEach` i czytany dopiero
 * w chwili, w której ekran naprawdę pyta o bazę.
 */

import type { SqliteDatabase } from '@alphapump/db/sqlite';

let current: SqliteDatabase | null = null;

export function setLiveDatabase(db: SqliteDatabase | null): void {
  current = db;
}

export function liveDatabase(): SqliteDatabase {
  if (current === null) throw new Error('Baza testowa nie jest ustawiona — brakuje `mountScreen`?');
  return current;
}
