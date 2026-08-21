/**
 * Logowanie serwera.
 *
 * Dwa powody, żeby to w ogóle istniało zamiast gołego `console`.
 *
 * Pierwszy: reguła ESLint `no-console` dopuszcza wyłącznie `warn` i `error`,
 * więc komunikaty informacyjne — „API słucha", podsumowanie seeda — szły jako
 * ostrzeżenia. Poziom logu narzuciło narzędzie, a nie treść, i po jakimś czasie
 * „ostrzeżenie" przestaje cokolwiek znaczyć.
 *
 * Drugi: przy zgłoszeniu „nie zapisała mi się seria o 19:40" nie było czego
 * szukać w `docker logs`. Wpis w JSON-ie z identyfikatorem żądania daje po czym
 * — ten sam identyfikator wraca do klienta nagłówkiem `x-request-id`
 * i w komunikacie błędu, więc użytkownik może go po prostu przepisać.
 *
 * Format jest jedną linią JSON-a na wpis, bo tak czyta się je i okiem
 * (`docker logs | jq`), i czymkolwiek, co kiedyś stanie obok.
 */

/* eslint-disable no-console -- to jest ten jeden moduł, który woła konsolę */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Poziom ze środowiska; nieznana wartość znaczy `info`, a nie awarię startu. */
function configuredLevel(raw: string | undefined): LogLevel {
  const value = raw?.trim().toLowerCase();
  return value === 'debug' || value === 'info' || value === 'warn' || value === 'error'
    ? value
    : 'info';
}

export interface Logger {
  debug(message: string, fields?: Record<string, unknown>): void;
  info(message: string, fields?: Record<string, unknown>): void;
  warn(message: string, fields?: Record<string, unknown>): void;
  error(message: string, fields?: Record<string, unknown>): void;
  /** Logger dopisujący stałe pola — np. identyfikator żądania. */
  with(fields: Record<string, unknown>): Logger;
}

export function createLogger(
  bound: Record<string, unknown> = {},
  level: LogLevel = configuredLevel(process.env.LOG_LEVEL),
): Logger {
  const write = (entry: LogLevel, message: string, fields?: Record<string, unknown>): void => {
    if (ORDER[entry] < ORDER[level]) return;

    const line = JSON.stringify({
      at: new Date().toISOString(),
      level: entry,
      message,
      ...bound,
      ...fields,
    });

    // `error` na stderr, reszta na stdout — tak, jak spodziewa się tego każdy,
    // kto kiedykolwiek przekierował jeden strumień gdzie indziej.
    if (entry === 'error') console.error(line);
    else console.log(line);
  };

  return {
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    with: (fields) => createLogger({ ...bound, ...fields }, level),
  };
}

/** Logger procesu — dla miejsc poza obsługą żądania (start serwera, zadania). */
export const logger = createLogger();
