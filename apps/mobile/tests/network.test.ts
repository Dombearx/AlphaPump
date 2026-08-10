/**
 * Wyjątki od szyfrowania ruchu.
 *
 * To jest ten fragment konfiguracji, który psuje się cicho: aplikacja buduje
 * się poprawnie, uruchamia poprawnie i dopiero pierwsze żądanie do API kończy
 * się niejasnym błędem sieci — na urządzeniu, nie w CI. Dlatego wyliczenie
 * wyjątków jest zwykłą funkcją i jest przetestowane.
 */

import { describe, expect, it } from 'vitest';
import { atsExceptions, cleartextHost, isIpAddress } from '../config/network';

describe('wyjątek cleartext', () => {
  it('wskazuje host, gdy API idzie po HTTP', () => {
    expect(cleartextHost('http://alphapump.netbird.local:3000')).toBe('alphapump.netbird.local');
  });

  it('nie robi wyjątku, gdy API idzie po HTTPS', () => {
    expect(cleartextHost('https://alphapump.example.com')).toBeNull();
  });
});

describe('wyjątki ATS', () => {
  it('nigdy nie otwiera plaintextu globalnie', () => {
    for (const url of ['http://alphapump.local:3000', 'http://100.64.0.1:3000', 'https://x.dev']) {
      expect(atsExceptions(url).NSAllowsArbitraryLoads).toBe(false);
    }
  });

  it('zawęża wyjątek do jednego hosta', () => {
    const exceptions = atsExceptions('http://alphapump.netbird.local:3000');
    expect(exceptions.NSExceptionDomains).toEqual({
      'alphapump.netbird.local': {
        NSExceptionAllowsInsecureHTTPLoads: true,
        NSIncludesSubdomains: false,
      },
    });
  });

  it('dla adresu IP sięga po wyjątek sieci lokalnej', () => {
    // iOS przyjmuje w `NSExceptionDomains` wyłącznie nazwy domen — wpisany tam
    // adres liczbowy jest po cichu ignorowany, więc wyjątek nie zadziałałby.
    const exceptions = atsExceptions('http://100.64.0.1:3000');
    expect(exceptions.NSAllowsLocalNetworking).toBe(true);
    expect(exceptions.NSExceptionDomains).toBeUndefined();
  });

  it('po HTTPS nie robi żadnego wyjątku', () => {
    expect(atsExceptions('https://alphapump.example.com')).toEqual({
      NSAllowsArbitraryLoads: false,
    });
  });

  it('rozpoznaje adresy liczbowe', () => {
    expect(isIpAddress('100.64.0.1')).toBe(true);
    expect(isIpAddress('fd00::1')).toBe(true);
    expect(isIpAddress('alphapump.local')).toBe(false);
  });
});
