/**
 * Bufor ostatnich logów aplikacji — do dołączenia przy zgłoszeniu zwrotnym.
 *
 * Aplikacja sama prawie nigdy nie woła `console.*` wprost: błędy trafiają do
 * stanu ekranu (`problem`, `setDropIndex`…), nie na konsolę. To, co tu naprawdę
 * ląduje, to ostrzeżenia i błędy React Native, Hermes i bibliotek — czyli
 * dokładnie to, czego nie widać z poziomu ekranu, a co bywa jedynym śladem po
 * awarii, gdy ktoś zgłasza „coś nie działa" bez dalszych szczegółów.
 *
 * Bufor jest w pamięci i ginie z każdym zamknięciem aplikacji — to jest w
 * porządku, bo służy wyłącznie do opisania *bieżącej* sesji w zgłoszeniu, a nie
 * do trwałej diagnostyki.
 */

import {
  FEEDBACK_LOG_LIMIT,
  FEEDBACK_LOG_MESSAGE_MAX_LENGTH,
  type FeedbackLogEntry,
  type FeedbackLogLevel,
} from '@alphapump/core';

export type AppLogLevel = FeedbackLogLevel;
export type AppLogEntry = FeedbackLogEntry;

/**
 * Ile wpisów trzyma bufor. Ta sama stała, którą serwer sprawdza przy
 * `POST /feedback` — jedna wartość, nie dwie spięte komentarzem.
 */
export const RECENT_LOG_LIMIT = FEEDBACK_LOG_LIMIT;

const MESSAGE_MAX_LENGTH = FEEDBACK_LOG_MESSAGE_MAX_LENGTH;

const buffer: AppLogEntry[] = [];

function formatArgument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/** Dopisuje wpis do bufora, przycinając go do ostatnich `RECENT_LOG_LIMIT`. */
export function recordLog(level: AppLogLevel, args: readonly unknown[]): void {
  const message = args.map(formatArgument).join(' ').slice(0, MESSAGE_MAX_LENGTH);
  buffer.push({ level, message, at: new Date().toISOString() });
  if (buffer.length > RECENT_LOG_LIMIT) buffer.splice(0, buffer.length - RECENT_LOG_LIMIT);
}

/** Kopia bufora, od najstarszego do najnowszego wpisu. */
export function recentLogs(): AppLogEntry[] {
  return [...buffer];
}

/** Tylko do testów — produkcyjny bufor żyje tak długo, jak aplikacja. */
export function clearLogs(): void {
  buffer.length = 0;
}

/** Znacznik na opakowanej metodzie — po nim rozpoznajemy, że dany `console` już ma przechwycenie. */
const CAPTURED = Symbol('alphapump-log-capture');

/**
 * Podpina `recordLog` pod `console.log/warn/error`, zachowując oryginalne
 * zachowanie (nadal widać je w Metro). Idempotentne **per obiekt konsoli** —
 * znacznik siedzi na opakowanej metodzie, a nie w osobnej fladze modułu, więc
 * powtórne wywołanie przy fast-refreshu nie podłącza warstwy na warstwie, a
 * testy mogą swobodnie instalować własną atrapę bez wpływu na resztę.
 */
export function installConsoleCapture(target: Console = console): void {
  (['log', 'warn', 'error'] as const).forEach((level) => {
    const current = target[level] as { [CAPTURED]?: true };
    if (current[CAPTURED] === true) return;

    const original = target[level].bind(target);
    const wrapped = (...args: unknown[]) => {
      recordLog(level, args);
      original(...args);
    };
    wrapped[CAPTURED] = true as const;
    target[level] = wrapped;
  });
}
