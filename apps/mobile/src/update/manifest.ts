/**
 * Manifest wydania natywnego — skąd aplikacja wie, że trzeba doinstalować `.apk`.
 *
 * Dotyczy **wyłącznie** wydań ruszających warstwę natywną: podbicia SDK, nowej
 * zależności z kodem natywnym. Wydania ruszające sam JavaScript jadą przez
 * `expo-updates` (`ota.ts`) i nie mają z tym plikiem nic wspólnego — telefon
 * pobiera wtedy kilka megabajtów paczki zamiast kilkudziesięciu megabajtów
 * pakietu.
 *
 * Sam plik pobiera i oddaje instalatorowi `apk.ts` — bez wychodzenia
 * z aplikacji. Ten moduł jest wcześniej: mówi tylko, **czy** jest nowszy pakiet
 * i pod jakim adresem leży.
 *
 * Wydanie na Androida nie idzie przez sklep, więc nikt nie powie telefonowi
 * „jest aktualizacja". Robi to plik `latest.json` leżący obok `.apk` w katalogu
 * `deploy/apk/` na minipc, oddawany przez Caddy'ego pod `/alphapump/download/latest.json`.
 * Aplikacja pyta o niego przy każdym wejściu na pierwszy plan i porównuje
 * `versionCode` z własnym.
 *
 * Plik statyczny, a nie trasa w API, i to jest decyzja: lista ścieżek w
 * `deploy/Caddyfile` jest kontraktem pilnowanym testem (`apps/api/tests/deploy.test.ts`),
 * a `/alphapump/download/*` i tak wpada do `file_server`. Sprawdzanie aktualizacji nie
 * wymaga więc ani jednej zmiany w warstwie wejściowej ani w backendzie — i nie
 * wymaga też sesji, bo działa przed zalogowaniem.
 *
 * Moduł jest czysty i nie importuje niczego z Expo: dzięki temu chodzi
 * w testach bez środowiska React Native, tak jak `feedback.ts` czy `config/`.
 */

import { z } from 'zod';

/** Ile czekamy na manifest. Krótko — to sprawdzenie w tle, nie akcja użytkownika. */
const TIMEOUT_MS = 5_000;

/**
 * Kształt `latest.json`. Plik powstaje w `.github/workflows/android-release.yml`
 * razem z samym `.apk`, więc nie ma jak opisywać pliku, którego nie zbudowano.
 */
export const updateManifestSchema = z.object({
  /**
   * Numer wydania widziany przez system — ten sam, który wchodzi do
   * `android.versionCode`. To on, a nie `versionName`, decyduje o tym, co jest
   * nowsze: Android porządkuje wydania właśnie po nim.
   */
  versionCode: z.number().int().positive(),
  /** Wersja dla człowieka — „0.2.0". Tylko do pokazania w oknie. */
  versionName: z.string().min(1),
  /**
   * Nazwa pliku, nie pełny adres. Manifest opisuje **zawartość katalogu**,
   * a nie miejsce, z którego się go pobiera — ten sam plik działa wtedy pod
   * każdym adresem, pod którym minipc jest widoczny w VPN.
   */
  file: z.string().min(1),
  /** Rozmiar w bajtach — pokazywany przed pobraniem, żeby nie zaskoczył. */
  size: z.number().int().nonnegative(),
  /** Kiedy wydanie powstało. */
  releasedAt: z.iso.datetime(),
  /** Opis zmian; pusty, gdy wydanie go nie niesie. */
  notes: z.string().default(''),
});

export type UpdateManifest = z.infer<typeof updateManifestSchema>;

/**
 * Sprawdzenie aktualizacji nie ma prawa niczego zepsuć — minipc bywa poza
 * zasięgiem częściej niż jest w nim. Stąd jeden typ błędu zamiast rozróżnienia
 * „offline / serwer / śmieci w odpowiedzi", które jak w `sync/transport.ts`
 * dawałoby wywołującemu wybór, na który i tak nie ma tu reakcji: każdy z nich
 * znaczy „nie wiemy, spytamy następnym razem".
 */
export class UpdateCheckError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'UpdateCheckError';
    this.cause = cause;
  }
}

export function parseUpdateManifest(value: unknown): UpdateManifest {
  const parsed = updateManifestSchema.safeParse(value);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new UpdateCheckError(`Malformed release manifest: ${problems}`);
  }
  return parsed.data;
}

/**
 * Adres pliku `.apk` opisanego manifestem — do otwarcia w przeglądarce.
 *
 * Manifest niesie **nazwę**, nie adres, więc ten sam plik działa pod każdym
 * adresem, pod którym minipc widać w VPN. Sumy kontrolne zostały w
 * `latest.json` i przy pliku, ale aplikacja ich już nie sprawdza: pobiera
 * przeglądarka, a przed podmianą pakietu chroni podpis sprawdzany przez system.
 */
export function releaseUrl(baseUrl: string, manifest: UpdateManifest): string {
  return `${baseUrl.replace(/\/+$/, '')}/${encodeURIComponent(manifest.file)}`;
}

export interface FetchUpdateManifestOptions {
  /** Katalog wydań — `appConfig.updateBaseUrl`. */
  baseUrl: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export async function fetchUpdateManifest(
  options: FetchUpdateManifestOptions,
): Promise<UpdateManifest> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
  const call = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await call(`${options.baseUrl.replace(/\/+$/, '')}/latest.json`, {
      signal: controller.signal,
      // Bez tego telefon dostaje odpowiedź z pamięci podręcznej: Caddy oddaje
      // pliki statyczne z `ETag`, a manifest zmienia się dokładnie wtedy, gdy
      // zależy nam na świeżej odpowiedzi.
      cache: 'no-store',
      headers: { accept: 'application/json' },
    });
  } catch (error) {
    throw new UpdateCheckError('Could not reach the release directory', error);
  } finally {
    clearTimeout(timeout);
  }

  // 404 jest normalne, dopóki nikt nie wgrał pierwszego wydania na minipc.
  if (!response.ok) {
    throw new UpdateCheckError(`Release directory responded ${String(response.status)}`);
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (error) {
    throw new UpdateCheckError('Release manifest is not JSON', error);
  }

  return parseUpdateManifest(body);
}

/**
 * Czy manifest opisuje wydanie nowsze niż zainstalowane.
 *
 * `installedVersionCode` jest `null`, gdy nie da się go odczytać — tak zwraca
 * `expo-application` poza Androidem i iOS. Wtedy **nie** proponujemy niczego:
 * okno „zainstaluj aktualizację" pokazane komuś, kto już ma najnowszą wersję,
 * jest gorsze niż brak okna.
 */
export function isUpdateAvailable(
  manifest: UpdateManifest,
  installedVersionCode: number | null,
): boolean {
  if (installedVersionCode === null) return false;
  return manifest.versionCode > installedVersionCode;
}

/**
 * Numer wydania z `expo-application`. Na Androidzie `nativeBuildVersion` jest
 * napisem z `versionCode`, więc wymaga zamiany na liczbę — a ta może się nie
 * udać, bo typ mówi `string | null`, nie „na pewno liczba".
 */
export function parseInstalledVersionCode(nativeBuildVersion: string | null): number | null {
  if (nativeBuildVersion === null) return null;
  const parsed = Number.parseInt(nativeBuildVersion, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

/**
 * Rozmiar pliku po ludzku — „62 MB", „4.5 MB". Wchodzi do okna przed pobraniem.
 *
 * Kropka dziesiętna, nie przecinek: interfejs aplikacji jest po angielsku,
 * mimo że komentarze w repozytorium są po polsku.
 */
export function formatBytes(bytes: number): string {
  const megabytes = bytes / 1_000_000;
  if (megabytes >= 10) return `${String(Math.round(megabytes))} MB`;
  return `${megabytes.toFixed(1)} MB`;
}
