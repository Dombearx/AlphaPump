/**
 * Oddanie pobranego `.pbw` aplikacji Pebble.
 *
 * Instalacja na zegarku wygląda z naszej strony dokładnie tak, jak instalacja
 * pakietu na telefonie (`src/update/apk.ts`): pobieramy plik do katalogu
 * podręcznego i podajemy go dalej jako adres `content://`. Różni się to, komu
 * go podajemy — tam instalatorowi systemu, tu aplikacji Pebble, która zajmuje
 * się resztą: przerzuceniem pliku na zegarek przez Bluetooth i podmianą
 * aplikacji, jeśli już tam była.
 *
 * ## Dlaczego kilka prób, a nie jedna
 *
 * Bo dopasowanie pliku `.pbw` do aplikacji Pebble jest na Androidzie kruche
 * i nie z naszej winy: nowsze wydania systemu zawężały reguły, po których
 * `ACTION_VIEW` trafia w aplikację, a `.pbw` nie ma zarejestrowanego typu MIME.
 * Stąd u Rebble osobna aplikacja *Sideload Helper*, której jedynym zadaniem jest
 * podanie tego pliku dalej. Próbujemy więc typu ogólnego i braku typu, zanim
 * powiemy „nie udało się" — a gdy nie uda się nic, komunikat wskazuje na
 * Sideload Helper zamiast zostawiać użytkownika z niczym.
 *
 * Pobieranie jest wspólne z pakietem telefonu i tam mieszka: `downloadRelease`
 * nie wie, co pobiera, i nie musi.
 */

import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import { Platform } from 'react-native';

/** `FLAG_GRANT_READ_URI_PERMISSION` — bez tego odbiorca nie odczyta pliku. */
const GRANT_READ_URI_PERMISSION = 1;

/**
 * Typy MIME w kolejności prób. `undefined` znaczy „nie mów, co to jest" —
 * i bywa jedynym wariantem, który trafia, bo wtedy system dopasowuje po
 * rozszerzeniu.
 */
const HANDOFF_TYPES: (string | undefined)[] = ['application/octet-stream', undefined];

export class NoPebbleAppError extends Error {
  constructor() {
    super(
      'No app on this phone opens .pbw files. Install the Pebble app, or Rebble Sideload Helper.',
    );
    this.name = 'NoPebbleAppError';
  }
}

/**
 * Podaje pobrany plik aplikacji Pebble.
 *
 * Wraca, gdy tamta się otworzy — a nie gdy zegarek dostanie aplikację. Dalej
 * użytkownik rozmawia z aplikacją Pebble, tak samo jak przy pakiecie telefonu
 * rozmawia z instalatorem systemu.
 */
export async function installWatchApp(fileUri: string): Promise<void> {
  if (Platform.OS !== 'android') {
    throw new Error('Handing the watch app over from inside the app is Android-only');
  }

  const contentUri = await getContentUriAsync(fileUri);

  for (const type of HANDOFF_TYPES) {
    try {
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: GRANT_READ_URI_PERMISSION,
        ...(type === undefined ? {} : { type }),
      });
      return;
    } catch {
      // Następny wariant. Ostatni nieudany kończy się komunikatem niżej —
      // konkretnym, bo „nie udało się otworzyć" nie prowadzi donikąd.
    }
  }

  throw new NoPebbleAppError();
}
