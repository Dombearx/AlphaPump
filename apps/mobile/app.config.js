/**
 * Konfiguracja Expo.
 *
 * Adres API wchodzi ze zmiennej środowiskowej, bo różni się między maszyną
 * dewelopera a minipc w VPN — a od niego zależą dwie rzeczy, o których łatwo
 * zapomnieć na rok: wyjątek ATS po stronie iOS i `networkSecurityConfig` po
 * stronie Androida. Oba są tu wyliczane z tego samego adresu, więc nie ma jak
 * ustawić jednego i przeoczyć drugiego.
 *
 * Konfiguracja iOS powstaje **razem z androidową**, mimo że pierwsze wydanie
 * idzie na Androida. To jeden z trzech kosztów utrzymania otwartych drzwi do
 * iOS opisanych w dokumencie stacku — i jedyny, który inaczej zostałby
 * zapomniany na rok.
 *
 * Plik jest w JavaScripcie, a nie w TypeScripcie, świadomie: loader Expo
 * transpiluje sam `app.config`, ale jego importy względne ładuje zwykłym
 * `require`, więc `app.config.ts` nie mógłby sięgnąć po nic z `src/`.
 */

const { envValue } = require('./config/env');
const { atsExceptions, cleartextHost } = require('./config/network');
const withCleartextHost = require('./config/with-cleartext-host');

/** Adres API. Domyślny wskazuje na serwer uruchomiony lokalnie. */
const API_URL = envValue('EXPO_PUBLIC_API_URL') ?? 'http://localhost:3000';

/**
 * Katalog z wydaniami — stamtąd aplikacja bierze `latest.json` i plik `.apk`.
 * Domyślnie ten sam host co API, bo Caddy oddaje `/alphapump/download` z woluminu obok
 * niego (`deploy/docker-compose.yml`). Zmienna istnieje na wypadek, gdyby
 * wydania kiedyś pojechały gdzie indziej niż API.
 */
const UPDATE_BASE_URL =
  envValue('EXPO_PUBLIC_UPDATE_BASE_URL') ?? `${API_URL.replace(/\/+$/, '')}/alphapump/download`;

/**
 * Wersja dla człowieka — ta, którą widać w oknie „jest nowa wersja" i w
 * ustawieniach systemu. Przy wydaniu z tagu podstawia ją
 * `android-release.yml`; poza nim bierze się z `package.json`, żeby ten sam
 * numer trafił do aplikacji i do `latest.json` opisującego wydanie. Wpisany tu
 * na sztywno byłby drugim źródłem prawdy dla jednej liczby.
 *
 * Wydania rozróżnia i tak `versionCode` niżej — `versionName` jest etykietą.
 */
const VERSION_NAME = envValue('APP_VERSION_NAME') ?? require('./package.json').version;

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'AlphaPump',
  slug: 'alphapump',
  scheme: 'alphapump',
  version: VERSION_NAME,
  orientation: 'portrait',
  /** Jeden motyw, ciemny — specyfikacja wymaga dark theme, a przełącznika nie. */
  userInterfaceStyle: 'dark',
  backgroundColor: '#232327',
  newArchEnabled: true,
  icon: './assets/icon.png',

  ios: {
    bundleIdentifier: 'app.alphapump.mobile',
    supportsTablet: false,
    infoPlist: {
      NSAppTransportSecurity: atsExceptions(API_URL),
    },
  },

  android: {
    package: 'app.alphapump.mobile',
    /**
     * Numer wydania widziany przez system. Android odmawia instalacji pakietu
     * o **niższym** numerze niż zainstalowany, więc każde kolejne wydanie musi
     * mieć wyższy — inaczej aktualizacja przez pobranie pliku z minipc kończy
     * się komunikatem o niezgodności, a nie podmianą aplikacji.
     *
     * Wartość wchodzi ze środowiska, bo jej źródłem jest wydanie, a nie kod:
     * `.github/workflows/android-release.yml` podstawia numer przebiegu.
     * Domyślna jedynka wystarcza przy budowaniu na własnej maszynie.
     */
    versionCode: Number(envValue('ANDROID_VERSION_CODE') ?? 1),
    adaptiveIcon: { backgroundColor: '#232327', foregroundImage: './assets/icon.png' },
    /**
     * Aplikacja sama podmienia się na nowszą: pobiera `.apk` z minipc i oddaje
     * go instalatorowi systemu. Bez tego uprawnienia instalator odrzuca zamiar,
     * zanim w ogóle pokaże okno.
     *
     * Uprawnienie **nie** daje cichej instalacji — Android i tak pyta
     * użytkownika o zgodę dla naszego pakietu (raz, w „instalowanie nieznanych
     * aplikacji"), a potem o samą podmianę przy każdym wydaniu. Zasady Google
     * Play mocno je ograniczają, ale ta aplikacja nie idzie przez Play i iść
     * nie ma; rozdanie jest wewnątrz VPN-u.
     */
    permissions: ['android.permission.REQUEST_INSTALL_PACKAGES'],
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    '@react-native-google-signin/google-signin',
    [withCleartextHost, { host: cleartextHost(API_URL) }],
  ],

  experiments: {
    typedRoutes: true,
  },

  extra: {
    apiUrl: API_URL,
    updateBaseUrl: UPDATE_BASE_URL,
    googleWebClientId: envValue('EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID'),
    googleIosClientId: envValue('EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID'),
    /**
     * Logowanie i rejestracja przez Google — domyślnie wyłączone, tak jak
     * `GOOGLE_SIGN_IN_ENABLED` po stronie serwera. Obie strony trzeba włączyć
     * razem: przycisk bez zgody serwera zawsze kończy się błędem.
     */
    googleSignInEnabled: envValue('EXPO_PUBLIC_GOOGLE_SIGN_IN_ENABLED') ?? 'false',
  },
};

module.exports = config;
