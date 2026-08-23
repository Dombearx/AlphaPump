/**
 * Tłumaczenie nazw tagów i ćwiczeń — warstwa serwerowa.
 *
 * Wejście zbiorcze modułu. Reszta aplikacji woła stąd trzy rzeczy:
 * `createOpenRouterTranslator` (złożenie z konfiguracji, raz przy starcie),
 * `createTranslationBacklog` (kolejka poza ścieżką żądania — tam trafiają
 * zapisy z REST-a i z pushu) oraz `fillTranslations` (jeden wiersz, dla CLI
 * i dla testów).
 */

export {
  createTranslationBacklog,
  NO_TRANSLATIONS,
  type TranslationBacklog,
  type TranslationBacklogStatus,
} from './backlog.js';
export {
  fillTranslations,
  type TranslatableEntity,
  type TranslationOutcome,
  type TranslationTarget,
} from './fill.js';
export { createOpenRouterTranslator } from './openrouter.js';
export { type TranslationRequest, type Translator } from './translator.js';
