/**
 * Strona natywna kolejności ćwiczeń: jeden mały plik w katalogu dokumentów.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — reguły są
 * w `state.ts`, a stan ekranu w `use-exercise-order.ts`. Ten sam wzorzec i ten
 * sam katalog co przy języku i dyktowaniu: pamięć podręczną system czyści,
 * kiedy potrzebuje miejsca, a ustawienie, które znika po nocy, wygląda jak
 * awaria.
 */

import { File, Paths } from 'expo-file-system';
import {
  DEFAULT_EXERCISE_ORDER,
  parseExerciseOrder,
  serializeExerciseOrder,
  type ExerciseOrder,
  type ExerciseOrderStore,
} from './state';

const REGISTRY_FILE = 'exercise-order.json';

export const expoExerciseOrderStore: ExerciseOrderStore = {
  read: async () => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) return DEFAULT_EXERCISE_ORDER;
    return parseExerciseOrder(await file.text());
  },

  write: (order: ExerciseOrder) => {
    const file = new File(Paths.document, REGISTRY_FILE);
    if (!file.exists) file.create();
    file.write(serializeExerciseOrder(order));
    return Promise.resolve();
  },
};
