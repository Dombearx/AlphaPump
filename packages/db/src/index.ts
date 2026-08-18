/**
 * `@alphapump/db` — jeden opis schematu, dwa dialekty.
 *
 * To wejście zawiera wyłącznie rzeczy **niezależne od dialektu**: nazwy tabel,
 * kolumny synchronizacyjne i dane startowe. Same schematy Drizzle są pod
 * osobnymi wejściami, żeby aplikacja mobilna nie wciągała sterownika
 * PostgreSQL, a serwer — sterownika SQLite:
 *
 * | Wejście                    | Zawartość                                  |
 * | -------------------------- | ------------------------------------------ |
 * | `@alphapump/db`            | nazwy tabel, dane startowe                  |
 * | `@alphapump/db/pg`         | schemat PostgreSQL + seed serwerowy         |
 * | `@alphapump/db/sqlite`     | schemat SQLite + seed lokalny               |
 * | `@alphapump/db/migrations` | ścieżki do katalogów migracji               |
 */

export * from './tables.js';
export * from './seed/data.js';
export * from './seed/render.js';
