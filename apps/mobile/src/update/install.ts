/**
 * Pobranie i instalacja wydania — przebieg, bez dotykania Expo.
 *
 * Instalacja pakietu na Androidzie to trzy kroki, z których każdy potrafi się
 * nie udać inaczej: pobranie pliku, sprawdzenie, czy doszedł w całości, i
 * oddanie go instalatorowi systemu. Kolejność i obsługa błędów są tutaj, a
 * kontakt z systemem — za portem `UpdateInstaller`, którego jedyna prawdziwa
 * implementacja siedzi w `expo.ts`. Dzięki temu przebieg jest testowany
 * w Node, bez emulatora.
 *
 * ## Dlaczego `content://`, a nie `file://`
 *
 * Instalator jest osobną aplikacją i nie ma dostępu do katalogów naszej.
 * Podanie mu `file://` kończy się `FileUriExposedException` od Androida 7 —
 * plik trzeba udostępnić przez `FileProvider`. `expo-file-system` deklaruje
 * własny (`${applicationId}.FileSystemFileProvider`, patrz manifest paczki)
 * obejmujący katalog podręczny, więc wystarczy odczytać `File.contentUri`.
 */

import { apkUrl, type UpdateManifest } from './manifest';

export interface DownloadProgress {
  bytesWritten: number;
  /** `-1`, gdy serwer nie podał `Content-Length`. */
  totalBytes: number;
}

export interface DownloadedApk {
  /**
   * Adres `content://` pliku, gotowy do oddania instalatorowi. `null` poza
   * Androidem — `contentUri` jest właściwością wyłącznie androidową.
   */
  contentUri: string | null;
  /** Suma MD5 policzona natywnie; `null`, gdy pliku nie dało się odczytać. */
  md5: string | null;
}

/** Kontakt z systemem — wszystko, czego przebieg niżej nie umie sam. */
export interface UpdateInstaller {
  download(
    url: string,
    options: { onProgress?: (progress: DownloadProgress) => void; signal?: AbortSignal },
  ): Promise<DownloadedApk>;
  /** Oddaje plik instalatorowi systemu. Wraca, gdy okno instalatora się otworzy. */
  install(contentUri: string): Promise<void>;
  /** Ekran „instalowanie nieznanych aplikacji" dla naszego pakietu. */
  openUnknownSourcesSettings(): Promise<void>;
}

export type UpdateInstallFailure =
  /** Plik nie doszedł: brak trasy do minipc, przerwane pobieranie, błąd serwera. */
  | 'download'
  /** Doszedł, ale nie ten albo nie w całości. */
  | 'checksum'
  /** Instalator nie przyjął pliku — zwykle brak zgody na nieznane źródła. */
  | 'install'
  /** Platforma nie umie instalować pakietów w ten sposób (iOS). */
  | 'unsupported';

export class UpdateInstallError extends Error {
  constructor(
    readonly reason: UpdateInstallFailure,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'UpdateInstallError';
    this.cause = cause;
  }
}

export interface InstallUpdateOptions {
  manifest: UpdateManifest;
  /** Katalog wydań — `appConfig.updateBaseUrl`. */
  baseUrl: string;
  installer: UpdateInstaller;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

export async function installUpdate(options: InstallUpdateOptions): Promise<void> {
  const { manifest, installer } = options;

  let downloaded: DownloadedApk;
  try {
    downloaded = await installer.download(apkUrl(options.baseUrl, manifest), {
      onProgress: options.onProgress,
      signal: options.signal,
    });
  } catch (error) {
    throw new UpdateInstallError('download', 'Could not download the release', error);
  }

  // Sprawdzenie jest **przed** oddaniem pliku instalatorowi, a nie po: pakiet
  // ucięty w połowie system i tak odrzuci, ale zrobi to komunikatem o błędzie
  // parsowania, po którym nie widać, że problem był w pobieraniu.
  if (downloaded.md5 !== null && downloaded.md5.toLowerCase() !== manifest.md5.toLowerCase()) {
    throw new UpdateInstallError(
      'checksum',
      'The downloaded file does not match the release manifest',
    );
  }

  if (downloaded.contentUri === null) {
    throw new UpdateInstallError('unsupported', 'Installing packages is Android-only');
  }

  try {
    await installer.install(downloaded.contentUri);
  } catch (error) {
    throw new UpdateInstallError('install', 'The system installer refused the package', error);
  }
}

/**
 * Komunikat dla użytkownika. Trzyma się reguły z reszty aplikacji: mówi, co
 * się stało i co z tym zrobić, a nie jak nazywa się wyjątek.
 */
export function describeInstallFailure(reason: UpdateInstallFailure): string {
  switch (reason) {
    case 'download':
      return 'Could not download the file. Check that your phone is connected to the VPN.';
    case 'checksum':
      return 'The download came through incomplete. Try again.';
    case 'install':
      return 'Your phone did not open the installer. Allow AlphaPump to install unknown apps.';
    case 'unsupported':
      return 'Updating this way only works on Android.';
  }
}
