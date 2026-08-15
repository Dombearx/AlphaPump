/**
 * Wpięcie sprawdzania aktualizacji w cykl życia aplikacji.
 *
 * Ten sam wyzwalacz co przy synchronizacji (`sync/provider.tsx`) i z tego
 * samego powodu: telefon z pełnym zasięgiem bywa poza VPN-em, więc stan sieci
 * od systemu niczego nie mówi, a jedynym uczciwym testem jest próba dobicia się
 * do minipc. Najczęstszy moment, w którym warunki naprawdę się zmieniły, to
 * wyjęcie telefonu z kieszeni — stąd sprawdzenie przy starcie i przy każdym
 * powrocie aplikacji na wierzch.
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
  expoUpdateInstaller,
  installedVersionCode,
  rememberDismissedVersion,
} from './expo';
import {
  installUpdate,
  UpdateInstallError,
  describeInstallFailure,
  type DownloadProgress,
} from './install';
import { fetchUpdateManifest, isUpdateAvailable, type UpdateManifest } from './manifest';

/** Najkrótszy odstęp między sprawdzeniami — powrót na wierzch bywa częsty. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

export type UpdateStage =
  /** Nie ma o czym mówić: brak nowego wydania albo jeszcze nie sprawdzono. */
  | { kind: 'none' }
  /** Jest nowsze wydanie i użytkownik go jeszcze nie odłożył. */
  | { kind: 'available'; manifest: UpdateManifest }
  | { kind: 'downloading'; manifest: UpdateManifest; progress: DownloadProgress }
  | { kind: 'failed'; manifest: UpdateManifest; message: string };

export interface UpdateState {
  stage: UpdateStage;
  /** Pobiera i oddaje plik instalatorowi systemu. */
  install: () => void;
  /** „Nie teraz" — do następnego wydania. */
  dismiss: () => void;
  /** Ekran systemowy ze zgodą na instalowanie nieznanych aplikacji. */
  openSettings: () => void;
}

export function useUpdateCheck(): UpdateState {
  const [stage, setStage] = useState<UpdateStage>({ kind: 'none' });
  const lastCheckedAt = useRef(0);
  // Instalacja trwa, a sprawdzenie w tle nie ma prawa przestawić jej stanu.
  const busy = useRef(false);

  const check = useCallback(() => {
    // Poza Androidem nie ma jak zainstalować pakietu, więc nie ma też po co
    // pytać o manifest.
    if (Platform.OS !== 'android' || busy.current) return;

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
      if (busy.current) return;

      setStage({ kind: 'available', manifest });
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

  const install = useCallback(() => {
    const manifest = stage.kind === 'available' || stage.kind === 'failed' ? stage.manifest : null;
    if (manifest === null || busy.current) return;

    busy.current = true;
    setStage({
      kind: 'downloading',
      manifest,
      progress: { bytesWritten: 0, totalBytes: manifest.size },
    });

    void (async () => {
      try {
        await installUpdate({
          manifest,
          baseUrl: appConfig.updateBaseUrl,
          installer: expoUpdateInstaller,
          onProgress: (progress) => {
            setStage({ kind: 'downloading', manifest, progress });
          },
        });
        // Okno instalatora przejęło ekran. Zostawiamy stan „pobieranie": jeśli
        // użytkownik instalację potwierdzi, proces i tak zginie, a jeśli ją
        // odrzuci — wróci do widocznego, dokończonego paska i przycisku, który
        // otwiera instalator ponownie.
      } catch (error) {
        setStage({
          kind: 'failed',
          manifest,
          message:
            error instanceof UpdateInstallError
              ? describeInstallFailure(error.reason)
              : 'The update failed. Try again.',
        });
      } finally {
        busy.current = false;
      }
    })();
  }, [stage]);

  const dismiss = useCallback(() => {
    if (stage.kind === 'none') return;
    void rememberDismissedVersion(stage.manifest.versionCode);
    setStage({ kind: 'none' });
  }, [stage]);

  const openSettings = useCallback(() => {
    void expoUpdateInstaller.openUnknownSourcesSettings().catch(() => {
      // Brak takiego ekranu na tej wersji Androida — nie ma tu nic do zrobienia
      // poza niewywaleniem aplikacji.
    });
  }, []);

  return { stage, install, dismiss, openSettings };
}
