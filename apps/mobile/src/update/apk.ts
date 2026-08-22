/**
 * Pakiet natywny pobierany i instalowany **z aplikacji**, bez przeglądarki.
 *
 * Stało tu kiedyś dokładnie to samo i zostało usunięte razem z uprawnieniem
 * `REQUEST_INSTALL_PACKAGES`, gdy wydania ruszające sam JavaScript pojechały
 * przez `expo-updates`: skoro nowy pakiet jest potrzebny parę razy w roku,
 * odesłanie do przeglądarki wydawało się tanie. W praktyce kosztowało wyjście
 * z aplikacji, ekran pobierania systemu, powrót do niego z powiadomienia
 * i szukanie pliku — czyli tę część aktualizacji, której nikt nie robi od razu.
 * Wraca więc, ale wyłącznie na tej jednej drodze; JavaScript dalej jedzie
 * `expo-updates` i o instalatorze nic nie wie.
 *
 * ## Co robi system, a co my
 *
 * My pobieramy plik do katalogu podręcznego i podajemy go instalatorowi jako
 * adres `content://` (`FileProvider` z `expo-file-system`, zarejestrowany przez
 * samą bibliotekę). Wszystko dalej należy do systemu: zgoda na instalowanie
 * z nieznanych źródeł, porównanie podpisu z pakietem już zainstalowanym
 * i sama podmiana. **Podpis jest tu jedynym zabezpieczeniem, jakiego
 * potrzebujemy** — plik z innym kluczem system odrzuci, więc liczenie sumy
 * kontrolnej po naszej stronie niczego by nie dołożyło.
 *
 * ## Czego ten moduł nie robi
 *
 * Nie decyduje. Nie wie, kiedy pytać ani co pokazać — to jest w `use-update.ts`
 * i `ui/update-prompt.tsx`, a reguły postępu w `install.ts`. Tutaj są wyłącznie
 * wywołania Expo, tak samo cienko jak w `expo.ts` i `ota.ts` obok, bo to jedna
 * z warstw, których testy nie obejmują.
 */

import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/**
 * Katalog na pobrany pakiet — **podręczny**, nie dokumenty. Plik jest wart
 * kilkadziesiąt megabajtów i przestaje być do czegokolwiek potrzebny w chwili,
 * w której system go zainstaluje. Niech go sprząta system, gdy zabraknie
 * miejsca, zamiast żeby leżał do końca życia aplikacji.
 */
const RELEASES_DIRECTORY = 'releases';

/**
 * Instalator systemu. Akcja jest w API 29+ oznaczona jako przestarzała na rzecz
 * `PackageInstaller`, ale działa i jest jedyną osiągalną bez kodu natywnego.
 */
const INSTALL_ACTION = 'android.intent.action.INSTALL_PACKAGE';

/** `FLAG_GRANT_READ_URI_PERMISSION` — bez tego instalator nie odczyta pliku. */
const GRANT_READ_URI_PERMISSION = 1;

const APK_MIME_TYPE = 'application/vnd.android.package-archive';

export interface DownloadProgress {
  /** Bajty, które już są na dysku. */
  received: number;
  /** Ile ich będzie razem; `null`, gdy serwer nie podał długości. */
  total: number | null;
}

/**
 * Pobiera pakiet i oddaje ścieżkę do pliku na dysku.
 *
 * Katalog jest czyszczony **przed** pobraniem, a nie po instalacji: instalacja
 * kończy się podmianą aplikacji, czyli momentem, w którym nasz kod już nie
 * chodzi i nie ma jak niczego sprzątnąć. Kasowanie na wejściu robi to samo,
 * tylko w chwili, w której da się to zrobić.
 */
export async function downloadRelease(
  url: string,
  onProgress: (progress: DownloadProgress) => void,
): Promise<string> {
  const directory = new Directory(Paths.cache, RELEASES_DIRECTORY);
  if (directory.exists) {
    for (const entry of directory.list()) entry.delete();
  } else {
    directory.create({ intermediates: true });
  }

  const file = await File.downloadFileAsync(url, directory, {
    idempotent: true,
    onProgress: ({ bytesWritten, totalBytes }) => {
      // `totalBytes` jest `-1`, gdy odpowiedź nie niosła `Content-Length`.
      onProgress({ received: bytesWritten, total: totalBytes < 0 ? null : totalBytes });
    },
  });

  return file.uri;
}

/**
 * Oddaje pobrany plik instalatorowi systemu.
 *
 * Wraca, gdy instalator się otworzy — a nie gdy skończy. Dalej użytkownik
 * rozmawia z systemem, a aplikacja czeka na to, że za chwilę zostanie
 * podmieniona pod sobą.
 */
export async function installRelease(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Installing a package from inside the app is Android-only');
  }

  const contentUri = await getContentUriAsync(fileUri);

  await IntentLauncher.startActivityAsync(INSTALL_ACTION, {
    data: contentUri,
    flags: GRANT_READ_URI_PERMISSION,
    type: APK_MIME_TYPE,
  });
}
