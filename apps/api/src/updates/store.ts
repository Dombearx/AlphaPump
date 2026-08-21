/**
 * Wydania OTA leżące na dysku minipc.
 *
 * Katalog zapisuje `deploy/update_server.py` przy wgrywaniu wydania, a API
 * wyłącznie z niego czyta — ten sam podział, co przy plikach `.apk`: proces na
 * gospodarzu pisze, kontener czyta wolumin tylko do odczytu. Dzięki temu
 * pomyłka w kodzie API nie ma jak skasować wydania, które jest w tej chwili
 * jedynym działającym.
 *
 * Układ katalogu:
 *
 * ```
 * <OTA_DIR>/
 *   assets/<key>                          pliki wydania, adresowane treścią
 *   <platforma>/<runtimeVersion>.json     opis wydania bieżącego dla tej warstwy
 * ```
 *
 * Zasoby leżą **wspólnie**, a nie w katalogu wydania, bo ich nazwa jest hashem
 * treści: dwa kolejne wydania różniące się samym JavaScriptem współdzielą
 * komplet obrazków, czcionek i dźwięków bez jednej dodatkowej linii kodu.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { logger } from '../logger.js';
import type { StoredUpdate, UpdatePlatform } from './protocol.js';

/**
 * Dozwolony kształt `runtimeVersion`.
 *
 * Ta wartość przychodzi **nagłówkiem żądania** i staje się fragmentem ścieżki
 * na dysku, więc jest sprawdzana, a nie czyszczona: `..%2f..%2fetc%2fpasswd`
 * oczyszczone z separatorów dalej jest napisem, który ktoś próbował podłożyć.
 * Odciski `@expo/fingerprint` są szesnastkowe, a ręcznie ustawione wersje bywają
 * postaci `1.2.3` — jedno i drugie mieści się tutaj z zapasem.
 */
const RUNTIME_VERSION = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

const storedAssetSchema = z.object({
  key: z.string().min(1),
  contentType: z.string().min(1),
  hash: z.string().min(1),
  /**
   * Ścieżka względna wewnątrz katalogu wydań. Sprawdzana mimo że powstaje po
   * naszej stronie: plik na dysku minipc jest jedynym wejściem tego modułu,
   * a ręczna podmiana przy diagnozie zdarza się częściej niż atak.
   */
  path: z
    .string()
    .min(1)
    .refine((value) => !value.startsWith('/') && !value.split('/').includes('..'), {
      message: 'Ścieżka zasobu musi być względna i nie może wychodzić z katalogu wydań',
    }),
});

const storedUpdateSchema = z.object({
  id: z.string().min(1),
  createdAt: z.string().min(1),
  runtimeVersion: z.string().min(1),
  platform: z.enum(['android', 'ios']),
  launchAsset: storedAssetSchema,
  assets: z.array(storedAssetSchema),
  metadata: z.record(z.string(), z.unknown()).optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});

export function isValidRuntimeVersion(value: string): boolean {
  return RUNTIME_VERSION.test(value);
}

/**
 * Opis wydania bieżącego dla danej platformy i warstwy natywnej.
 *
 * `null` znaczy „nie ma dla ciebie nic" i jest stanem normalnym, nie awarią:
 * tak wygląda telefon z wydaniem natywnym, do którego nikt jeszcze nie wypuścił
 * paczki JavaScriptu. Uszkodzony plik daje ten sam wynik z tego samego powodu —
 * telefon ma wtedy uruchomić paczkę wbudowaną w `.apk`, a nie zostać bez
 * aplikacji przez literówkę w pliku na minipc.
 */
export async function readCurrentUpdate(
  otaDir: string,
  platform: UpdatePlatform,
  runtimeVersion: string,
): Promise<StoredUpdate | null> {
  if (!isValidRuntimeVersion(runtimeVersion)) return null;

  const file = path.join(otaDir, platform, `${runtimeVersion}.json`);

  let raw: string;
  try {
    raw = await readFile(file, 'utf8');
  } catch {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    logger.error('opis wydania OTA nie jest JSON-em', { file });
    return null;
  }

  const checked = storedUpdateSchema.safeParse(parsed);
  if (!checked.success) {
    logger.error('opis wydania OTA jest niepoprawny', {
      file,
      problems: checked.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`),
    });
    return null;
  }

  // Rozjazd między nazwą pliku a jego treścią znaczy, że ktoś przestawił pliki
  // ręcznie. Wydanie zbudowane dla innej warstwy natywnej uruchomione na tej
  // kończy się wywaleniem aplikacji przy starcie — czyli awarią, po której nie
  // da się już nic zdalnie naprawić.
  if (checked.data.platform !== platform || checked.data.runtimeVersion !== runtimeVersion) {
    logger.error('opis wydania OTA nie zgadza się ze swoim położeniem', {
      file,
      describes: `${checked.data.platform}/${checked.data.runtimeVersion}`,
    });
    return null;
  }

  return checked.data;
}
