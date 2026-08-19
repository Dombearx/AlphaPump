/**
 * Architektury procesora, które wchodzą do pliku `.apk`.
 *
 * Domyślna budowa React Native pakuje **cztery** komplety bibliotek natywnych —
 * Hermesa, sam RN, SQLite, Reanimated — po jednym na architekturę. Telefon
 * używa dokładnie jednego, reszta jest balastem, którego znajomy i tak nie
 * pobierze świadomie: to różnica między plikiem stumegabajtowym a
 * trzydziestomegabajtowym, a rozdanie idzie po VPN z minipc.
 *
 * `arm64-v8a` samo w sobie pokrywa każdy telefon z Androidem wydany po 2017
 * roku. `armeabi-v7a` dokłada się wyłącznie dla sprzętu starszego i podwaja
 * rozmiar, więc jest wyborem, nie domyślnością.
 *
 * ## Dlaczego lista jest sprawdzana, a nie przepisywana
 *
 * Literówka w nazwie architektury **nie** zatrzymuje budowy. Gradle po prostu
 * nie znajduje pasujących bibliotek i pakuje plik bez nich — a taki `.apk`
 * instaluje się normalnie i wywala się dopiero przy starcie, na urządzeniu,
 * komunikatem o brakującej bibliotece. To jest dokładnie ta klasa awarii, którą
 * `config/network.js` opisuje przy wyjątkach cleartext: konfiguracja wygląda
 * poprawnie, budowa przechodzi, psuje się dopiero telefon. Stąd wyliczenie
 * jest zwykłą funkcją, jest przetestowane i odrzuca nazwę spoza listy.
 *
 * Plik jest zwykłym modułem CommonJS, a nie TypeScriptem, bo czyta go loader
 * konfiguracji Expo — ten transpiluje wyłącznie sam `app.config`, a importy
 * względne ładuje już zwykłym `require`.
 */

/**
 * Architektury, które w ogóle rozumie Android NDK. Lista jest zamknięta —
 * nowa pozycja pojawia się razem z nową wersją NDK, a nie z konfiguracją.
 */
const SUPPORTED_ABIS = ['armeabi-v7a', 'arm64-v8a', 'x86', 'x86_64'];

/**
 * Co pakujemy, gdy nikt nie prosił inaczej. Jedna architektura, bo rozdanie
 * jest wewnątrz grupy znajomych i wiadomo, na czym chodzi.
 */
const DEFAULT_ABIS = ['arm64-v8a'];

/**
 * Zamienia zapis `arm64-v8a,armeabi-v7a` na listę architektur.
 *
 * Pusty napis i brak wartości znaczą to samo, co w `config/env.js`: „nie
 * podano", czyli domyślna lista. Nazwa spoza `SUPPORTED_ABIS` kończy budowę
 * błędem — patrz nagłówek pliku.
 *
 * @param {string | null | undefined} raw
 * @returns {string[]}
 */
function parseAbis(raw) {
  if (raw === null || raw === undefined || raw.trim() === '') return [...DEFAULT_ABIS];

  const requested = raw
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name !== '');

  if (requested.length === 0) return [...DEFAULT_ABIS];

  const unknown = requested.filter((name) => !SUPPORTED_ABIS.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Nieznana architektura: ${unknown.join(', ')}. ` +
        `Dozwolone: ${SUPPORTED_ABIS.join(', ')}. ` +
        'Plik .apk zbudowany z literówką instaluje się i wywala dopiero przy starcie.',
    );
  }

  // Duplikaty są nieszkodliwe dla gradle'a, ale w `gradle.properties` wyglądają
  // jak pomyłka — a ten plik bywa czytany przy diagnozie rozmiaru wydania.
  return [...new Set(requested)];
}

module.exports = { parseAbis, SUPPORTED_ABIS, DEFAULT_ABIS };
