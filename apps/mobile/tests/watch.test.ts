/**
 * Wydanie aplikacji na zegarek widziane z telefonu.
 *
 * Sprawdzane jest to, co decyduje o tym, czy przycisk „Install on the watch"
 * w ogóle ma co pobrać: że czytamy **swój** manifest, a nie manifest pakietu
 * telefonu, że brak wydania to stan, a nie awaria, i że nazwa pliku z manifestu
 * nie ma jak nas wyprowadzić poza katalog wydań.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  fetchWatchRelease,
  watchManifestUrl,
  watchPackageUrl,
  watchReleaseSchema,
  type WatchRelease,
} from '../src/watch/release';

const BASE = 'http://minipc/alphapump/download';

const RELEASE: WatchRelease = {
  version: '1.0.0',
  file: 'alphapump-1.0.0.pbw',
  size: 42_000,
  sha256: 'a'.repeat(64),
};

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('adresy wydania', () => {
  it('manifest zegarka to nie manifest telefonu', () => {
    // `latest.json` mówi, co zainstalować na telefonie. Pomyłka tutaj kończy się
    // propozycją zainstalowania `.pbw` jako pakietu Androida.
    expect(watchManifestUrl(BASE)).toBe(`${BASE}/watch.json`);
  });

  it('znosi końcowy ukośnik w adresie bazowym', () => {
    expect(watchManifestUrl(`${BASE}/`)).toBe(`${BASE}/watch.json`);
    expect(watchPackageUrl(`${BASE}//`, RELEASE)).toBe(`${BASE}/alphapump-1.0.0.pbw`);
  });

  it('plik bierze nazwę z manifestu', () => {
    expect(watchPackageUrl(BASE, RELEASE)).toBe(`${BASE}/alphapump-1.0.0.pbw`);
  });
});

describe('czytanie manifestu', () => {
  it('oddaje wydanie przepuszczone przez schemat', async () => {
    const fetchImpl = respond(RELEASE);

    await expect(fetchWatchRelease(BASE, fetchImpl)).resolves.toEqual(RELEASE);
    expect(fetchImpl).toHaveBeenCalledWith(
      `${BASE}/watch.json`,
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('brak wydania to stan, a nie awaria', async () => {
    // Świeże wdrożenie: nikt jeszcze nie wypuścił aplikacji na zegarek.
    await expect(fetchWatchRelease(BASE, respond({}, 404))).resolves.toBeNull();
  });

  it('awaria serwera jest błędem, bo da się ją naprawić', async () => {
    await expect(fetchWatchRelease(BASE, respond({}, 500))).rejects.toThrow(/500/);
  });

  it('odrzuca manifest o nieznanym kształcie', async () => {
    await expect(fetchWatchRelease(BASE, respond({ version: '1.0.0' }))).rejects.toThrow();
  });

  it('nazwa pliku musi wyglądać jak wydanie, a nie jak ścieżka', () => {
    // Nazwa z manifestu wchodzi do adresu pobierania, więc jej kształt jest
    // sprawdzany po obu stronach — tu i w `deploy/update_server.py`.
    for (const file of ['../../etc/passwd', 'alphapump.pbw', 'alphapump-1.0.0.apk', '']) {
      expect(watchReleaseSchema.safeParse({ ...RELEASE, file }).success).toBe(false);
    }
    expect(watchReleaseSchema.safeParse({ ...RELEASE, file: 'alphapump-10.2.3.pbw' }).success).toBe(
      true,
    );
  });
});
