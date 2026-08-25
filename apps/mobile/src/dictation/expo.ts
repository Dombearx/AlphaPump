/**
 * Strona natywna trybu dyktowania: jeden mały plik w katalogu dokumentów.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — reguły są
 * w `state.ts`, a stan ekranu w `use-dictation.ts`. Ten sam wzorzec i ten sam
 * katalog co przy języku: pamięć podręczną system czyści, kiedy potrzebuje
 * miejsca, a ustawienie, które znika po nocy, wygląda jak awaria.
 */

import { File, Paths } from 'expo-file-system';
import {
  DEFAULT_DICTATION_MODE,
  parseDictationMode,
  serializeDictationMode,
  type DictationMode,
  type DictationStore,
} from './state';

const REGISTRY_FILE = 'dictation.json';

export const expoDictationStore: DictationStore = {
  read: async () => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) return DEFAULT_DICTATION_MODE;
    return parseDictationMode(await file.text());
  },

  write: (mode: DictationMode) => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) file.create();
    file.write(serializeDictationMode(mode));
    return Promise.resolve();
  },
};
