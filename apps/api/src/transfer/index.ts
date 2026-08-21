/**
 * Eksport i import danych.
 *
 * Jeden serializer i jeden deserializer, używane przez trzy rzeczy: funkcję
 * eksportu i importu w aplikacji, endpointy `GET /export` i `POST /import` oraz
 * skrypty `pnpm --filter api export` i `import`, na których stoi kopia zapasowa.
 * Format i jego reguły mieszkają w `@alphapump/core`, żeby telefon i serwer
 * czytały ten sam plik tym samym schematem.
 */

export { exportArchive, type ExportScope } from './export.js';
export {
  importArchive,
  type ImportActor,
  type ImportOptions,
  type ImportReport,
} from './import.js';
