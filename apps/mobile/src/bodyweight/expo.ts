/**
 * Strona natywna masy ciała: jeden mały plik w katalogu dokumentów.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — reguły są
 * w `state.ts`, a stan ekranu w `use-bodyweight.ts`. Ten plik jest cienki
 * celowo: to jedyna warstwa, której testy nie obejmują, więc ma nie zawierać
 * decyzji.
 *
 * Katalog dokumentów, a nie pamięć podręczna, bo tę system czyści, kiedy
 * potrzebuje miejsca — a masa ciała, która znika po nocy, wygląda jak awaria.
 */

import { File, Paths } from 'expo-file-system';
import { parseBodyweight, serializeBodyweight, type BodyweightStore } from './state';

const REGISTRY_FILE = 'bodyweight.json';

export const expoBodyweightStore: BodyweightStore = {
  read: async () => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) return null;
    return parseBodyweight(await file.text());
  },

  write: (bodyweightG: number | null) => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) file.create();
    file.write(serializeBodyweight(bodyweightG));
    return Promise.resolve();
  },
};
