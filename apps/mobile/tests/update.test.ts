/**
 * Wykrywanie i instalacja nowego wydania.
 *
 * To jest ścieżka, która uruchamia się rzadko i na cudzym telefonie — czyli
 * dokładnie taka, przy której nie ma jak zauważyć, że przestała działać.
 * Stąd testowane jest wszystko, co da się sprawdzić bez emulatora: kształt
 * manifestu, porównanie wersji i kolejność kroków instalacji razem z tym, co
 * robi każdy nieudany.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  installUpdate,
  UpdateInstallError,
  type DownloadedApk,
  type UpdateInstaller,
} from '../src/update/install';
import {
  apkUrl,
  fetchUpdateManifest,
  formatBytes,
  isUpdateAvailable,
  parseInstalledVersionCode,
  parseUpdateManifest,
  UpdateCheckError,
  type UpdateManifest,
} from '../src/update/manifest';

const MANIFEST = {
  versionCode: 42,
  versionName: '0.2.0',
  file: 'alphapump-42.apk',
  size: 62_400_000,
  md5: '0123456789abcdef0123456789abcdef',
  releasedAt: '2026-08-15T10:00:00Z',
  notes: 'Poprawki synchronizacji.',
} satisfies UpdateManifest;

/** Odpowiedź serwera w kształcie, którego oczekuje `fetch`. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('manifest wydania', () => {
  it('przyjmuje plik wygenerowany przez wydanie', () => {
    expect(parseUpdateManifest(MANIFEST)).toEqual(MANIFEST);
  });

  it('dopuszcza wydanie bez opisu zmian', () => {
    const { notes: _notes, ...withoutNotes } = MANIFEST;
    expect(parseUpdateManifest(withoutNotes).notes).toBe('');
  });

  it('odrzuca manifest bez numeru wydania', () => {
    const { versionCode: _versionCode, ...withoutCode } = MANIFEST;
    expect(() => parseUpdateManifest(withoutCode)).toThrow(UpdateCheckError);
  });

  it('odrzuca sumę kontrolną, która nie jest sumą MD5', () => {
    // Rozjazd długości hasha znaczy, że wydanie i aplikacja liczą co innego —
    // wtedy każde pobranie wyglądałoby na uszkodzone.
    expect(() => parseUpdateManifest({ ...MANIFEST, md5: 'nie-hash' })).toThrow(UpdateCheckError);
  });

  it('składa adres pliku z katalogu wydań', () => {
    expect(apkUrl('http://minipc/alphapump/download', MANIFEST)).toBe(
      'http://minipc/alphapump/download/alphapump-42.apk',
    );
  });

  it('nie gubi ukośnika, gdy katalog wydań ma go na końcu', () => {
    expect(apkUrl('http://minipc/alphapump/download/', MANIFEST)).toBe(
      'http://minipc/alphapump/download/alphapump-42.apk',
    );
  });
});

describe('pobranie manifestu', () => {
  it('pyta o latest.json z pominięciem pamięci podręcznej', async () => {
    // Bez `no-store` telefon dostaje odpowiedź z cache'u dokładnie wtedy, gdy
    // zależy nam na świeżej — Caddy oddaje pliki statyczne z `ETag`.
    const fetchImpl = vi.fn(async () => jsonResponse(MANIFEST));

    await fetchUpdateManifest({ baseUrl: 'http://minipc/alphapump/download', fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      'http://minipc/alphapump/download/latest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('traktuje brak pliku jak brak informacji, a nie jak awarię', async () => {
    // 404 jest normalne, dopóki nikt nie wgrał pierwszego wydania na minipc.
    const fetchImpl = vi.fn(async () => jsonResponse({}, 404));

    await expect(
      fetchUpdateManifest({ baseUrl: 'http://minipc/alphapump/download', fetchImpl }),
    ).rejects.toBeInstanceOf(UpdateCheckError);
  });

  it('zamienia brak trasy do minipc na własny błąd', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Network request failed');
    });

    await expect(
      fetchUpdateManifest({ baseUrl: 'http://minipc/alphapump/download', fetchImpl }),
    ).rejects.toBeInstanceOf(UpdateCheckError);
  });

  it('nie przepuszcza odpowiedzi, która nie jest manifestem', async () => {
    // Literówka w ścieżce daje `index.html` panelu ze statusem 200 — dokładnie
    // ta awaria, którą po stronie API pilnuje `deploy.test.ts`.
    const fetchImpl = vi.fn(async () => new Response('<!doctype html>', { status: 200 }));

    await expect(
      fetchUpdateManifest({ baseUrl: 'http://minipc/alphapump/download', fetchImpl }),
    ).rejects.toBeInstanceOf(UpdateCheckError);
  });
});

describe('porównanie wersji', () => {
  it('proponuje wyłącznie wydanie nowsze', () => {
    expect(isUpdateAvailable(MANIFEST, 41)).toBe(true);
    expect(isUpdateAvailable(MANIFEST, 42)).toBe(false);
    expect(isUpdateAvailable(MANIFEST, 43)).toBe(false);
  });

  it('milczy, gdy nie wiadomo, co jest zainstalowane', () => {
    // Okno „zainstaluj aktualizację" pokazane komuś, kto ma najnowszą wersję,
    // jest gorsze niż brak okna.
    expect(isUpdateAvailable(MANIFEST, null)).toBe(false);
  });

  it('czyta numer wydania z manifestu pakietu', () => {
    expect(parseInstalledVersionCode('42')).toBe(42);
    expect(parseInstalledVersionCode(null)).toBeNull();
    expect(parseInstalledVersionCode('')).toBeNull();
    expect(parseInstalledVersionCode('1.0.0')).toBe(1);
  });
});

describe('instalacja', () => {
  /** Atrapa systemu: zapisuje, co dostała, i oddaje to, co jej kazano. */
  function installerSpy(downloaded: Partial<DownloadedApk> = {}) {
    const installed: string[] = [];
    const installer: UpdateInstaller = {
      download: vi.fn(async () => ({
        contentUri: 'content://app.alphapump.mobile.FileSystemFileProvider/updates/a.apk',
        md5: MANIFEST.md5,
        ...downloaded,
      })),
      install: vi.fn(async (contentUri: string) => {
        installed.push(contentUri);
      }),
      openUnknownSourcesSettings: vi.fn(async () => undefined),
    };
    return { installer, installed };
  }

  it('pobiera plik z katalogu wydań i oddaje go instalatorowi', async () => {
    const { installer, installed } = installerSpy();

    await installUpdate({
      manifest: MANIFEST,
      baseUrl: 'http://minipc/alphapump/download',
      installer,
    });

    expect(installer.download).toHaveBeenCalledWith(
      'http://minipc/alphapump/download/alphapump-42.apk',
      expect.anything(),
    );
    expect(installed).toEqual([
      'content://app.alphapump.mobile.FileSystemFileProvider/updates/a.apk',
    ]);
  });

  it('nie oddaje instalatorowi pliku o niezgodnej sumie', async () => {
    // Pakiet ucięty w połowie system też odrzuci, ale komunikatem o błędzie
    // parsowania — po którym nie widać, że problem był w pobieraniu.
    const { installer } = installerSpy({ md5: 'ffffffffffffffffffffffffffffffff' });

    await expect(
      installUpdate({ manifest: MANIFEST, baseUrl: 'http://minipc/alphapump/download', installer }),
    ).rejects.toMatchObject({ reason: 'checksum' });
    expect(installer.install).not.toHaveBeenCalled();
  });

  it('przechodzi dalej, gdy sumy nie dało się policzyć', async () => {
    const { installer } = installerSpy({ md5: null });

    await expect(
      installUpdate({ manifest: MANIFEST, baseUrl: 'http://minipc/alphapump/download', installer }),
    ).resolves.toBeUndefined();
    expect(installer.install).toHaveBeenCalled();
  });

  it('rozpoznaje platformę bez instalatora pakietów', async () => {
    const { installer } = installerSpy({ contentUri: null });

    await expect(
      installUpdate({ manifest: MANIFEST, baseUrl: 'http://minipc/alphapump/download', installer }),
    ).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('odróżnia nieudane pobranie od odmowy instalatora', async () => {
    const failing: UpdateInstaller = {
      download: vi.fn(async () => {
        throw new Error('Network request failed');
      }),
      install: vi.fn(),
      openUnknownSourcesSettings: vi.fn(),
    };

    const error = await installUpdate({
      manifest: MANIFEST,
      baseUrl: 'http://minipc/alphapump/download',
      installer: failing,
    }).catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(UpdateInstallError);
    expect((error as UpdateInstallError).reason).toBe('download');
  });

  it('zgłasza odmowę instalatora osobno', async () => {
    const { installer } = installerSpy();
    installer.install = vi.fn(async () => {
      throw new Error('No Activity found to handle Intent');
    });

    await expect(
      installUpdate({ manifest: MANIFEST, baseUrl: 'http://minipc/alphapump/download', installer }),
    ).rejects.toMatchObject({ reason: 'install' });
  });

  it('melduje postęp pobierania', async () => {
    const progress: number[] = [];
    const installer: UpdateInstaller = {
      download: vi.fn(async (_url, options) => {
        options.onProgress?.({ bytesWritten: 1_000, totalBytes: MANIFEST.size });
        options.onProgress?.({ bytesWritten: MANIFEST.size, totalBytes: MANIFEST.size });
        return { contentUri: 'content://x', md5: MANIFEST.md5 };
      }),
      install: vi.fn(async () => undefined),
      openUnknownSourcesSettings: vi.fn(async () => undefined),
    };

    await installUpdate({
      manifest: MANIFEST,
      baseUrl: 'http://minipc/alphapump/download',
      installer,
      onProgress: ({ bytesWritten }) => progress.push(bytesWritten),
    });

    expect(progress).toEqual([1_000, MANIFEST.size]);
  });
});

describe('rozmiar pliku', () => {
  it('pokazuje megabajty tak, jak się je czyta', () => {
    expect(formatBytes(62_400_000)).toBe('62 MB');
    expect(formatBytes(4_500_000)).toBe('4.5 MB');
  });
});
