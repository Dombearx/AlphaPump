/**
 * Zamiana nagrania na tekst — granica między naszym kodem a dostawcą.
 *
 * Interfejs jest jednym zdaniem („dostajesz bajty, oddajesz tekst") i to jest
 * cała jego zawartość. Dostawca stoi za nim, po drugiej stronie: `speech.ts`
 * mówi protokołem OpenAI, którym mówią Groq, OpenAI i lokalne `whisper.cpp` za
 * cienkim serwerkiem — a testy podstawiają tu funkcję zwracającą napis
 * i sprawdzają **całą** resztę przepływu bez sieci i bez klucza.
 *
 * `null` zamiast atrapy w miejscu dostawcy znaczy „nie ma czym transkrybować",
 * czyli wyłączone dyktowanie. Ta sama konwencja co przy tłumaczu nazw i przy
 * warstwach wykrywania duplikatów.
 */

/** Nagranie tak, jak przyszło z telefonu. */
export interface VoiceRecording {
  data: Uint8Array;
  /** Typ MIME z żądania — dostawcy rozpoznają format także po nazwie pliku. */
  mediaType: string;
  fileName: string;
}

export interface Transcriber {
  /** Nazwa modelu — wchodzi do logu, żeby dało się porównać jakość między nimi. */
  model: string;
  transcribe(recording: VoiceRecording): Promise<string>;
}
