/**
 * Strona natywna aktualizacji OTA — paczki JavaScriptu pobieranej bez instalatora.
 *
 * Prawie wszystko robi tu `expo-updates` sam: sprawdza manifest przy starcie
 * (`checkAutomatically: 'ON_LOAD'` w `app.config.js`), pobiera paczkę w tle
 * i trzyma ją gotową do uruchomienia. Ten moduł jest cienką warstwą nad jego
 * hakiem — istnieje po to, żeby reszta aplikacji nie importowała `expo-updates`
 * bezpośrednio, tak samo jak `expo.ts` obok.
 *
 * ## Czego ten moduł świadomie nie robi
 *
 * Nie pyta o aktualizację przy każdym powrocie aplikacji na wierzch, choć tak
 * działa sprawdzanie wydań natywnych i synchronizacja. Paczka jedzie tą samą
 * trasą co wydanie natywne i tak samo wymaga trafienia w minipc, ale w
 * przeciwieństwie do nich **nie wymaga niczyjej decyzji** — pobiera się sama
 * i czeka. Dokładanie do tego pytania co powrót z kieszeni kupiłoby najwyżej
 * kilkanaście minut szybszą podmianę za ruch sieciowy przy każdym otwarciu.
 *
 * Nie uruchamia też paczki od razu po pobraniu. Podmiana kodu pod palcami
 * kogoś, kto właśnie zapisuje serię, jest gorsza niż aktualizacja godzinę
 * później: `expo-updates` uruchomi ją sam przy następnym otwarciu aplikacji,
 * a kto chce wcześniej, ma przycisk.
 */

import * as Updates from 'expo-updates';

export interface OtaState {
  /** Paczka pobrana i gotowa — zostaje uruchomić ponownie. */
  ready: boolean;
  /** Uruchamia pobraną paczkę. Proces startuje od nowa, więc nie wraca. */
  apply: () => void;
}

export function useOtaUpdate(): OtaState {
  const { isUpdatePending } = Updates.useUpdates();

  return {
    ready: isUpdatePending,
    apply: () => {
      void Updates.reloadAsync().catch(() => {
        // Nieudany restart zostawia aplikację działającą na starej paczce —
        // czyli w stanie, w którym była chwilę wcześniej. Paczka jest już na
        // dysku, więc `expo-updates` uruchomi ją przy następnym otwarciu.
      });
    },
  };
}
