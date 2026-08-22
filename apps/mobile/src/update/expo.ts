/**
 * Strona natywna wydań **natywnych**: numer zainstalowanego pakietu, otwarcie
 * katalogu wydań i pamięć odłożonych wersji.
 *
 * Wszystko, co dotyka Expo, jest **tutaj i tylko tutaj** — porównywanie wersji
 * (`manifest.ts`) jest czyste i przetestowane w Node. Ten plik jest cienki
 * celowo: to jedna z dwóch warstw, których testy nie obejmują, więc ma nie
 * zawierać decyzji.
 *
 * ## Czego tu już nie ma
 *
 * Stało tu pobieranie `.apk`, sprawdzanie sumy MD5 i oddawanie pliku
 * instalatorowi systemu przez `expo-intent-launcher` — razem z uprawnieniem
 * `REQUEST_INSTALL_PACKAGES` i ekranem „instalowanie nieznanych aplikacji".
 * Cała ta maszyneria obsługiwała **każde** wydanie, bo każde wydanie było
 * nowym pakietem. Odkąd wydania ruszające sam JavaScript jadą przez
 * `expo-updates` (`ota.ts`), nowy pakiet jest potrzebny parę razy w roku — a na
 * to wystarczy odesłanie do przeglądarki, tak jak przy pierwszej instalacji.
 */

import * as Application from 'expo-application';
import * as Linking from 'expo-linking';
import * as SecureStore from 'expo-secure-store';
import { parseInstalledVersionCode } from './manifest';

/** Numer zainstalowanego wydania — `versionCode` z manifestu pakietu. */
export function installedVersionCode(): number | null {
  return parseInstalledVersionCode(Application.nativeBuildVersion);
}

/** Wersja dla człowieka — pokazywana obok numeru nowego wydania. */
export function installedVersionName(): string | null {
  return Application.nativeApplicationVersion;
}

/**
 * Otwiera plik wydania w przeglądarce.
 *
 * Dalej prowadzi już system: pobranie, pytanie o zgodę na instalowanie
 * z nieznanych źródeł i sam instalator. Aplikacja nie bierze w tym udziału i
 * nie ma po temu żadnego uprawnienia — świadomie, bo za tę cenę znika
 * najgroźniejsze uprawnienie, jakie miała.
 */
export async function openRelease(url: string): Promise<void> {
  await Linking.openURL(url);
}

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

/* ------------------------------------------------------- restart dla paczki */

/**
 * Paczka, dla której użytkownik już raz kliknął „uruchom ponownie".
 *
 * Przeżywa restart, bo dokładnie o restart tu chodzi: paczka, która nie wstaje,
 * zostaje przez `expo-updates` odznaczona jako nieudana i nigdy więcej nie jest
 * uruchamiana, ale dalej leży na dysku jako „pobrana i gotowa". Bez tej notatki
 * okno wracałoby po każdym otwarciu aplikacji, prosząc o czynność, o której
 * z góry wiadomo, że nic nie zmieni. Decyzję podejmuje `pending.ts`.
 *
 * Ten sam magazyn co odłożone wydania wyżej i z tego samego powodu: to jedyny
 * magazyn klucz-wartość, który aplikacja już ma.
 */
const RESTARTED_FOR_KEY = 'alphapump.update.restartedFor';

export async function restartedForUpdateId(): Promise<string | null> {
  try {
    const stored = await SecureStore.getItemAsync(RESTARTED_FOR_KEY);
    return stored === null || stored === '' ? null : stored;
  } catch {
    // Nieudany odczyt znaczy najwyżej jedno okno za dużo — nigdy za mało.
    return null;
  }
}

export async function rememberRestartedForUpdate(updateId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(RESTARTED_FOR_KEY, updateId);
  } catch {
    // Jak wyżej.
  }
}

export async function forgetRestartedForUpdate(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(RESTARTED_FOR_KEY);
  } catch {
    // Jak wyżej.
  }
}
