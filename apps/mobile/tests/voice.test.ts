/**
 * Dyktowanie serii po stronie telefonu.
 *
 * Trzy rzeczy, których nie widać na urządzeniu, dopóki się nie zepsują:
 *
 * - **odpowiedź serwera jest walidowana schematem z rdzenia** — paczka, której
 *   nie umiemy przeczytać, nie ma prawa dojechać do formularza,
 * - **brak łączności to `SyncOfflineError`**, czyli to samo, co przy
 *   synchronizacji: telefon poza VPN-em, a nie awaria,
 * - **wartości jadą do formularza adresem** i wracają z niego liczbami, także
 *   wtedy, gdy w adresie znajdzie się śmieć.
 */

import type { VoiceSetMatch } from '@alphapump/core';
import { describe, expect, it, vi } from 'vitest';
import { createVoiceClient, recordingFrom, VoiceUnavailableError } from '../src/remote/voice';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../src/sync/transport';
import { dictationParams, readDictationParams } from '../src/voice-draft';

const EXERCISE = '00000000-0000-7000-8000-000000000001';

const MATCH: VoiceSetMatch = {
  exerciseId: EXERCISE,
  name: 'Wyciskanie sztangi leżąc',
  loggingType: 'weight_reps',
  weightG: 82_500,
  reps: 8,
  durationS: null,
  distanceM: null,
  bodyweightG: null,
  note: null,
  complete: true,
};

const RECORDING = { uri: 'file:///tmp/nagranie.m4a', name: 'nagranie.m4a', mimeType: 'audio/m4a' };

const client = (fetchImpl: typeof fetch) =>
  createVoiceClient({ baseUrl: 'http://api.test', cookie: () => 'sesja=abc', fetchImpl });

const respond = (body: unknown, status = 200) =>
  vi.fn(async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe('wysłanie nagrania', () => {
  it('oddaje odpowiedź przepuszczoną przez schemat rdzenia', async () => {
    const fetchImpl = respond({ transcript: 'wyciskanie', match: MATCH, reason: 'ok' });

    const response = await client(fetchImpl).dictateSet(RECORDING);

    expect(response.match).toEqual(MATCH);
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://api.test/voice/set',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('nie wpisuje nagłówka content-type — granicę multipart liczy FormData', async () => {
    const fetchImpl = respond({ transcript: '', match: null, reason: null });

    await client(fetchImpl).dictateSet(RECORDING);

    const init = vi.mocked(fetchImpl).mock.calls[0]?.[1];
    const headers = (init?.headers ?? {}) as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain('content-type');
    expect(headers.cookie).toBe('sesja=abc');
  });

  it('brak łączności to offline, a nie awaria', async () => {
    const fetchImpl = vi.fn(() =>
      Promise.reject(new TypeError('Network request failed')),
    ) as unknown as typeof fetch;

    await expect(client(fetchImpl).dictateSet(RECORDING)).rejects.toBeInstanceOf(SyncOfflineError);
  });

  it('rozróżnia wygasłą sesję, wyłączone dyktowanie i awarię serwera', async () => {
    await expect(client(respond({}, 401)).dictateSet(RECORDING)).rejects.toBeInstanceOf(
      SyncAuthError,
    );
    await expect(client(respond({}, 503)).dictateSet(RECORDING)).rejects.toBeInstanceOf(
      VoiceUnavailableError,
    );
    await expect(client(respond({}, 500)).dictateSet(RECORDING)).rejects.toBeInstanceOf(
      SyncServerError,
    );
  });

  it('odrzuca odpowiedź o nieznanym kształcie', async () => {
    const fetchImpl = respond({ transcript: 'coś', match: { exerciseId: 'nie-uuid' } });

    await expect(client(fetchImpl).dictateSet(RECORDING)).rejects.toBeInstanceOf(SyncServerError);
  });
});

describe('nagranie z dysku', () => {
  it('wylicza typ MIME z rozszerzenia', () => {
    expect(recordingFrom('file:///tmp/abc.m4a')).toMatchObject({ mimeType: 'audio/m4a' });
    expect(recordingFrom('file:///tmp/abc.3gp')).toMatchObject({
      mimeType: 'audio/3gpp',
      name: 'nagranie.3gp',
    });
  });

  it('nieznane rozszerzenie i brak rozszerzenia spadają na m4a', () => {
    expect(recordingFrom('file:///tmp/abc.xyz').mimeType).toBe('audio/m4a');
    expect(recordingFrom('file:///tmp/nagranie').mimeType).toBe('audio/m4a');
  });
});

describe('podyktowana seria w adresie formularza', () => {
  it('przenosi wyłącznie to, co model zrozumiał', () => {
    expect(dictationParams(MATCH)).toEqual({ weightG: '82500', reps: '8' });
  });

  it('wraca z adresu tymi samymi liczbami', () => {
    expect(readDictationParams(dictationParams(MATCH))).toEqual({
      weightG: 82_500,
      reps: 8,
      durationS: null,
      distanceM: null,
      bodyweightG: null,
      note: null,
    });
  });

  it('adres bez dyktowania zostaje zwykłym wejściem w formularz', () => {
    expect(readDictationParams({ date: '2026-08-10', exerciseId: EXERCISE })).toBeNull();
  });

  it('śmieć w parametrze nie wstawia się do formularza', () => {
    expect(readDictationParams({ weightG: 'dużo', reps: '8' })).toMatchObject({
      weightG: null,
      reps: 8,
    });
    expect(readDictationParams({ weightG: '-5', reps: '2.5' })).toBeNull();
  });

  it('sama notatka też jest dyktowaniem', () => {
    expect(readDictationParams({ note: 'bolało kolano' })).toMatchObject({
      note: 'bolało kolano',
      reps: null,
    });
  });
});
