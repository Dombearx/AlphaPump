/**
 * Wysłanie nagrania na serwer i odebranie rozpoznanej serii.
 *
 * Czwarte — i jedyne wychodzące poza odczyt — żądanie sieciowe w aplikacji.
 * Reszta pisze do bazy lokalnej i czeka na synchronizację; tutaj nie ma czego
 * odłożyć na później: nagranie bez odpowiedzi serwera jest plikiem dźwiękowym,
 * a nie serią. Dyktowanie **wymaga łączności** i to jest jego jedyne odstępstwo
 * od reguły „ekran nigdy nie czeka na sieć" — wymuszone tym, że model stoi po
 * drugiej stronie VPN-a, a klucze do dostawców nie mają prawa być w binarce
 * aplikacji.
 *
 * Zapisu tym żądaniem nie ma żadnego: serwer oddaje wypełniony formularz, a
 * serię zapisuje dopiero człowiek — lokalnie, tą samą drogą co zawsze.
 *
 * Klasy błędów są te same co przy synchronizacji i przy odczycie rekordów
 * globalnych, więc ekran dyktowania rozpoznaje „jesteś poza VPN-em" tak samo jak
 * odznaka synchronizacji.
 *
 * Adres API i sesję moduł dostaje z zewnątrz, a nie czyta sam — tak samo jak
 * `read-only.ts` i z tego samego powodu: inaczej nie dałoby się go przetestować
 * poza urządzeniem.
 */

import { voiceSetResponseSchema, type VoiceSetResponse } from '@alphapump/core';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../sync/transport';

/**
 * Ile czekamy na odpowiedź. Znacznie dłużej niż przy odczytach: po drugiej
 * stronie jedzie transkrypcja **i** model, a użytkownik stoi z telefonem
 * w ręku i wie, na co czeka. Krótszy limit zamieniłby wolniejszą odpowiedź
 * w brak odpowiedzi.
 */
const TIMEOUT_MS = 30_000;

/** Nagranie z dysku telefonu — tyle, ile potrzebuje `FormData`. */
export interface Recording {
  uri: string;
  name: string;
  mimeType: string;
}

/** Typy MIME formatów, w których nagrywarka potrafi oddać plik. */
const AUDIO_TYPES: Record<string, string> = {
  m4a: 'audio/m4a',
  mp4: 'audio/mp4',
  '3gp': 'audio/3gpp',
  wav: 'audio/wav',
  webm: 'audio/webm',
  caf: 'audio/x-caf',
};

/**
 * Plik z dysku telefonu w postaci gotowej do wysłania.
 *
 * Typ MIME wyprowadzamy z rozszerzenia, bo nagrywarka oddaje sam adres.
 * Serwer rozpoznaje format i po typie, i po nazwie, ale `application/octet-stream`
 * kazałby mu zgadywać po nazwie — a nazwa pliku tymczasowego bywa losowa.
 *
 * Funkcja jest tutaj, a nie przy ustawieniach nagrywania, bo to ten moduł wie,
 * czego potrzebuje żądanie — i dlatego da się ją sprawdzić bez mikrofonu.
 */
export function recordingFrom(uri: string): Recording {
  const extension = uri.split('.').pop()?.toLowerCase() ?? '';

  return {
    uri,
    name: `nagranie.${extension.length > 0 ? extension : 'm4a'}`,
    mimeType: AUDIO_TYPES[extension] ?? 'audio/m4a',
  };
}

export interface VoiceClientOptions {
  /** Adres API bez końcowego ukośnika. */
  baseUrl: string;
  /** Ciasteczko sesji; funkcja, bo sesja zmienia się częściej niż klient. */
  cookie: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface VoiceClient {
  dictateSet(recording: Recording): Promise<VoiceSetResponse>;
}

/**
 * Serwer wie, że dyktowanie jest wyłączone — i mówi to statusem 503. Osobna
 * klasa, bo ekran ma wtedy powiedzieć „to wdrożenie nie ma dyktowania", a nie
 * „spróbuj jeszcze raz": ponawianie nigdy nie pomoże.
 */
export class VoiceUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoiceUnavailableError';
  }
}

export function createVoiceClient(options: VoiceClientOptions): VoiceClient {
  const call = options.fetchImpl ?? fetch;

  return {
    async dictateSet(recording) {
      const form = new FormData();
      // React Native wysyła plik z dysku po jego adresie `file://` — trójka
      // `{ uri, name, type }` jest tu odpowiednikiem `File` z przeglądarki.
      // Rzutowanie jest konieczne, bo typy DOM-owe takiego wariantu nie znają.
      form.append('audio', {
        uri: recording.uri,
        name: recording.name,
        type: recording.mimeType,
      } as unknown as Blob);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);

      let response: Response;
      try {
        response = await call(`${options.baseUrl}/voice/set`, {
          method: 'POST',
          signal: controller.signal,
          // Bez `content-type`: granicę części `multipart` wylicza sam
          // `FormData`, a nagłówek wpisany ręcznie ją nadpisuje i serwer nie ma
          // czym rozdzielić pól.
          headers: { cookie: options.cookie() },
          body: form,
        });
      } catch (error) {
        throw new SyncOfflineError(error);
      } finally {
        clearTimeout(timeout);
      }

      if (response.status === 401 || response.status === 403) throw new SyncAuthError();
      if (response.status === 503) {
        throw new VoiceUnavailableError('Dictation is switched off on this server');
      }
      if (!response.ok) {
        throw new SyncServerError(`Server responded ${String(response.status)}`, response.status);
      }

      let body: unknown;
      try {
        body = (await response.json()) as unknown;
      } catch (error) {
        throw new SyncServerError(`Server response isn't valid JSON: ${String(error)}`);
      }

      const parsed = voiceSetResponseSchema.safeParse(body);
      if (!parsed.success) throw new SyncServerError('Dictation response has an unknown shape');
      return parsed.data;
    },
  };
}
