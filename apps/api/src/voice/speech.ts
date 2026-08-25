/**
 * Transkrypcja przez usługę mówiącą protokołem OpenAI.
 *
 * Jedno żądanie `multipart/form-data` na `POST …/audio/transcriptions` i jeden
 * napis z powrotem. Adres jest w konfiguracji, a nie w kodzie, i to jest cała
 * decyzja tego pliku: zgłoszenie podawało Groqa jako **przykład**, nie jako
 * wybór, a ten sam protokół obsługuje też OpenAI i lokalny `whisper.cpp` za
 * cienkim serwerkiem. Zmiana dostawcy jest wtedy zmianą dwóch zmiennych
 * środowiskowych, a nie zmianą kodu.
 *
 * Wywołanie wychodzi **wyłącznie stąd**, czyli z backendu — z tego samego
 * powodu, dla którego stąd wychodzą embeddingi i tłumaczenia: klucz nie może
 * trafić do binarki aplikacji mobilnej, bo ta jest w praktyce publiczna.
 *
 * ## Dlaczego bez SDK dostawcy
 *
 * Bo całe API, którego tu używamy, to jedno pole formularza i jedno pole
 * odpowiedzi. Paczka SDK przywiązałaby nas do dostawcy dokładnie w tym miejscu,
 * w którym zgłoszenie prosiło o swobodę wyboru.
 */

import { z } from 'zod';
import type { VoiceConfig } from '../config.js';
import type { Transcriber, VoiceRecording } from './transcriber.js';

/**
 * Odpowiedź w formacie `json` — jedno pole. Walidujemy ją mimo prostoty, bo
 * odpowiedź dostawcy jest danymi z zewnątrz: pod adresem z konfiguracji może
 * stać cokolwiek, łącznie ze stroną błędu proxy zwracaną ze statusem 200.
 */
const transcriptionSchema = z.object({ text: z.string() });

export function createHttpTranscriber(config: VoiceConfig | null): Transcriber | null {
  if (config === null) return null;

  return {
    model: config.speechModel,

    async transcribe(recording: VoiceRecording): Promise<string> {
      const form = new FormData();
      form.set('model', config.speechModel);
      // `response_format=json` jest domyślne u Groqa, ale nie u wszystkich —
      // a `verbose_json` i `text` mają inny kształt odpowiedzi. Podane wprost,
      // bo domyślna wartość cudzej usługi nie jest naszą decyzją.
      form.set('response_format', 'json');
      form.set(
        'file',
        new File([recording.data], recording.fileName, { type: recording.mediaType }),
      );

      const response = await fetch(config.speechUrl, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.speechApiKey}` },
        body: form,
        signal: AbortSignal.timeout(config.timeoutMs),
      });

      if (!response.ok) {
        // Treść odpowiedzi błędu bywa jedynym miejscem, w którym dostawca mówi
        // „nagranie za długie" albo „nieznany format" — ale bywa też stroną
        // HTML, więc do logu wchodzi przycięta.
        const detail = (await response.text()).slice(0, 200);
        throw new Error(`Transkrypcja odpowiedziała ${String(response.status)}: ${detail}`);
      }

      const parsed = transcriptionSchema.safeParse(await response.json());
      if (!parsed.success) throw new Error('Odpowiedź transkrypcji ma nieznany kształt');

      return parsed.data.text.trim();
    },
  };
}
