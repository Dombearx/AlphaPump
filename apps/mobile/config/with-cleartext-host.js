/**
 * Wyjątek cleartext dla Androida — zawężony do jednego hosta.
 *
 * `expo-build-properties` daje wyłącznie `usesCleartextTraffic`, czyli
 * przełącznik „plaintext wszędzie". Otwieranie HTTP na cały świat po to, żeby
 * dogadać się z jedną maszyną w VPN-ie, jest kosztem, którego nie trzeba
 * ponosić: Android ma do tego `networkSecurityConfig`, w którym wyjątek dotyczy
 * wskazanej domeny i tylko jej.
 *
 * Wtyczka robi dwie rzeczy: zapisuje `res/xml/network_security_config.xml`
 * z jednym wyjątkiem i wskazuje ten plik w `<application>` manifestu. Reszta
 * ruchu — w tym pobieranie `idToken` od Google — dalej wymaga HTTPS.
 */

const { promises: fs } = require('node:fs');
const { dirname, join } = require('node:path');
const { AndroidConfig, withAndroidManifest, withDangerousMod } = require('expo/config-plugins');

const RESOURCE = 'network_security_config';

/**
 * @param {string} host
 * @returns {string}
 */
function documentFor(host) {
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Plik generowany przez config/with-cleartext-host.js — nie edytuj ręcznie. -->
<network-security-config>
  <base-config cleartextTrafficPermitted="false" />
  <domain-config cleartextTrafficPermitted="true">
    <domain includeSubdomains="false">${host}</domain>
  </domain-config>
</network-security-config>
`;
}

/**
 * @type {import('expo/config-plugins').ConfigPlugin<{ host: string | null }>}
 */
const withCleartextHost = (config, { host }) => {
  if (host === null) return config;

  const withResource = withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const path = join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/res/xml',
        `${RESOURCE}.xml`,
      );
      await fs.mkdir(dirname(path), { recursive: true });
      await fs.writeFile(path, documentFor(host), 'utf8');
      return modConfig;
    },
  ]);

  return withAndroidManifest(withResource, (modConfig) => {
    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(modConfig.modResults);
    application.$['android:networkSecurityConfig'] = `@xml/${RESOURCE}`;
    // Globalne zezwolenie zostaje wyłączone — wyjątek robi wyłącznie plik XML.
    application.$['android:usesCleartextTraffic'] = 'false';
    return modConfig;
  });
};

module.exports = withCleartextHost;
module.exports.withCleartextHost = withCleartextHost;
