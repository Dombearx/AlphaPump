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
import type { RunningBundle, UpdateActivity } from './running';

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

/**
 * Paczka, na której aplikacja chodzi w tej chwili — bez części pochodzącej
 * z pakietu (`versionName`, `versionCode`), bo tę wie `expo.ts`. Składa jedno
 * z drugim `use-update.ts`.
 *
 * Zamiana `undefined` na `null` nie jest kosmetyką: `expo-updates` oddaje
 * `undefined` w każdym środowisku, w którym jest wyłączony — czyli u dewelopera
 * — a `running.ts` ma jeden przypadek „nie wiadomo" zamiast dwóch.
 */
export type RunningPackage = Omit<RunningBundle, 'versionName' | 'versionCode'>;

export function useRunningPackage(): RunningPackage {
  const { currentlyRunning } = Updates.useUpdates();

  return {
    embedded: currentlyRunning.isEmbeddedLaunch,
    createdAt: currentlyRunning.createdAt ?? null,
    updateId: currentlyRunning.updateId ?? null,
    runtimeVersion: currentlyRunning.runtimeVersion ?? null,
    emergency: currentlyRunning.isEmergencyLaunch,
    emergencyReason: currentlyRunning.emergencyLaunchReason,
  };
}

/**
 * Stan aktualizacji od uruchomienia aplikacji — do wypisania na ekranie konta.
 *
 * Osobno od `useOtaUpdate`, bo to nie jest to samo pytanie: tam chodzi o to,
 * czy pokazać okno, tutaj o to, **dlaczego** okno wraca. Pobrana paczka i
 * paczka uruchomiona to dwie różne rzeczy i dopiero zestawione obok siebie
 * mówią, czy restart cokolwiek zmienił.
 */
export function useUpdateActivity(): UpdateActivity {
  const { downloadedUpdate, isUpdatePending, checkError, downloadError } = Updates.useUpdates();

  return {
    pending:
      isUpdatePending && downloadedUpdate !== undefined
        ? {
            createdAt: downloadedUpdate.createdAt,
            updateId: downloadedUpdate.updateId ?? null,
          }
        : null,
    checkError: checkError?.message ?? null,
    downloadError: downloadError?.message ?? null,
  };
}
