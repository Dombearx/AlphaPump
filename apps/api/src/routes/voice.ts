/**
 * Dyktowanie serii głosem — endpoint dla ekranu z mikrofonem.
 *
 * Jedno nagranie w żądaniu, jedna rozpoznana seria w odpowiedzi. Endpoint
 * **niczego nie zapisuje**: oddaje wypełniony formularz, a serię zapisuje
 * dopiero człowiek, tym samym `POST /sets` albo tą samą synchronizacją co
 * zawsze. To nie jest ostrożność — to jest cała reguła tej funkcji. Model, który
 * dopisuje serie sam, myli się w liczbie, o której użytkownik dowiaduje się
 * miesiąc później, przy wykresie.
 *
 * `POST`, a nie `GET` jak przy podobnych ćwiczeniach, bo w żądaniu jedzie plik.
 * Zapisu stanu nie ma w tym mimo wszystko żadnego.
 *
 * Ciało jest `multipart/form-data`, a nie base64 w JSON-ie: nagranie idzie wtedy
 * bajt w bajt, bez trzydziestu procent narzutu doliczanych dokładnie tam, gdzie
 * telefon stoi na cudzym wi-fi albo na LTE.
 */

import { voiceSetResponseSchema } from '@alphapump/core';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppDependencies, AppEnvironment } from '../context.js';
import { ApiError, badRequest, unavailable } from '../errors.js';
import { logger } from '../logger.js';
import type { RouteSpec } from '../openapi.js';
import { NO_VOICE, dictateSet, voiceAvailable } from '../voice/index.js';

/**
 * Formaty, które przyjmujemy. Lista jest po to, żeby odbić pomyłkę wcześnie —
 * plik `.png` wysłany przez pomyłkę kosztowałby wywołanie u dostawcy
 * transkrypcji i wrócił jego komunikatem błędu zamiast naszym.
 *
 * Rozpoznajemy po typie MIME **albo** po rozszerzeniu, bo Android potrafi oddać
 * nagranie z `application/octet-stream` w nagłówku i sensowną nazwą pliku.
 */
const AUDIO_EXTENSIONS = ['m4a', 'mp4', 'mp3', 'wav', 'webm', 'ogg', 'flac', 'aac', 'mpga'];

/** Opis ciała żądania dla OpenAPI — plik jedzie jako jedno pole formularza. */
const voiceRequestSchema = z.object({
  audio: z.string().meta({
    format: 'binary',
    description: 'Nagranie: m4a, mp4, mp3, wav, webm, ogg, flac lub aac.',
  }),
});

export const voiceRoutes: RouteSpec[] = [
  {
    method: 'post',
    path: '/voice/set',
    summary: 'Seria podyktowana głosem',
    description:
      'Nagranie zamieniane na tekst, a tekst — razem z listą ćwiczeń użytkownika ' +
      'i jego ostatnimi seriami — podawany modelowi, który wskazuje ćwiczenie ' +
      'z tej listy i wyciąga pomiary. Endpoint niczego nie zapisuje: oddaje ' +
      'wypełniony formularz do zatwierdzenia. Model nie tworzy nowych ćwiczeń — ' +
      'gdy żadne nie pasuje, `match` jest pusty, a `reason` mówi dlaczego. ' +
      'Przy wyłączonym dyktowaniu (brak klucza transkrypcji albo `VOICE_ENABLED=false`) ' +
      'odpowiedzią jest 503.',
    tag: 'serie',
    security: 'user',
    body: voiceRequestSchema,
    bodyMediaType: 'multipart/form-data',
    responses: [
      {
        status: 200,
        description: 'Transkrypcja i rozpoznana seria (albo sama transkrypcja)',
        schema: voiceSetResponseSchema,
      },
      { status: 400, description: 'Brak nagrania albo format, którego nie przyjmujemy' },
      { status: 503, description: 'Dyktowanie wyłączone w tym wdrożeniu' },
    ],
  },
];

function isAudio(file: File): boolean {
  if (file.type.startsWith('audio/')) return true;
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return AUDIO_EXTENSIONS.includes(extension);
}

export function createVoiceRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();
  const layers = dependencies.voice ?? NO_VOICE;

  router.post('/voice/set', async (context) => {
    if (!voiceAvailable(layers)) {
      throw unavailable('Dyktowanie serii jest w tym wdrożeniu wyłączone');
    }

    // Bez `parseBody` z opcjami: interesuje nas jedno pole i wyłącznie plik.
    // Wartość, która plikiem nie jest, znaczy tyle samo co jej brak.
    const body = await context.req.parseBody();
    const audio = body.audio;
    if (!(audio instanceof File) || audio.size === 0) {
      throw badRequest('Żądanie nie zawiera nagrania w polu „audio"');
    }
    if (!isAudio(audio)) {
      throw badRequest(`Formatu „${audio.type || audio.name}" nie przyjmujemy jako nagrania`);
    }

    const principal = context.get('principal');

    try {
      return context.json(
        await dictateSet(dependencies.db, layers, {
          userId: principal.id,
          recording: {
            data: new Uint8Array(await audio.arrayBuffer()),
            mediaType: audio.type.length > 0 ? audio.type : 'audio/m4a',
            fileName: audio.name.length > 0 ? audio.name : 'nagranie.m4a',
          },
        }),
      );
    } catch (error) {
      if (error instanceof ApiError) throw error;

      // Awaria dostawcy transkrypcji albo modelu to 503, a nie 500: to nie jest
      // błąd w naszym kodzie, a ekran ma powiedzieć „spróbuj jeszcze raz",
      // a nie „zgłoś to komuś". Powód zostaje w logu, bo w komunikacie dla
      // użytkownika nie ma z niego pożytku.
      logger.warn('dyktowanie serii nie powiodło się', {
        requestId: context.get('requestId'),
        userId: principal.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw unavailable('Nie udało się rozpoznać nagrania — spróbuj jeszcze raz');
    }
  });

  return router;
}
