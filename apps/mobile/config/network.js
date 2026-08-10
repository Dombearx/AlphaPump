/**
 * Adres API a wyjątki od szyfrowania ruchu.
 *
 * MVP świadomie nie wystawia certyfikatu: API działa po HTTP wewnątrz sieci
 * NetBird, a WireGuard pod spodem daje dokładnie to, co dałby TLS — szyfrowanie
 * i wzajemne uwierzytelnienie peerów. Obie platformy blokują jednak zwykłe HTTP
 * (iOS przez App Transport Security, Android od API 28), więc wyjątek musi być
 * w konfiguracji aplikacji od pierwszego dnia.
 *
 * Wyjątek jest **zawężony do jednego hosta**. Globalne `NSAllowsArbitraryLoads`
 * albo `usesCleartextTraffic` otwierałoby plaintext na cały świat po to, żeby
 * dogadać się z jedną maszyną w VPN-ie.
 *
 * Plik jest zwykłym modułem CommonJS, a nie TypeScriptem, bo czyta go loader
 * konfiguracji Expo — ten transpiluje wyłącznie sam `app.config`, a importy
 * względne ładuje już zwykłym `require`. Testy (`tests/network.test.ts`)
 * traktują go tak samo jak resztę kodu.
 */

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Czy host jest adresem liczbowym.
 * @param {string} host
 * @returns {boolean}
 */
function isIpAddress(host) {
  return IPV4.test(host) || host.includes(':');
}

/**
 * Host, dla którego wolno rozmawiać plaintextem. `null`, gdy API idzie po HTTPS.
 * @param {string} apiUrl
 * @returns {string | null}
 */
function cleartextHost(apiUrl) {
  const url = new URL(apiUrl);
  return url.protocol === 'http:' ? url.hostname : null;
}

/**
 * Wyjątki ATS do `Info.plist`.
 *
 * Adres z samym IP nie wchodzi do `NSExceptionDomains` — iOS przyjmuje tam
 * wyłącznie nazwy domen, a wpisany adres liczbowy jest po cichu ignorowany.
 * Dla adresu IP wyjątek musi objąć sieci lokalne, co i tak jest zawężeniem
 * znacznie węższym niż globalne `NSAllowsArbitraryLoads`.
 *
 * @param {string} apiUrl
 * @returns {Record<string, unknown>}
 */
function atsExceptions(apiUrl) {
  const host = cleartextHost(apiUrl);
  if (host === null) return { NSAllowsArbitraryLoads: false };

  if (isIpAddress(host)) {
    return { NSAllowsArbitraryLoads: false, NSAllowsLocalNetworking: true };
  }

  return {
    NSAllowsArbitraryLoads: false,
    NSExceptionDomains: {
      [host]: {
        NSExceptionAllowsInsecureHTTPLoads: true,
        NSIncludesSubdomains: false,
      },
    },
  };
}

module.exports = { atsExceptions, cleartextHost, isIpAddress };
