/**
 * Strona natywna tapety: wybór zdjęcia, kopia w katalogu aplikacji i rejestr
 * na dysku.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — reguły są w `state.ts`,
 * a ekran w `../ui/background.tsx`. Ten plik jest cienki celowo: to jedyna
 * warstwa, której testy nie obejmują, więc ma nie zawierać decyzji.
 *
 * ## Dlaczego wybór pliku, a nie galeria
 *
 * `expo-image-picker` byłby wygodniejszy, ale jest modułem natywnym: doszedłby
 * do paczki dopiero z nowym `.apk`, więc tapeta nie dojechałaby wydaniem OTA do
 * nikogo, kto ma już aplikację na telefonie. `expo-document-picker` jest
 * w projekcie od importu FitNotesa i wystarcza — lista jest zawężona do JPG
 * i PNG, więc użytkownik i tak widzi swoje zdjęcia.
 *
 * ## Dlaczego kopia, a nie adres wybranego pliku
 *
 * Android oddaje wybrany plik jako `content://`, a to jest adres jednorazowy:
 * uprawnienie do niego wygasa razem z procesem, więc po restarcie aplikacji
 * tapeta byłaby pustym prostokątem. Kopia w katalogu dokumentów należy do nas
 * i przeżywa tyle, ile aplikacja.
 */

import * as DocumentPicker from 'expo-document-picker';
import { Directory, File, Paths } from 'expo-file-system';
import {
  BACKGROUND_MIME_TYPES,
  EMPTY_BACKGROUND_STATE,
  parseBackgroundState,
  serializeBackgroundState,
  withDefaultBackground,
  withPickedBackground,
  type BackgroundState,
  type BackgroundStore,
} from './state';

/** Katalog na kopię tapety — w dokumentach, bo pamięć podręczną system czyści. */
const WALLPAPER_DIRECTORY = 'background';

const REGISTRY_FILE = 'background.json';

function wallpaperDirectory(): Directory {
  const directory = new Directory(Paths.document, WALLPAPER_DIRECTORY);
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

async function readState(): Promise<BackgroundState> {
  const file = new File(Paths.document, REGISTRY_FILE);
  if (!file.exists) return EMPTY_BACKGROUND_STATE;
  return parseBackgroundState(await file.text());
}

function writeState(state: BackgroundState): void {
  const file = new File(Paths.document, REGISTRY_FILE);
  if (!file.exists) file.create();
  file.write(serializeBackgroundState(state));
}

/**
 * Adres tapety. Istnienie pliku sprawdzamy za każdym razem, bo rejestr i dysk
 * mogą się rozjechać — czyszczenie danych aplikacji zabiera zdjęcie, a wpis
 * w rejestrze zostaje. Wtedy lepsze jest tło domyślne niż czarna dziura.
 */
function uriOf(state: BackgroundState): string | null {
  if (state.file === null) return null;
  const file = new File(wallpaperDirectory(), state.file);
  return file.exists ? file.uri : null;
}

export const expoBackgroundStore: BackgroundStore = {
  read: async () => uriOf(await readState()),

  pick: async () => {
    const picked = await DocumentPicker.getDocumentAsync({
      type: [...BACKGROUND_MIME_TYPES],
      copyToCacheDirectory: true,
    });
    if (picked.canceled) return null;

    const asset = picked.assets[0];
    if (!asset) return null;

    // Rzuca na pliku, którego reguły nie przepuściły — **przed** skasowaniem
    // poprzedniej tapety, żeby odmowa nie zostawiała użytkownika bez niczego.
    const state = withPickedBackground(await readState(), asset);

    const directory = wallpaperDirectory();
    for (const entry of directory.list()) entry.delete();

    const target = new File(directory, state.file);
    await new File(asset.uri).copy(target);
    writeState(state);

    return target.uri;
  },

  clear: async () => {
    writeState(withDefaultBackground(await readState()));
    for (const entry of wallpaperDirectory().list()) entry.delete();
  },
};
