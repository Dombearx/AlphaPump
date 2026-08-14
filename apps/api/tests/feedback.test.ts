/**
 * Zgłoszenia zwrotne — `POST /feedback`.
 *
 * Trzy rzeczy sprawdzane naprawdę, wszystkie na prawdziwym systemie plików
 * (świeży katalog tymczasowy z `harness.feedbackDir`, sprzątany po teście):
 *
 * 1. Zgłoszenie ląduje jako czytelny plik JSON, z nickiem i datą **wziętymi
 *    z sesji i zegara serwera**, nie z ciała żądania — inaczej dałoby się
 *    podpisać zgłoszenie cudzym nickiem.
 * 2. Trasa wymaga uwierzytelnienia jak reszta API.
 * 3. Walidacja odrzuca pusty tekst i nadmiar logów, zanim cokolwiek dotknie
 *    dysku.
 */

import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness, type TestUser } from './harness.js';

interface FeedbackFile {
  nickname: string;
  email: string;
  sentAt: string;
  message: string;
  logs: { level: string; message: string; at: string }[];
}

describe('POST /feedback', () => {
  let harness: Harness;
  let user: TestUser;

  beforeEach(async () => {
    harness = await createHarness();
    user = await harness.signUp('domin@example.com', 'haslo-testowe-123', 'Domin');
  });

  afterEach(async () => {
    await harness.close();
  });

  const readOnlyFeedbackFile = async (): Promise<FeedbackFile> => {
    const entries = await readdir(harness.feedbackDir);
    expect(entries).toHaveLength(1);
    const raw = await readFile(path.join(harness.feedbackDir, entries[0] as string), 'utf8');
    return JSON.parse(raw) as FeedbackFile;
  };

  it('zapisuje zgłoszenie jako plik z nickiem i datą z sesji, nie z ciała żądania', async () => {
    const response = await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: {
        message: 'Wykres nie pokazuje wartości nad słupkami.',
        // Serwer ma zignorować podszywanie się pod kogoś innego.
        nickname: 'ktoś-inny',
        logs: [{ level: 'error', message: 'TypeError: x is undefined', at: '2026-08-15T10:00:00.000Z' }],
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toEqual({ ok: true });

    const file = await readOnlyFeedbackFile();
    expect(file.nickname).toBe('Domin');
    expect(file.email).toBe('domin@example.com');
    expect(file.message).toBe('Wykres nie pokazuje wartości nad słupkami.');
    expect(file.logs).toEqual([
      { level: 'error', message: 'TypeError: x is undefined', at: '2026-08-15T10:00:00.000Z' },
    ]);
    // Data jest prawdziwym ISO wystawionym przez serwer, nie cokolwiek z żądania.
    expect(new Date(file.sentAt).toISOString()).toBe(file.sentAt);
  });

  it('działa bez logów — nie każde zgłoszenie ma bufor do dołączenia', async () => {
    const response = await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: { message: 'Poproszę ciemniejszy pomarańcz.' },
    });

    expect(response.status).toBe(201);
    const file = await readOnlyFeedbackFile();
    expect(file.logs).toEqual([]);
  });

  it('wymaga uwierzytelnienia', async () => {
    const response = await harness.json('POST', '/feedback', {
      body: { message: 'Zgłoszenie bez sesji' },
    });
    expect(response.status).toBe(401);
    expect(await readdir(harness.feedbackDir)).toEqual([]);
  });

  it('odrzuca pusty tekst zanim cokolwiek zapisze', async () => {
    const response = await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: { message: '   ' },
    });
    expect(response.status).toBe(400);
    expect(await readdir(harness.feedbackDir)).toEqual([]);
  });

  it('odrzuca więcej niż 30 wpisów logu', async () => {
    const logs = Array.from({ length: 31 }, (_, index) => ({
      level: 'log',
      message: `wpis ${String(index)}`,
      at: '2026-08-15T10:00:00.000Z',
    }));

    const response = await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: { message: 'Za dużo logów', logs },
    });
    expect(response.status).toBe(400);
  });

  it('dwa zgłoszenia tego samego użytkownika trafiają do dwóch osobnych plików', async () => {
    await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: { message: 'Pierwsze' },
    });
    await harness.json('POST', '/feedback', {
      headers: user.headers,
      body: { message: 'Drugie' },
    });

    expect(await readdir(harness.feedbackDir)).toHaveLength(2);
  });
});
