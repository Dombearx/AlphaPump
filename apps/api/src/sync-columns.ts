/**
 * Kolumny synchronizacyjne przy zapisie.
 *
 * `server_seq` ma domyślną wartość z sekwencji, ale `DEFAULT` działa wyłącznie
 * przy wstawieniu. Gdyby aktualizacja wiersza nie podbiła numeru, zmiana
 * zostałaby **niewidoczna dla klientów**, których kursor stoi już za starą
 * wartością — czyli edycja serii po prostu nie dojechałaby na drugie
 * urządzenie. Dlatego każdy zapis przechodzi przez te funkcje, a nie ustawia
 * `updated_at` ręcznie.
 */

import { SERVER_SEQ_SEQUENCE } from '@alphapump/db';
import { sql, type SQL } from 'drizzle-orm';

export const nextServerSeq = (): SQL<number> => sql`nextval('${sql.raw(SERVER_SEQ_SEQUENCE)}')`;

export interface WriteStamp {
  updatedAt: Date;
  serverSeq: SQL<number>;
}

/** Znacznik zwykłego zapisu: nowy `updated_at` i kolejny numer sekwencji. */
export function stampWrite(now: Date = new Date()): WriteStamp {
  return { updatedAt: now, serverSeq: nextServerSeq() };
}

/** Znacznik usunięcia. Usuwamy miękko — bez tombstone'a usunięcie nie dojedzie. */
export function stampDelete(now: Date = new Date()): WriteStamp & { deletedAt: Date } {
  return { ...stampWrite(now), deletedAt: now };
}
