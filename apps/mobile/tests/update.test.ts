/**
 * Wykrywanie nowego wydania **natywnego**.
 *
 * Dotyczy wyłącznie wydań ruszających warstwę natywną — te ruszające sam
 * JavaScript jadą przez `expo-updates` i nie mają tu nic do sprawdzania.
 * Czyli: ścieżka, która uruchamia się parę razy w roku i na cudzym telefonie,
 * a więc dokładnie taka, przy której nie ma jak zauważyć, że przestała działać.
 *
 * Testowane jest wszystko, co da się sprawdzić bez emulatora: kształt
 * manifestu, porównanie wersji i adres pliku. Pobieranie i instalacja nie są
 * testowane, bo ich już nie ma — plik pobiera przeglądarka, a instaluje system.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  releaseUrl,
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

  it('odrzuca manifest bez nazwy pliku', () => {
    // Bez nazwy nie ma z czego złożyć adresu, więc okno proponowałoby wydanie,
    // którego nie da się pobrać.
    const { file: _file, ...withoutFile } = MANIFEST;
    expect(() => parseUpdateManifest(withoutFile)).toThrow(UpdateCheckError);
  });

  it('nie przejmuje się polami, których już nie używa', () => {
    // `latest.json` niesie dalej sumy kontrolne — zostały przy pliku dla
    // człowieka i skryptów na minipc. Aplikacja ich nie sprawdza, odkąd
    // pobiera przeglądarka, ale manifest z nimi musi dalej przechodzić.
    expect(parseUpdateManifest({ ...MANIFEST, md5: 'cokolwiek', sha256: 'cokolwiek' })).toEqual(
      MANIFEST,
    );
  });

  it('składa adres pliku z katalogu wydań', () => {
    expect(releaseUrl('http://minipc/alphapump/download', MANIFEST)).toBe(
      'http://minipc/alphapump/download/alphapump-42.apk',
    );
  });

  it('nie gubi ukośnika, gdy katalog wydań ma go na końcu', () => {
    expect(releaseUrl('http://minipc/alphapump/download/', MANIFEST)).toBe(
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

describe('rozmiar pliku', () => {
  it('pokazuje megabajty tak, jak się je czyta', () => {
    expect(formatBytes(62_400_000)).toBe('62 MB');
    expect(formatBytes(4_500_000)).toBe('4.5 MB');
  });
});
