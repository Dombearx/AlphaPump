/**
 * Aktualizacje OTA — manifest, o który telefon pyta przy starcie.
 *
 * Wydanie, które rusza wyłącznie JavaScript, nie musi jechać jako nowy plik
 * `.apk`: telefon pobiera samą paczkę, kilka megabajtów zamiast kilkudziesięciu,
 * i podmienia ją bez instalatora systemu. Nowego `.apk` wymaga dopiero zmiana
 * warstwy natywnej — i właśnie po to w żądaniu jest `runtimeVersion`, odcisk
 * tej warstwy: paczka zbudowana dla innej po prostu nie zostaje zaproponowana.
 *
 * Trasa jest **bez uwierzytelnienia**, tak samo jak katalog `/alphapump/download`
 * z plikami `.apk`. Powód jest ten sam i jest wymuszony: aktualizacja
 * sprawdza się, zanim ktokolwiek się zaloguje — a wydanie naprawiające
 * logowanie musi dojechać właśnie do telefonu, który zalogować się nie potrafi.
 * Autoryzacją jest osiągalność w VPN, zgodnie z modelem zaufania całego
 * wdrożenia (`docs/stack_technologiczny.md`).
 *
 * Same pliki paczki oddaje Caddy spod `/alphapump/ota/`, zwykłym `file_server`-em —
 * są adresowane treścią, więc nie ma czego liczyć przy każdym pobraniu.
 */

import { Hono } from 'hono';
import type { AppEnvironment } from '../context.js';
import type { RouteSpec } from '../openapi.js';
import {
  isUpdatePlatform,
  manifestResponse,
  noUpdateAvailableResponse,
  readUpdateRequest,
  toManifest,
  UpdateRequestError,
} from '../updates/protocol.js';
import { readCurrentUpdate } from '../updates/store.js';

/**
 * Ścieżka, spod której Caddy oddaje pliki wydań OTA. Musi zgadzać się
 * z `deploy/Caddyfile` i z woluminem w `deploy/docker-compose.yml`.
 */
export const OTA_PUBLIC_PATH = '/alphapump/ota';

export const updateRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/updates/manifest',
    summary: 'Manifest aktualizacji OTA',
    description:
      'Opis paczki JavaScriptu pasującej do warstwy natywnej telefonu. Platformę ' +
      'i `runtimeVersion` telefon podaje nagłówkami `expo-platform` ' +
      'i `expo-runtime-version`; odpowiedź jest `multipart/mixed` zgodnie ' +
      'z protokołem Expo Updates. Brak paczki dla danej warstwy nie jest błędem — ' +
      'telefon uruchamia wtedy tę wbudowaną w plik `.apk`.',
    tag: 'system',
    security: 'none',
    responses: [
      { status: 200, description: 'Manifest albo dyrektywa „nie ma nic nowszego"' },
      { status: 400, description: 'Brak wymaganych nagłówków albo nieznana wersja protokołu' },
      {
        status: 404,
        description: 'Brak paczki — dla klientów protokołu 0, które nie znają dyrektyw',
      },
    ],
  },
];

/**
 * Adres, spod którego telefon pobierze pliki wydania.
 *
 * Liczony z **żądania**, a nie z konfiguracji serwera: minipc widać w VPN pod
 * nazwą z NetBirda i jednocześnie pod adresem w LAN, a manifest z wpisanym na
 * sztywno jednym z nich byłby nie do pobrania spod drugiego. Ta sama zasada, co
 * przy manifeście wydań na Androida.
 *
 * `x-forwarded-proto` jest uwzględniony, choć dziś stos jedzie po HTTP:
 * gdy przed Caddym stanie kiedyś TLS, manifest z adresami `http://` byłby
 * treścią mieszaną i telefon odmówiłby jej pobrania.
 */
function assetBaseUrl(requestUrl: string, forwardedProto: string | undefined): string {
  const url = new URL(requestUrl);
  const scheme = forwardedProto?.split(',')[0]?.trim();
  if (scheme === 'http' || scheme === 'https') url.protocol = `${scheme}:`;
  return `${url.origin}${OTA_PUBLIC_PATH}`;
}

export function createUpdateRouter(otaDir: string) {
  const router = new Hono<AppEnvironment>();

  router.get('/updates/manifest', async (context) => {
    let request;
    try {
      request = readUpdateRequest((name) => context.req.header(name));
    } catch (error) {
      if (error instanceof UpdateRequestError) return context.text(error.message, 400);
      throw error;
    }

    if (!isUpdatePlatform(request.platform)) {
      return context.text('The expo-platform header must be "android" or "ios"', 400);
    }
    if (request.runtimeVersion === undefined || request.runtimeVersion.trim() === '') {
      return context.text('Missing expo-runtime-version header', 400);
    }

    const update = await readCurrentUpdate(otaDir, request.platform, request.runtimeVersion);

    const response =
      update === null
        ? noUpdateAvailableResponse(request.protocolVersion)
        : manifestResponse(
            toManifest(
              update,
              assetBaseUrl(context.req.url, context.req.header('x-forwarded-proto')),
            ),
            request.protocolVersion,
          );

    return context.body(response.body, response.status as 200, response.headers);
  });

  return router;
}
