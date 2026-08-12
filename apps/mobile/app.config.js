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

const { atsExceptions, cleartextHost } = require('./config/network');
const withCleartextHost = require('./config/with-cleartext-host');

/** Adres API. Domyślny wskazuje na serwer uruchomiony lokalnie. */
const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

/** @type {import('expo/config').ExpoConfig} */
const config = {
  name: 'AlphaPump',
  slug: 'alphapump',
  scheme: 'alphapump',
  version: '0.1.0',
  orientation: 'portrait',
  /** Jeden motyw, ciemny — specyfikacja wymaga dark theme, a przełącznika nie. */
  userInterfaceStyle: 'dark',
  backgroundColor: '#0b0b0f',
  newArchEnabled: true,

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
    versionCode: Number(process.env.ANDROID_VERSION_CODE ?? 1),
    adaptiveIcon: { backgroundColor: '#0b0b0f' },
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
    googleWebClientId: process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? null,
    googleIosClientId: process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID ?? null,
  },
};

module.exports = config;
