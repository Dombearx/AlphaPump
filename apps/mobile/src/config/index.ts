/**
 * Konfiguracja odczytana z manifestu Expo.
 *
 * `app.config.js` przekłada zmienne środowiskowe na pole `extra`, a tutaj
 * zamienia się ono w typowany obiekt. Jedno miejsce, w którym aplikacja
 * dowiaduje się, gdzie stoi serwer.
 */

import Constants from 'expo-constants';
import { parseAppConfig, type AppConfig } from './schema';

export * from './schema';

export const appConfig: AppConfig = parseAppConfig(Constants.expoConfig?.extra);
