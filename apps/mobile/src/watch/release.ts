/**
 * Wydanie aplikacji na zegarek, widziane z telefonu.
 *
 * Plik `.pbw` leży na minipc obok pakietu `.apk` i jedzie tam tą samą drogą:
 * buduje go CI (`.github/workflows/pebble-release.yml`), a serwer wydań kładzie
 * w katalogu, który Caddy oddaje pod `/alphapump/download`. Telefon czyta stamtąd
 * `watch.json` i wie, co pobrać.
 *
 * Dwa manifesty w jednym katalogu, bo odpowiadają na dwa różne pytania:
 * `latest.json` mówi, co zainstalować **na telefonie**, `watch.json` — co
 * **na zegarku**. Telefon, który pomyliłby jeden z drugim, zaproponowałby
 * instalację `.pbw` jako pakietu Androida.
 *
 * Ten moduł jest czysty poza jednym `fetch`, który dostaje z zewnątrz — więc
 * daje się sprawdzić bez sieci i bez zegarka.
 */

import { z } from 'zod';

/**
 * Kształt `watch.json`. Bez `versionCode` i bez MD5, które niesie manifest
 * telefonu: nic po tej stronie nie porównuje wydań zegarka po numerze (Pebble
 * nie ma reguły „tylko nowsze"), a sumę kontrolną wystarczy mieć jedną.
 */
export const watchReleaseSchema = z.object({
  version: z.string().min(1),
  /** Nazwa pliku w katalogu wydań; wzorzec ten sam, którego pilnuje serwer. */
  file: z.string().regex(/^alphapump-\d+\.\d+\.\d+\.pbw$/),
  size: z.int().min(0),
  sha256: z.string().length(64),
});

export type WatchRelease = z.infer<typeof watchReleaseSchema>;

/** Adres manifestu — zawsze ten sam, treść zmienia się przy każdym wydaniu. */
export function watchManifestUrl(baseUrl: string): string {
  return `${trimSlash(baseUrl)}/watch.json`;
}

/**
 * Adres samego pliku. Nazwa niesie wersję, więc treść pod tym adresem nigdy się
 * nie zmienia — i dlatego nikt po drodze nie ma czego cache'ować niepoprawnie.
 */
export function watchPackageUrl(baseUrl: string, release: WatchRelease): string {
  return `${trimSlash(baseUrl)}/${release.file}`;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

/**
 * Czyta manifest wydania.
 *
 * `null` znaczy „nikt jeszcze nie wydał aplikacji na zegarek" — a to nie jest
 * awaria, tylko stan świeżego wdrożenia. Wszystko inne jest błędem, bo mówi
 * o czymś, co da się naprawić: nieosiągalnym minipc albo manifeście
 * o kształcie, którego nie umiemy przeczytać.
 */
export async function fetchWatchRelease(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<WatchRelease | null> {
  const response = await fetchImpl(watchManifestUrl(baseUrl), {
    method: 'GET',
    // Manifest wskazuje „to jest aktualne wydanie", więc odpowiedź sprzed
    // godziny jest gorsza niż jej brak. Caddy dokłada `no-store` po swojej
    // stronie; to jest ta sama prośba, powiedziana z drugiej.
    headers: { 'cache-control': 'no-cache' },
  });

  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`The release server answered ${String(response.status)}`);
  }

  const parsed = watchReleaseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("The watch release manifest doesn't look right");
  return parsed.data;
}
