/**
 * `@alphapump/core` — reguły domenowe AlphaPump.
 *
 * Pakiet nie ma żadnej zależności od I/O: nie czyta bazy, nie woła sieci, nie
 * sięga po zegar poza funkcjami, którym czas podaje się jawnie. To warunek tego,
 * żeby telefon i serwer liczyły rekordy, cykle i identyfikatory **tym samym
 * kodem** — bo rozjazd między nimi byłby niewidoczny w kodzie i bardzo widoczny
 * dla użytkownika.
 */

export * from './units.js';
export * from './dates.js';
export * from './slug.js';
export * from './languages.js';
export * from './ids.js';
export * from './tag-color.js';
export * from './logging-type.js';
export * from './records.js';
export * from './rankings.js';
export * from './similarity.js';
export * from './rrf.js';
export * from './duplicates.js';
export * from './cycles.js';
export * from './suggestions.js';
export * from './schemas.js';
export * from './rejections.js';
export * from './sync.js';
export * from './transfer.js';
export * from './fitnotes.js';
export * from './admin.js';
export * from './library-admin.js';
export * from './feedback.js';
