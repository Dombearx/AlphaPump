/**
 * Nazwy tabel i kolumn synchronizacyjnych — wspólne dla obu dialektów.
 *
 * Schemat jest opisany dwa razy (raz w `pg/`, raz w `sqlite/`), bo buildery
 * Drizzle są osobne dla każdego dialektu i nie da się ich sensownie uwspólnić
 * bez warstwy pośredniej, która i tak zgubiłaby typy. Zamiast tego wspólne są
 * **nazwy**, a test parzystości (`tests/schema-parity.test.ts`) pilnuje, żeby
 * oba opisy miały te same tabele i te same kolumny.
 */

/** Tabele objęte synchronizacją — istnieją po obu stronach, kolumna w kolumnę. */
export const SYNCED_TABLES = [
  'tags',
  'exercises',
  'exercise_tags',
  'workout_sets',
  'cycles',
  'cycle_goals',
] as const;

export type SyncedTable = (typeof SYNCED_TABLES)[number];

/**
 * Kolumny, po których jedzie synchronizacja.
 *
 * `updated_at` rozstrzyga LWW, `deleted_at` jest tombstonem (bez niego
 * usunięcie wykonane offline nie miałoby jak dojechać na serwer), a
 * `server_seq` jest kursorem pobierania.
 *
 * `device_id` istnieje wyłącznie po to, żeby remis `updated_at` miał
 * rozstrzygnięcie **deterministyczne**. Bez niego dwa urządzenia, których
 * zegary wskazały tę samą milisekundę, mogłyby zbiec się do różnych wersji
 * wiersza w zależności od kolejności pushy — a to jest dokładnie ta klasa
 * błędu, której nikt nigdy nie zauważy w logach.
 */
export const SYNC_COLUMNS = [
  'created_at',
  'updated_at',
  'deleted_at',
  'server_seq',
  'device_id',
] as const;

/**
 * Sekwencja, z której serwer nadaje `server_seq`. Jedna, wspólna dla wszystkich
 * tabel — dzięki temu `GET /sync/pull?since=` ma **jeden** kursor zamiast kursora
 * per tabela, a klient nie może przegapić wiersza z tabeli, którą akurat
 * pobierał jako pierwszą.
 */
export const SERVER_SEQ_SEQUENCE = 'server_seq';

/**
 * Rozszerzenia PostgreSQL, których wymaga schemat serwerowy.
 *
 * `pg_trgm` obsługuje warstwę leksykalną wykrywania duplikatów, `vector` —
 * semantyczną. Lista jest wystawiona jako stała, bo poza migracją potrzebują jej
 * także testy: PGlite ładuje rozszerzenia przy tworzeniu instancji, a nie
 * poleceniem SQL, więc `CREATE EXTENSION` w migracji nie miałby czego włączyć.
 */
export const PG_EXTENSIONS = ['pg_trgm', 'vector'] as const;

/**
 * Wymiar wektora embeddingu, zafiksowany w schemacie.
 *
 * Indeks HNSW wymaga wymiaru znanego w definicji kolumny, więc zmiana modelu na
 * taki o innym wymiarze jest migracją, a nie zmianą konfiguracji. Wartość 1024
 * odpowiada wielojęzycznym modelom rozważanym w stacku (Qwen3 Embedding); model
 * o innym wymiarze zostanie odrzucony przy zapisie, zamiast wpisać do wspólnej
 * przestrzeni wektor, którego nie da się porównać z pozostałymi.
 */
export const EMBEDDING_DIMENSIONS = 1024;
