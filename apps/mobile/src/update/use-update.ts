/**
 * Wpięcie aktualizacji w cykl życia aplikacji.
 *
 * Dwie rzeczy naraz, bo dla użytkownika są jedną („jest nowsza wersja"), a dla
 * systemu zupełnie różnymi:
 *
 * - **paczka JavaScriptu** (`ota.ts`) — pobiera się sama, w tle, i czeka na
 *   uruchomienie. To jest droga każdego zwykłego wydania.
 * - **pakiet natywny** (`manifest.ts`, `expo.ts`) — kilkadziesiąt megabajtów do
 *   pobrania przeglądarką i zainstalowania ręcznie. Potrzebny wyłącznie wtedy,
 *   gdy ruszyła warstwa natywna, czyli parę razy w roku.
 *
 * Sprawdzenie wydania natywnego chodzi tym samym wyzwalaczem co synchronizacja
 * (`sync/provider.tsx`) i z tego samego powodu: telefon z pełnym zasięgiem bywa
 * poza VPN-em, więc stan sieci od systemu niczego nie mówi, a jedynym uczciwym
 * testem jest próba dobicia się do minipc. Najczęstszy moment, w którym warunki
 * naprawdę się zmieniły, to wyjęcie telefonu z kieszeni — stąd sprawdzenie przy
 * starcie i przy każdym powrocie aplikacji na wierzch.
 *
 * Sprawdzenie jest **ciche**. Nieudane nie pokazuje niczego i nie trafia nawet
 * do logu widocznego dla użytkownika: minipc bywa poza zasięgiem częściej, niż
 * jest w nim, a komunikat „nie sprawdziłem aktualizacji" przy każdym otwarciu
 * aplikacji poza domem byłby szumem, na który nie ma reakcji.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { appConfig } from '../config/index';
import {
  dismissedVersionCode,
  installedVersionCode,
  installedVersionName,
  openRelease,
  rememberDismissedVersion,
} from './expo';
import {
  fetchUpdateManifest,
  isUpdateAvailable,
  releaseUrl,
  type UpdateManifest,
} from './manifest';
import { useOtaUpdate, useRunningPackage } from './ota';
import type { RunningBundle } from './running';

/** Najkrótszy odstęp między sprawdzeniami — powrót na wierzch bywa częsty. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type UpdateStage =
  /** Nie ma o czym mówić: nic nowego albo jeszcze nie sprawdzono. */
  | { kind: 'none' }
  /** Paczka JavaScriptu pobrana i gotowa — zostaje uruchomić ponownie. */
  | { kind: 'restart' }
  /** Jest nowszy pakiet natywny; trzeba go pobrać i zainstalować ręcznie. */
  | { kind: 'native'; manifest: UpdateManifest };

export interface UpdateState {
  stage: UpdateStage;
  /** Uruchamia pobraną paczkę albo otwiera plik wydania w przeglądarce. */
  confirm: () => void;
  /** „Nie teraz". Dla wydania natywnego — do następnego wydania. */
  dismiss: () => void;
}

export function useUpdateCheck(): UpdateState {
  const ota = useOtaUpdate();
  const [nativeRelease, setNativeRelease] = useState<UpdateManifest | null>(null);
  const [restartDismissed, setRestartDismissed] = useState(false);
  const lastCheckedAt = useRef(0);

  const check = useCallback(() => {
    // Poza Androidem nie ma jak zainstalować pakietu spoza sklepu, więc nie ma
    // też po co pytać o manifest. Paczek JavaScriptu to nie dotyczy — te działają
    // wszędzie i chodzą osobną drogą.
    if (Platform.OS !== 'android') return;

    const now = Date.now();
    if (now - lastCheckedAt.current < CHECK_INTERVAL_MS) return;
    lastCheckedAt.current = now;

    void (async () => {
      const installed = installedVersionCode();

      let manifest: UpdateManifest;
      try {
        manifest = await fetchUpdateManifest({ baseUrl: appConfig.updateBaseUrl });
      } catch {
        return;
      }

      if (!isUpdateAvailable(manifest, installed)) return;
      // Odłożone znaczy odłożone — ale tylko to jedno wydanie.
      if (manifest.versionCode === (await dismissedVersionCode())) return;

      setNativeRelease(manifest);
    })();
  }, []);

  useEffect(() => {
    check();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') check();
    });
    return () => {
      subscription.remove();
    };
  }, [check]);

  /**
   * Paczka przed pakietem, gdy zdarzy się jedno i drugie naraz. Uruchomienie
   * ponowne to jedno kliknięcie i chwila, a pobranie pakietu — przeglądarka,
   * zgoda systemowa i instalator. Pakiet nie zniknie: zapyta przy następnym
   * otwarciu.
   */
  const stage: UpdateStage =
    ota.ready && !restartDismissed
      ? { kind: 'restart' }
      : nativeRelease === null
        ? { kind: 'none' }
        : { kind: 'native', manifest: nativeRelease };

  const confirm = useCallback(() => {
    if (stage.kind === 'restart') {
      ota.apply();
      return;
    }
    if (stage.kind === 'native') {
      void openRelease(releaseUrl(appConfig.updateBaseUrl, stage.manifest)).catch(() => {
        // Brak przeglądarki zdolnej otworzyć ten adres. Nie ma tu nic do
        // zrobienia poza niewywaleniem aplikacji — okno zostaje otwarte, a
        // adres katalogu wydań i tak jest w nim wypisany.
      });
    }
  }, [stage, ota]);

  const dismiss = useCallback(() => {
    if (stage.kind === 'restart') {
      // Bez zapisu na dysk: paczka i tak uruchomi się przy następnym otwarciu
      // aplikacji, więc „nie teraz" ma znaczyć „nie przerywaj mi teraz", a nie
      // „nie aktualizuj".
      setRestartDismissed(true);
      return;
    }
    if (stage.kind === 'native') {
      void rememberDismissedVersion(stage.manifest.versionCode);
      setNativeRelease(null);
    }
  }, [stage]);

  return { stage, confirm, dismiss };
}

/**
 * Co w tej chwili chodzi na telefonie — pakiet i paczka razem.
 *
 * Dwie warstwy, bo dwa źródła: numer wydania niesie sam pakiet (`expo.ts`),
 * a to, czy chodzi kod z pakietu, czy pobrany później, wie `expo-updates`
 * (`ota.ts`). Dla pytającego „mam najnowszą wersję?" jest to jedna odpowiedź,
 * więc składa się ją tutaj, tak samo jak dwie drogi aktualizacji wyżej.
 *
 * Opis do pokazania robi z tego `running.ts` — czysty i przetestowany.
 */
export function useRunningBundle(): RunningBundle {
  const running = useRunningPackage();

  return {
    ...running,
    versionName: installedVersionName(),
    versionCode: installedVersionCode(),
  };
}
