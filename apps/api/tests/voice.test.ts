/**
 * Dyktowanie serii głosem.
 *
 * Warstwy modelowe są podstawione — CI nie może zależeć od cudzej usługi
 * transkrypcji ani od klucza w sekretach. Sprawdzana jest za to **cała** reszta
 * przepływu na prawdziwej bazie: co trafia do modelu jako kontekst, co wraca do
 * telefonu i co się dzieje, gdy dostawca milczy.
 *
 * Najważniejsze jest tu jedno: endpoint **niczego nie zapisuje**. Po
 * podyktowaniu serii lista serii użytkownika ma być dokładnie taka sama jak
 * przed — zapisuje dopiero człowiek, w formularzu.
 */

import {
  builtInExerciseId,
  tagId,
  type VoiceSetResponse,
  type VoiceSetVerdict,
} from '@alphapump/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { VoiceInterpretation, VoiceInterpreter, VoiceLayers } from '../src/voice/index.js';
import type { Transcriber } from '../src/voice/index.js';
import { createHarness, type Harness, type TestUser } from './harness.js';

const BENCH = builtInExerciseId('Flat barbell bench press');

/** Nagranie jako plik — treść jest nieistotna, bo transkrypcja jest atrapą. */
const recording = (name = 'nagranie.m4a', type = 'audio/m4a'): FormData => {
  const form = new FormData();
  form.set('audio', new File([new Uint8Array([1, 2, 3, 4])], name, { type }));
  return form;
};

interface Recorded {
  /** Ostatnie zapytanie, które zobaczył model — to w nim jedzie kontekst. */
  last: VoiceInterpretation | null;
}

function stubLayers(
  transcript: string,
  verdict: Partial<VoiceSetVerdict> = {},
): { layers: VoiceLayers; recorded: Recorded } {
  const recorded: Recorded = { last: null };

  const transcriber: Transcriber = {
    model: 'atrapa-whisper',
    transcribe: () => Promise.resolve(transcript),
  };

  const interpreter: VoiceInterpreter = {
    model: 'atrapa-llm',
    interpret: (request) => {
      recorded.last = request;
      return Promise.resolve({
        exerciseIndex: 0,
        weightKg: 82.5,
        reps: 8,
        durationS: null,
        distanceM: null,
        bodyweightKg: null,
        note: null,
        reason: 'Wyciskanie, 82,5 kg na osiem',
        ...verdict,
      });
    },
  };

  return { layers: { transcriber, interpreter }, recorded };
}

describe('dyktowanie serii', () => {
  describe('z podstawionymi warstwami', () => {
    let harness: Harness;
    let user: TestUser;
    const { layers, recorded } = stubLayers('wyciskanie osiemdziesiąt dwa i pół na osiem');

    beforeAll(async () => {
      harness = await createHarness({ voice: layers });
      user = await harness.signUp('dyktowanie@example.com');

      await harness.json('POST', '/sets', {
        headers: user.headers,
        body: {
          exerciseId: BENCH,
          performedOn: '2026-08-10',
          weightG: 80_000,
          reps: 8,
          durationS: null,
          distanceM: null,
        },
      });
    });

    afterAll(async () => {
      await harness.close();
    });

    it('oddaje transkrypcję i rozpoznaną serię', async () => {
      const response = await harness.request('/voice/set', {
        method: 'POST',
        headers: user.headers,
        body: recording(),
      });
      const body = (await response.json()) as VoiceSetResponse;

      expect(response.status).toBe(200);
      expect(body.transcript).toBe('wyciskanie osiemdziesiąt dwa i pół na osiem');
      expect(body.match).toMatchObject({
        exerciseId: BENCH,
        loggingType: 'weight_reps',
        weightG: 82_500,
        reps: 8,
        complete: true,
      });
    });

    it('podaje modelowi ćwiczenia użytkownika i jego ostatnie serie', () => {
      expect(recorded.last?.exercises[0]).toMatchObject({
        exerciseId: BENCH,
        loggingType: 'weight_reps',
      });
      expect(recorded.last?.recent[0]).toMatchObject({
        performedOn: '2026-08-10',
        measurements: { weightG: 80_000, reps: 8 },
      });
    });

    it('nie zapisuje niczego — serię zapisuje dopiero człowiek', async () => {
      const before = await harness.json<unknown[]>('GET', '/sets', { headers: user.headers });

      await harness.request('/voice/set', {
        method: 'POST',
        headers: user.headers,
        body: recording(),
      });

      const after = await harness.json<unknown[]>('GET', '/sets', { headers: user.headers });
      expect(after.body.length).toBe(before.body.length);
    });

    it('odrzuca żądanie bez nagrania', async () => {
      const response = await harness.request('/voice/set', {
        method: 'POST',
        headers: user.headers,
        body: new FormData(),
      });

      expect(response.status).toBe(400);
    });

    it('odrzuca plik, który nagraniem nie jest', async () => {
      const form = new FormData();
      form.set('audio', new File([new Uint8Array([1])], 'zdjecie.png', { type: 'image/png' }));

      const response = await harness.request('/voice/set', {
        method: 'POST',
        headers: user.headers,
        body: form,
      });

      expect(response.status).toBe(400);
    });

    it('wymaga uwierzytelnienia', async () => {
      const response = await harness.request('/voice/set', {
        method: 'POST',
        body: recording(),
      });

      expect(response.status).toBe(401);
    });

    it('rozpoznaje serię opisaną z klawiatury, bez transkrypcji', async () => {
      const response = await harness.json<VoiceSetResponse>('POST', '/voice/text', {
        headers: user.headers,
        body: { text: 'wyciskanie 82,5 na osiem' },
      });

      expect(response.status).toBe(200);
      // Transkrypcja wraca echem wejścia: nikt jej tu nie liczył, a pole ma
      // mówić, co poszło do modelu.
      expect(response.body.transcript).toBe('wyciskanie 82,5 na osiem');
      expect(response.body.match).toMatchObject({ exerciseId: BENCH, weightG: 82_500, reps: 8 });
      expect(recorded.last?.transcript).toBe('wyciskanie 82,5 na osiem');
    });

    it('odrzuca pusty i przydługi opis', async () => {
      const empty = await harness.json('POST', '/voice/text', {
        headers: user.headers,
        body: { text: '   ' },
      });
      const long = await harness.json('POST', '/voice/text', {
        headers: user.headers,
        body: { text: 'a'.repeat(501) },
      });

      expect(empty.status).toBe(400);
      expect(long.status).toBe(400);
    });
  });

  it('bez dopasowania oddaje samą transkrypcję i powód', async () => {
    const { layers } = stubLayers('zrobiłem coś tam', {
      exerciseIndex: null,
      weightKg: null,
      reps: null,
      reason: 'Nie wiem, o które ćwiczenie chodzi',
    });
    const harness = await createHarness({ voice: layers });
    const user = await harness.signUp('bezdopasowania@example.com');
    await harness.json('POST', '/exercises', {
      headers: user.headers,
      body: { name: 'Deska', loggingType: 'bodyweight_time', primaryTagId: tagId('abs') },
    });

    const response = await harness.request('/voice/set', {
      method: 'POST',
      headers: user.headers,
      body: recording(),
    });
    const body = (await response.json()) as VoiceSetResponse;

    expect(response.status).toBe(200);
    expect(body.match).toBeNull();
    expect(body.reason).toBe('Nie wiem, o które ćwiczenie chodzi');

    await harness.close();
  });

  it('nowe konto bez ćwiczeń nie pyta modelu', async () => {
    const { layers, recorded } = stubLayers('wyciskanie na osiem');
    const harness = await createHarness({ voice: layers });
    const user = await harness.signUp('pustekonto@example.com');

    const response = await harness.request('/voice/set', {
      method: 'POST',
      headers: user.headers,
      body: recording(),
    });
    const body = (await response.json()) as VoiceSetResponse;

    expect(response.status).toBe(200);
    expect(body.match).toBeNull();
    expect(recorded.last).toBeNull();

    await harness.close();
  });

  it('awaria dostawcy kończy się 503, a nie 500', async () => {
    const layers: VoiceLayers = {
      transcriber: {
        model: 'atrapa-whisper',
        transcribe: () => Promise.reject(new Error('Transkrypcja odpowiedziała 429')),
      },
      interpreter: {
        model: 'atrapa-llm',
        interpret: () => Promise.reject(new Error('nie powinno dojść tutaj')),
      },
    };
    const harness = await createHarness({ voice: layers });
    const user = await harness.signUp('awaria@example.com');

    const response = await harness.request('/voice/set', {
      method: 'POST',
      headers: user.headers,
      body: recording(),
    });

    expect(response.status).toBe(503);

    await harness.close();
  });

  it('przy wyłączonym dyktowaniu oba wejścia oddają 503', async () => {
    const harness = await createHarness();
    const user = await harness.signUp('wylaczone@example.com');

    const audio = await harness.request('/voice/set', {
      method: 'POST',
      headers: user.headers,
      body: recording(),
    });
    const text = await harness.json('POST', '/voice/text', {
      headers: user.headers,
      body: { text: 'wyciskanie na osiem' },
    });

    expect(audio.status).toBe(503);
    expect(text.status).toBe(503);

    await harness.close();
  });

  it('bez transkrypcji znika samo nagranie — opis z klawiatury działa dalej', async () => {
    // To jest stan wdrożenia bez klucza transkrypcji: mikrofon nie ma czym
    // działać, ale klawiatura Androida ma własny i nic od nas nie potrzebuje.
    const { layers } = stubLayers('nieużywane');
    const harness = await createHarness({ voice: { ...layers, transcriber: null } });
    const user = await harness.signUp('bezmikrofonu@example.com');
    await harness.json('POST', '/sets', {
      headers: user.headers,
      body: {
        exerciseId: BENCH,
        performedOn: '2026-08-10',
        weightG: 80_000,
        reps: 8,
        durationS: null,
        distanceM: null,
      },
    });

    const audio = await harness.request('/voice/set', {
      method: 'POST',
      headers: user.headers,
      body: recording(),
    });
    const text = await harness.json<VoiceSetResponse>('POST', '/voice/text', {
      headers: user.headers,
      body: { text: 'wyciskanie 82,5 na osiem' },
    });

    expect(audio.status).toBe(503);
    expect(text.status).toBe(200);
    expect(text.body.match).toMatchObject({ exerciseId: BENCH });

    await harness.close();
  });
});
