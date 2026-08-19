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

const { parseAbis } = require('./config/abis');
const { envValue } = require('./config/env');
const { atsExceptions, cleartextHost } = require('./config/network');
const { GRADLE_JVM_ARGS } = require('./config/gradle-memory');
const withCleartextHost = require('./config/with-cleartext-host');
const withGradleProperties = require('./config/with-gradle-properties');

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
 * Manifest aktualizacji OTA — trasa API, nie plik statyczny (odpowiedź zależy
 * od nagłówków żądania i jest `multipart/mixed`). Stąd aplikacja bierze paczkę
 * JavaScriptu, gdy wydanie nie ruszyło warstwy natywnej: kilka megabajtów
 * zamiast całego pliku `.apk`.
 */
const UPDATE_MANIFEST_URL = `${API_URL.replace(/\/+$/, '')}/updates/manifest`;

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

/**
 * Architektury procesora pakowane do pliku `.apk`. Domyślnie samo `arm64-v8a`,
 * czyli każdy telefon z Androidem wydany po 2017 roku — komplet czterech
 * architektur to trzykrotnie większy plik do pobrania przy pierwszej instalacji.
 * Starszy sprzęt w grupie: `ANDROID_ABIS=arm64-v8a,armeabi-v7a`.
 */
const ANDROID_ABIS = parseAbis(envValue('ANDROID_ABIS'));

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
     * Aplikacja nie prosi o żadne uprawnienie ponad te, które Expo dokłada samo.
     *
     * Stało tu `android.permission.REQUEST_INSTALL_PACKAGES` — aplikacja
     * pobierała `.apk` i oddawała go instalatorowi systemu. Odkąd wydania
     * ruszające sam JavaScript jadą przez `expo-updates`, instalator jest
     * potrzebny wyłącznie przy zmianie warstwy natywnej, czyli parę razy w roku
     * — a wtedy plik pobiera się przeglądarką z `/alphapump/download`, jak przy
     * pierwszej instalacji. Najgroźniejsze uprawnienie w tej aplikacji zniknęło
     * więc razem z kodem, który był jedynym jego użytkownikiem.
     */
  },

  /**
   * Odcisk warstwy natywnej. Paczka JavaScriptu zostaje zaproponowana wyłącznie
   * telefonowi o **tym samym** odcisku — uruchomiona na innym wywala aplikację
   * przy starcie, i to jest dokładnie ta awaria, po której nie da się już nic
   * naprawić zdalnie.
   *
   * Polityka `fingerprint`, a nie numer wpisany ręcznie, bo ta wartość musi być
   * **wyprowadzona**, a nie zapamiętana: wersja podbijana ręcznie rozjeżdża się
   * z rzeczywistością przy pierwszym przeoczeniu, a przeoczenie widać dopiero
   * na czyimś telefonie. Tym samym odciskiem `android-release.yml` rozstrzyga,
   * czy wydanie potrzebuje nowego `.apk`, czy wystarczy paczka.
   */
  runtimeVersion: { policy: 'fingerprint' },

  updates: {
    url: UPDATE_MANIFEST_URL,
    /**
     * Zero, czyli **nie czekaj**. Aplikacja startuje natychmiast z paczką, którą
     * już ma, a nowszą pobiera w tle i uruchamia przy następnym wejściu (albo
     * na życzenie, przyciskiem w oknie aktualizacji). Odwrotne ustawienie
     * kazałoby czekać na sieć przy każdym starcie — a minipc bywa poza zasięgiem
     * częściej, niż jest w nim. To ta sama zasada, na której stoi baza lokalna:
     * ekran nigdy nie czeka na sieć.
     */
    fallbackToCacheTimeout: 0,
    checkAutomatically: 'ON_LOAD',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    'expo-sqlite',
    '@react-native-google-signin/google-signin',
    [withCleartextHost, { host: cleartextHost(API_URL) }],
    [
      withGradleProperties,
      {
        properties: {
          reactNativeArchitectures: ANDROID_ABIS.join(','),
          'org.gradle.jvmargs': GRADLE_JVM_ARGS,
        },
      },
    ],
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
