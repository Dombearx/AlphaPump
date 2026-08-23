/**
 * Strona natywna wyboru języka: jeden mały plik w katalogu dokumentów.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — reguły są
 * w `state.ts`, a stan aplikacji w `provider.tsx`. Ten plik jest cienki celowo:
 * to jedyna warstwa, której testy nie obejmują, więc ma nie zawierać decyzji.
 *
 * Katalog dokumentów, a nie pamięć podręczna, bo tę system czyści, kiedy
 * potrzebuje miejsca — a wybór języka, który znika po nocy, wygląda jak awaria.
 */

import { DEFAULT_LANGUAGE, type Language } from '@alphapump/core';
import { File, Paths } from 'expo-file-system';
import { parseLanguage, serializeLanguage, type LanguageStore } from './state';

const REGISTRY_FILE = 'language.json';

export const expoLanguageStore: LanguageStore = {
  read: async () => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) return DEFAULT_LANGUAGE;
    return parseLanguage(await file.text());
  },

  write: (language: Language) => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) file.create();
    file.write(serializeLanguage(language));
    return Promise.resolve();
  },
};
