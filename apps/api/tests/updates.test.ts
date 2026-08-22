/**
 * Manifest aktualizacji OTA.
 *
 * To jest trasa, po której awarii nie da się już nic zdalnie naprawić: telefon
 * pyta o nią przy starcie, a odpowiedź decyduje o tym, jaki JavaScript
 * uruchomi. Stąd testy pilnują nie tylko szczęśliwej ścieżki, ale przede
 * wszystkim tego, że **brak** wydania i **uszkodzony** opis wydania kończą się
 * uruchomieniem paczki wbudowanej w `.apk`, a nie aplikacją, która nie wstaje.
 *
 * Format odpowiedzi jest sprawdzany dosłownie, z granicami części i końcami
 * linii, bo klient rozbiera go parserem trzymającym się litery RFC 2046 —
 * a różnica między `\r\n` a `\n` objawia się dopiero na urządzeniu, jako
 * „aktualizacja nie działa" bez żadnego błędu po stronie serwera.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { StoredUpdate } from '../src/updates/protocol.js';
import { createHarness, type Harness } from './harness.js';

const RUNTIME = 'a1b2c3d4e5f6';

function storedUpdate(overrides: Partial<StoredUpdate> = {}): StoredUpdate {
  return {
    id: '0195f1a2-3b4c-7d8e-9f01-234567890abc',
    createdAt: '2026-08-19T10:00:00.000Z',
    runtimeVersion: RUNTIME,
    platform: 'android',
    launchAsset: {
      key: 'd41d8cd98f00b204e9800998ecf8427e',
      contentType: 'application/javascript',
      hash: 'Jk3Zx1QpL2mN4oP5qR6sT7uV8wX9yZ0aB1cD2eF3gH4',
      path: 'assets/d41d8cd98f00b204e9800998ecf8427e',
    },
    assets: [
      {
        key: 'ab56b4d92b40713acc5af89985d4b786',
        contentType: 'image/png',
        hash: 'Qw2Er4Ty6Ui8Op0As1Df3Gh5Jk7Lz9Xc0Vb2Nm4Qw6',
        path: 'assets/ab56b4d92b40713acc5af89985d4b786',
        fileExtension: '.png',
      },
    ],
    ...overrides,
  };
}

/** Kładzie opis wydania tam, gdzie szuka go API. */
async function publish(otaDir: string, update: StoredUpdate, at = update.runtimeVersion) {
  const directory = path.join(otaDir, update.platform);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${at}.json`), JSON.stringify(update), 'utf8');
}

/** Rozbiera `multipart/mixed` na części po nazwie z `Content-Disposition`. */
function parseMultipart(body: string, contentType: string): Record<string, string> {
  const boundary = /boundary=([^;]+)/.exec(contentType)?.[1];
  if (boundary === undefined) throw new Error(`Brak granicy w nagłówku: ${contentType}`);

  const parts: Record<string, string> = {};
  for (const chunk of body.split(`--${boundary}`)) {
    const name = /name="([^"]+)"/.exec(chunk)?.[1];
    if (name === undefined) continue;
    const separator = chunk.indexOf('\r\n\r\n');
    parts[name] = chunk.slice(separator + 4).replace(/\r\n$/, '');
  }
  return parts;
}

const ANDROID = { 'expo-platform': 'android', 'expo-runtime-version': RUNTIME };
const PROTOCOL_1 = { 'expo-protocol-version': '1' };

describe('manifest aktualizacji OTA', () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await createHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('nie wymaga zalogowania', async () => {
    // Aktualizacja sprawdza się przed logowaniem — a wydanie naprawiające
    // logowanie musi dojechać właśnie do telefonu, który zalogować się nie umie.
    const response = await harness.request('/updates/manifest', {
      headers: { ...ANDROID, ...PROTOCOL_1 },
    });
    expect(response.status).not.toBe(401);
    expect(response.status).not.toBe(403);
  });

  it('bez wydania oddaje dyrektywę „nie ma nic nowszego", a nie błąd', async () => {
    const response = await harness.request('/updates/manifest', {
      headers: { ...ANDROID, ...PROTOCOL_1 },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('expo-protocol-version')).toBe('1');
    expect(response.headers.get('expo-sfv-version')).toBe('0');
    expect(response.headers.get('cache-control')).toBe('private, max-age=0');

    const contentType = response.headers.get('content-type') ?? '';
    expect(contentType).toMatch(/^multipart\/mixed; boundary=/);

    const parts = parseMultipart(await response.text(), contentType);
    expect(JSON.parse(parts.directive ?? '{}')).toEqual({ type: 'noUpdateAvailable' });
  });

  it('klientowi protokołu 0 brak wydania oddaje 404 — dyrektyw nie zna', async () => {
    const response = await harness.request('/updates/manifest', { headers: ANDROID });
    expect(response.status).toBe(404);
  });

  it('oddaje manifest z adresami wyliczonymi z żądania', async () => {
    const update = storedUpdate();
    await publish(harness.otaDir, update);

    const response = await harness.request('/updates/manifest', {
      headers: { ...ANDROID, ...PROTOCOL_1 },
    });
    expect(response.status).toBe(200);

    const parts = parseMultipart(await response.text(), response.headers.get('content-type') ?? '');
    const manifest = JSON.parse(parts.manifest ?? '{}') as Record<string, never>;

    expect(manifest).toMatchObject({
      id: update.id,
      createdAt: update.createdAt,
      runtimeVersion: RUNTIME,
    });

    // Adres bierze się z hosta żądania, a nie z konfiguracji serwera: minipc
    // widać w VPN pod nazwą z NetBirda i jednocześnie pod adresem w LAN.
    expect(manifest.launchAsset).toMatchObject({
      key: update.launchAsset.key,
      hash: update.launchAsset.hash,
      contentType: 'application/javascript',
      url: `http://localhost:3000/alphapump/ota/${update.launchAsset.path}`,
    });
    expect(manifest.assets).toHaveLength(1);

    // `fileExtension` przy zasobie nie jest ozdobą: Android czyta je przez
    // `getString`, więc brak znaczy zasób **po cichu** wyrzucony z wydania,
    // a iOS odrzuca wtedy cały manifest. Paczka JavaScriptu go nie ma i mieć
    // nie powinna — telefon trzyma ją pod samym kluczem.
    expect(manifest.assets).toMatchObject([{ fileExtension: '.png' }]);
    expect(manifest.launchAsset).not.toHaveProperty('fileExtension');

    // Część `extensions` jest wymagana przez klienta nawet pusta — jej brak
    // kończy się odrzuceniem całej odpowiedzi.
    expect(JSON.parse(parts.extensions ?? 'null')).toEqual({ assetRequestHeaders: {} });
  });

  it('nie proponuje wydania zbudowanego dla innej warstwy natywnej', async () => {
    await publish(harness.otaDir, storedUpdate());

    const response = await harness.request('/updates/manifest', {
      headers: {
        'expo-platform': 'android',
        'expo-runtime-version': 'inna-warstwa',
        ...PROTOCOL_1,
      },
    });

    const parts = parseMultipart(await response.text(), response.headers.get('content-type') ?? '');
    expect(parts.directive).toBeDefined();
    expect(parts.manifest).toBeUndefined();
  });

  it('nie proponuje wydania z innej platformy', async () => {
    await publish(harness.otaDir, storedUpdate());

    const response = await harness.request('/updates/manifest', {
      headers: { 'expo-platform': 'ios', 'expo-runtime-version': RUNTIME, ...PROTOCOL_1 },
    });

    const parts = parseMultipart(await response.text(), response.headers.get('content-type') ?? '');
    expect(parts.manifest).toBeUndefined();
  });

  it('opis leżący nie tam, gdzie opisuje, jest odrzucany', async () => {
    // Plik przestawiony ręcznie przy diagnozie. Wydanie zbudowane dla innej
    // warstwy uruchomione na tej wywala aplikację przy starcie — czyli awaria,
    // po której nie da się już nic zdalnie naprawić.
    await publish(harness.otaDir, storedUpdate({ runtimeVersion: 'cos-innego' }), 'podlozone');

    const response = await harness.request('/updates/manifest', {
      headers: { 'expo-platform': 'android', 'expo-runtime-version': 'podlozone', ...PROTOCOL_1 },
    });

    const parts = parseMultipart(await response.text(), response.headers.get('content-type') ?? '');
    expect(parts.manifest).toBeUndefined();
  });

  it('nie daje wyjść z katalogu wydań przez nagłówek', async () => {
    for (const runtimeVersion of ['../../etc/passwd', '..', 'a/b', './x']) {
      const response = await harness.request('/updates/manifest', {
        headers: {
          'expo-platform': 'android',
          'expo-runtime-version': runtimeVersion,
          ...PROTOCOL_1,
        },
      });
      const parts = parseMultipart(
        await response.text(),
        response.headers.get('content-type') ?? '',
      );
      expect(parts.manifest, `${runtimeVersion} nie może niczego odczytać`).toBeUndefined();
    }
  });

  it('odrzuca żądanie bez nagłówków, których protokół wymaga', async () => {
    const bezPlatformy = await harness.request('/updates/manifest', {
      headers: { 'expo-runtime-version': RUNTIME, ...PROTOCOL_1 },
    });
    expect(bezPlatformy.status).toBe(400);

    const bezWersji = await harness.request('/updates/manifest', {
      headers: { 'expo-platform': 'android', ...PROTOCOL_1 },
    });
    expect(bezWersji.status).toBe(400);

    const obcaPlatforma = await harness.request('/updates/manifest', {
      headers: { 'expo-platform': 'windows', 'expo-runtime-version': RUNTIME, ...PROTOCOL_1 },
    });
    expect(obcaPlatforma.status).toBe(400);
  });

  it('odrzuca wersję protokołu, której nie zna', async () => {
    const response = await harness.request('/updates/manifest', {
      headers: { ...ANDROID, 'expo-protocol-version': '99' },
    });
    expect(response.status).toBe(400);
  });

  it('rozdziela części końcami linii wymaganymi przez RFC 2046', async () => {
    await publish(harness.otaDir, storedUpdate());
    const response = await harness.request('/updates/manifest', {
      headers: { ...ANDROID, ...PROTOCOL_1 },
    });
    const body = await response.text();

    // Samo `\n` klient widzi jako jedną część i odrzuca manifest jako
    // uszkodzony — a wygląda to na błąd sieci, nie na błąd formatu.
    expect(body).toContain('\r\n\r\n');
    expect(body.replace(/\r\n/g, '')).not.toContain('\n');
    expect(body.endsWith('--\r\n')).toBe(true);
  });
});
