/**
 * Strona natywna aktualizacji: pobranie pliku, instalator systemu, pamięć
 * odłożonych wersji.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — przebieg instalacji
 * (`install.ts`) i porównywanie wersji (`manifest.ts`) są czyste i przetestowane
 * w Node. Ten plik jest cienki celowo: to jedyna warstwa, której testy nie
 * obejmują, więc ma nie zawierać decyzji.
 */

import * as Application from 'expo-application';
import { Directory, File, Paths } from 'expo-file-system';
import * as IntentLauncher from 'expo-intent-launcher';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { DownloadedApk, UpdateInstaller } from './install';
import { parseInstalledVersionCode } from './manifest';

/** MIME pakietu Androida — bez niego instalator nie podejmie się pliku. */
const APK_MIME = 'application/vnd.android.package-archive';

/**
 * `Intent.FLAG_GRANT_READ_URI_PERMISSION`. Instalator jest osobną aplikacją
 * i bez tej flagi nie odczyta naszego `content://`, mimo że dostał adres.
 */
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/** Wydania lądują w pamięci podręcznej: po instalacji plik jest do wyrzucenia. */
const DOWNLOAD_DIRECTORY = 'updates';

/** Numer zainstalowanego wydania — `versionCode` z manifestu pakietu. */
export function installedVersionCode(): number | null {
  return parseInstalledVersionCode(Application.nativeBuildVersion);
}

/** Wersja dla człowieka — pokazywana obok numeru nowego wydania. */
export function installedVersionName(): string | null {
  return Application.nativeApplicationVersion;
}

export const expoUpdateInstaller: UpdateInstaller = {
  async download(url, options): Promise<DownloadedApk> {
    if (Platform.OS !== 'android') return { contentUri: null, md5: null };

    const directory = new Directory(Paths.cache, DOWNLOAD_DIRECTORY);
    if (!directory.exists) directory.create({ intermediates: true });

    // Poprzednie wydanie zajmuje kilkadziesiąt megabajtów i nie jest już do
    // niczego potrzebne. Kasujemy **przed** pobraniem, a nie po instalacji:
    // po instalacji nasz proces zwykle już nie żyje.
    for (const entry of directory.list()) {
      if (entry instanceof File) entry.delete();
    }

    const file = await File.downloadFileAsync(url, directory, {
      idempotent: true,
      onProgress: options.onProgress,
      signal: options.signal,
    });

    return { contentUri: file.contentUri, md5: file.md5 };
  },

  async install(contentUri) {
    await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
      data: contentUri,
      type: APK_MIME,
      flags: FLAG_GRANT_READ_URI_PERMISSION,
    });
  },

  async openUnknownSourcesSettings() {
    // Ekran systemowy dotyczy **konkretnej** aplikacji, stąd `package:` w danych.
    // Bez tego Android otwiera listę wszystkich aplikacji i użytkownik musi
    // znaleźć naszą sam.
    await IntentLauncher.startActivityAsync(
      IntentLauncher.ActivityAction.MANAGE_UNKNOWN_APP_SOURCES,
      { data: `package:${Application.applicationId ?? ''}` },
    );
  },
};

/* ------------------------------------------------------- odłożone aktualizacje */

/**
 * „Nie teraz" ma znaczyć „nie teraz i nie przy następnym otwarciu" — ale
 * wyłącznie dla **tej** wersji. Kolejne wydanie pyta od nowa.
 *
 * Trzymamy to w `expo-secure-store`, mimo że numer wersji nie jest sekretem.
 * Powód jest prozaiczny: to jedyny magazyn klucz-wartość, który aplikacja już
 * ma. Alternatywy to nowa zależność albo tabela w bazie lokalnej, czyli
 * migracja w `packages/db` schodząca aż na serwer — obie nieproporcjonalne do
 * jednej liczby.
 */
const DISMISSED_KEY = 'alphapump.update.dismissed';

export async function dismissedVersionCode(): Promise<number | null> {
  try {
    return parseInstalledVersionCode(await SecureStore.getItemAsync(DISMISSED_KEY));
  } catch {
    // Odczyt z magazynu nie może zablokować sprawdzenia aktualizacji —
    // najgorsze, co się stanie, to pytanie o wersję już raz odłożoną.
    return null;
  }
}

export async function rememberDismissedVersion(versionCode: number): Promise<void> {
  try {
    await SecureStore.setItemAsync(DISMISSED_KEY, String(versionCode));
  } catch {
    // Jak wyżej: nieudany zapis znaczy tylko tyle, że zapytamy ponownie.
  }
}
