/**
 * Protokół aktualizacji Expo — składanie odpowiedzi, bez dotykania dysku.
 *
 * Telefon pyta o manifest przy starcie, podając w nagłówkach swoją platformę
 * i `runtimeVersion` — czyli odcisk warstwy natywnej, którą ma zainstalowaną.
 * Serwer odpowiada opisem paczki JavaScriptu pasującej **do tej właśnie**
 * warstwy. To jest cały mechanizm, dzięki któremu poprawka w kodzie jedzie do
 * telefonów jako dwa megabajty zamiast całego pliku `.apk`.
 *
 * ## Dlaczego to nie może być plik statyczny
 *
 * Kuszące jest położenie manifestu obok paczki i oddanie go `file_server`-em
 * Caddy'ego, tak jak `latest.json` przy wydaniach na Androida. Nie da się:
 * odpowiedź protokołu jest `multipart/mixed` z częściami `manifest`
 * i `extensions`, wybór wydania zależy od **nagłówków** żądania, a brak
 * aktualizacji jest osobną dyrektywą, a nie kodem 404. Stąd kod, a nie
 * konfiguracja.
 *
 * ## Dlaczego adresy zasobów powstają tutaj, a nie przy wgrywaniu
 *
 * Zapisany opis wydania trzyma **ścieżki względne**, a pełne adresy dokleja się
 * dopiero z adresu, pod którym przyszło żądanie. To ta sama decyzja, co
 * w manifeście wydań na Androida (`apps/mobile/src/update/manifest.ts`): opis
 * mówi, co jest w katalogu, a nie pod jakim adresem stoi minipc. Ten sam plik
 * działa więc pod każdym adresem, pod którym minipc widać w VPN — a widać go
 * pod kilkoma naraz, bo NetBird daje własną nazwę obok adresu w LAN.
 *
 * @see https://docs.expo.dev/technical-specs/expo-updates-1/
 */

import { randomUUID } from 'node:crypto';

/** Wersja protokołu, którą rozumie ten serwer. */
export const SUPPORTED_PROTOCOL_VERSIONS = [0, 1] as const;

/**
 * Wersja formatu nagłówków ustrukturyzowanych (RFC 8941), której używa klient.
 * Stała — protokół nie zna innej wartości, a nagłówek musi być obecny.
 */
const SFV_VERSION = '0';

export type UpdatePlatform = 'android' | 'ios';

/** Opis jednego pliku wchodzącego do wydania, tak jak leży na dysku. */
export interface StoredAsset {
  /** Identyfikator pliku po stronie telefonu — MD5 treści, szesnastkowo. */
  key: string;
  /** Typ MIME; dla paczki JavaScriptu zawsze `application/javascript`. */
  contentType: string;
  /** SHA-256 treści w base64url — tym telefon sprawdza, czy plik doszedł cały. */
  hash: string;
  /** Ścieżka względem katalogu wydań, np. `assets/3f2a…`. */
  path: string;
  /**
   * Rozszerzenie pliku, np. `.png`. Paczka JavaScriptu go nie niesie — telefon
   * trzyma ją pod samym kluczem — ale każdy inny zasób musi: Android czyta je
   * przez `getString`, więc brak kończy się **cichym** wyrzuceniem zasobu
   * z wydania, a iOS odrzuca wtedy cały manifest.
   */
  fileExtension?: string;
}

/**
 * Wydanie zapisane na minipc. Powstaje przy wgrywaniu
 * (`deploy/update_server.py`), a nie przy każdym pytaniu telefonu: policzenie
 * hashy wszystkich plików to sekundy, a pytań jest tyle, ile otwarć aplikacji.
 */
export interface StoredUpdate {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  platform: UpdatePlatform;
  launchAsset: StoredAsset;
  assets: StoredAsset[];
  metadata?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/** Zasób w manifeście — to samo co `StoredAsset`, tylko z pełnym adresem. */
interface ManifestAsset {
  key: string;
  contentType: string;
  hash: string;
  url: string;
  fileExtension?: string;
}

export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ManifestAsset;
  assets: ManifestAsset[];
  metadata: Record<string, unknown>;
  extra: Record<string, unknown>;
}

/**
 * Nagłówki żądania, które w ogóle wpływają na odpowiedź.
 *
 * `currentUpdateId` jest tu świadomie **nieużywany** przy wyborze wydania:
 * protokół pozwala oddać manifest, który telefon już ma, a klient sam
 * rozpoznaje po `id`, że nie ma czego pobierać. Zgadywanie tego po stronie
 * serwera dokładałoby stan („co ten telefon ma") do czegoś, co jest bezstanowe.
 */
export interface UpdateRequest {
  platform: string | undefined;
  runtimeVersion: string | undefined;
  protocolVersion: number;
}

export class UpdateRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UpdateRequestError';
  }
}

/**
 * Odczytuje nagłówki żądania.
 *
 * Brak `expo-protocol-version` znaczy wersję 0 — tak zachowywały się klienty
 * sprzed wprowadzenia dyrektyw i tak każe je traktować specyfikacja.
 */
export function readUpdateRequest(header: (name: string) => string | undefined): UpdateRequest {
  const rawProtocol = header('expo-protocol-version');
  const protocolVersion = rawProtocol === undefined ? 0 : Number.parseInt(rawProtocol, 10);

  if (!Number.isInteger(protocolVersion) || !isSupportedProtocol(protocolVersion)) {
    throw new UpdateRequestError(
      `Nieobsługiwana wersja protokołu aktualizacji: ${rawProtocol ?? '(brak)'}`,
    );
  }

  return {
    platform: header('expo-platform'),
    runtimeVersion: header('expo-runtime-version'),
    protocolVersion,
  };
}

function isSupportedProtocol(version: number): boolean {
  return (SUPPORTED_PROTOCOL_VERSIONS as readonly number[]).includes(version);
}

export function isUpdatePlatform(value: string | undefined): value is UpdatePlatform {
  return value === 'android' || value === 'ios';
}

/**
 * Zapisane wydanie plus adres serwera → manifest gotowy do wysłania.
 *
 * `baseUrl` jest katalogiem, spod którego Caddy oddaje pliki wydania — adres
 * powstaje z żądania, patrz nagłówek pliku.
 */
export function toManifest(update: StoredUpdate, baseUrl: string): ExpoManifest {
  const root = baseUrl.replace(/\/+$/, '');
  const withUrl = (asset: StoredAsset): ManifestAsset => ({
    key: asset.key,
    contentType: asset.contentType,
    hash: asset.hash,
    ...(asset.fileExtension === undefined ? {} : { fileExtension: asset.fileExtension }),
    // Ścieżka jest już bezpieczna (powstała przy wgrywaniu), ale segmenty
    // kodujemy, bo nazwa pliku bywa hashem base64url — a ten zawiera `-` i `_`,
    // nieszkodliwe, oraz nic, co wymagałoby ucieczki. Kodowanie jest tu więc
    // zabezpieczeniem na wypadek zmiany schematu nazw, nie bieżącą potrzebą.
    url: `${root}/${asset.path.split('/').map(encodeURIComponent).join('/')}`,
  });

  return {
    id: update.id,
    createdAt: update.createdAt,
    runtimeVersion: update.runtimeVersion,
    launchAsset: withUrl(update.launchAsset),
    assets: update.assets.map(withUrl),
    metadata: update.metadata ?? {},
    extra: update.extra ?? {},
  };
}

/* --------------------------------------------------------------- multipart */

/** Jedna część odpowiedzi `multipart/mixed`. */
interface Part {
  name: string;
  body: string;
}

/**
 * Składa ciało `multipart/mixed`.
 *
 * Końce linii są **CRLF**, bo tego wymaga RFC 2046 dla granic części, a klient
 * Androida rozbiera odpowiedź parserem trzymającym się litery specyfikacji:
 * części rozdzielone samym `\n` widzi jako jedną i odrzuca manifest jako
 * uszkodzony. Awaria wygląda wtedy na błąd sieci, a nie na błąd formatu.
 */
export function serializeMultipart(parts: Part[], boundary: string): string {
  const lines = parts.map(
    (part) =>
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${part.name}"\r\n` +
      'Content-Type: application/json; charset=utf-8\r\n' +
      '\r\n' +
      `${part.body}\r\n`,
  );
  return `${lines.join('')}--${boundary}--\r\n`;
}

export interface UpdateResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Nagłówki wspólne dla każdej odpowiedzi protokołu. */
function protocolHeaders(protocolVersion: number, boundary: string): Record<string, string> {
  return {
    'expo-protocol-version': String(protocolVersion),
    'expo-sfv-version': SFV_VERSION,
    // Manifest zmienia się dokładnie wtedy, gdy zależy nam na świeżej
    // odpowiedzi. Ten sam powód, dla którego `latest.json` dostaje `no-store`
    // w `deploy/Caddyfile`.
    'cache-control': 'private, max-age=0',
    'content-type': `multipart/mixed; boundary=${boundary}`,
  };
}

/**
 * Odpowiedź z manifestem.
 *
 * Część `extensions` jest wymagana przez klienta nawet wtedy, gdy nie niesie
 * niczego poza pustymi nagłówkami zasobów — jej brak kończy się odrzuceniem
 * całej odpowiedzi.
 */
export function manifestResponse(manifest: ExpoManifest, protocolVersion: number): UpdateResponse {
  const boundary = newBoundary();
  return {
    status: 200,
    headers: protocolHeaders(protocolVersion, boundary),
    body: serializeMultipart(
      [
        { name: 'manifest', body: JSON.stringify(manifest) },
        { name: 'extensions', body: JSON.stringify({ assetRequestHeaders: {} }) },
      ],
      boundary,
    ),
  };
}

/**
 * Odpowiedź „nie mam nic nowszego".
 *
 * Od protokołu 1 jest to dyrektywa, a nie kod błędu, i to jest istotne:
 * telefon z warstwą natywną, dla której nikt jeszcze nie wydał paczki, ma
 * spokojnie uruchomić tę wbudowaną w `.apk`, a nie potraktować odpowiedzi jak
 * awarię i próbować ponownie. Klient protokołu 0 dyrektyw nie zna, więc dla
 * niego zostaje 404 — który znaczy dla niego dokładnie to samo.
 */
export function noUpdateAvailableResponse(protocolVersion: number): UpdateResponse {
  if (protocolVersion === 0) {
    return {
      status: 404,
      headers: {
        'expo-protocol-version': '0',
        'expo-sfv-version': SFV_VERSION,
        'cache-control': 'private, max-age=0',
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({ error: 'Brak wydania dla tej wersji aplikacji' }),
    };
  }

  const boundary = newBoundary();
  return {
    status: 200,
    headers: protocolHeaders(protocolVersion, boundary),
    body: serializeMultipart(
      [{ name: 'directive', body: JSON.stringify({ type: 'noUpdateAvailable' }) }],
      boundary,
    ),
  };
}

/**
 * Granica części. Losowa, bo musi nie wystąpić w treści — a treść zawiera
 * hashe base64url, czyli dokładnie ten alfabet, z którego granicę się składa.
 */
function newBoundary(): string {
  return `alphapump-${randomUUID()}`;
}
