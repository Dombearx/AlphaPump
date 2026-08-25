/**
 * Bufor logów aplikacji — czyste reguły, bez sieci i bez ekranu.
 *
 * Trzy rzeczy sprawdzane naprawdę: bufor trzyma tylko ostatnie `RECENT_LOG_LIMIT`
 * wpisów, `recentLogs()` oddaje kopię (nie da się jej popsuć z zewnątrz), a
 * przechwycenie konsoli nie ucisza oryginalnego `console.*` — Metro ma nadal co
 * pokazać.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearLogs,
  installConsoleCapture,
  installGlobalErrorCapture,
  recentLogs,
  recordLog,
  RECENT_LOG_LIMIT,
} from '../src/app-log';

beforeEach(() => {
  clearLogs();
});

describe('bufor logów', () => {
  it('zapisuje poziom, wiadomość i znacznik czasu', () => {
    recordLog('warn', ['coś się nie zgadza']);

    const [entry] = recentLogs();
    expect(entry).toMatchObject({ level: 'warn', message: 'coś się nie zgadza' });
    expect(new Date(entry!.at).toISOString()).toBe(entry!.at);
  });

  it('skleja wiele argumentów spacją, tak jak console.log', () => {
    recordLog('log', ['seria', 42, 'zapisana']);
    expect(recentLogs()[0]?.message).toBe('seria 42 zapisana');
  });

  it('serializuje obiekty i błędy do czytelnego napisu', () => {
    recordLog('log', [{ id: 1 }]);
    recordLog('error', [new TypeError('coś jest undefined')]);

    const [asObject, asError] = recentLogs();
    expect(asObject?.message).toBe('{"id":1}');
    expect(asError?.message).toBe('TypeError: coś jest undefined');
  });

  it('trzyma wyłącznie ostatnie RECENT_LOG_LIMIT wpisów', () => {
    for (let index = 0; index < RECENT_LOG_LIMIT + 5; index += 1) {
      recordLog('log', [`wpis ${String(index)}`]);
    }

    const logs = recentLogs();
    expect(logs).toHaveLength(RECENT_LOG_LIMIT);
    // Najstarsze pięć odpadło, zostają najnowsze — w kolejności chronologicznej.
    expect(logs[0]?.message).toBe('wpis 5');
    expect(logs.at(-1)?.message).toBe(`wpis ${String(RECENT_LOG_LIMIT + 4)}`);
  });

  it('oddaje kopię — modyfikacja wyniku nie rusza bufora', () => {
    recordLog('log', ['jeden']);
    const logs = recentLogs();
    logs.pop();
    expect(recentLogs()).toHaveLength(1);
  });
});

describe('przechwycenie konsoli', () => {
  it('dopisuje do bufora i woła oryginalną metodę', () => {
    const fakeConsole = {
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Console;

    installConsoleCapture(fakeConsole);
    fakeConsole.warn('uwaga');

    expect(recentLogs()).toEqual([expect.objectContaining({ level: 'warn', message: 'uwaga' })]);
  });

  it('jest idempotentne — drugie wywołanie nie dokłada kolejnej warstwy', () => {
    const fakeConsole = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Console;

    installConsoleCapture(fakeConsole);
    const wrappedOnce = fakeConsole.log;
    installConsoleCapture(fakeConsole);

    expect(fakeConsole.log).toBe(wrappedOnce);
  });
});

describe('przechwycenie globalnych błędów (ErrorUtils)', () => {
  function fakeErrorUtils() {
    let handler: (error: unknown, isFatal?: boolean) => void = vi.fn();
    return {
      getGlobalHandler: () => handler,
      setGlobalHandler: (next: (error: unknown, isFatal?: boolean) => void) => {
        handler = next;
      },
    };
  }

  it('dopisuje do bufora i woła oryginalny handler — także dla crasha bez console.*', () => {
    const errorUtils = fakeErrorUtils();
    const original = errorUtils.getGlobalHandler();

    installGlobalErrorCapture({ ErrorUtils: errorUtils });
    const error = new Error('bum');
    errorUtils.getGlobalHandler()(error, true);

    expect(recentLogs()).toEqual([
      expect.objectContaining({ level: 'error', message: expect.stringContaining('Fatal') }),
    ]);
    expect(original).toHaveBeenCalledWith(error, true);
  });

  it('oznacza błąd jako niekrytyczny, gdy isFatal jest false', () => {
    const errorUtils = fakeErrorUtils();

    installGlobalErrorCapture({ ErrorUtils: errorUtils });
    errorUtils.getGlobalHandler()(new Error('drobiazg'), false);

    expect(recentLogs().at(-1)?.message).toContain('Unhandled');
  });

  it('bez ErrorUtils w globalnym obiekcie nic nie robi (np. w środowisku testów)', () => {
    expect(() => installGlobalErrorCapture({})).not.toThrow();
  });

  it('jest idempotentne — drugie wywołanie nie owija handlera podwójnie', () => {
    const errorUtils = fakeErrorUtils();

    installGlobalErrorCapture({ ErrorUtils: errorUtils });
    const wrappedOnce = errorUtils.getGlobalHandler();
    installGlobalErrorCapture({ ErrorUtils: errorUtils });

    expect(errorUtils.getGlobalHandler()).toBe(wrappedOnce);
  });
});
