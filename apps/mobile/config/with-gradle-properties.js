/**
 * Wpisy w `android/gradle.properties`, których generator nie ustawia tak, jak
 * potrzebujemy.
 *
 * Plik generuje `expo prebuild`, z wartościami z szablonu React Native. Dwie
 * z nich są dla tego projektu nietrafione — lista architektur i pamięć dla
 * maszyny wirtualnej Javy — a że projekt natywny powstaje na nowo przy każdym
 * wydaniu, poprawianie ich po fakcie byłoby łataniem wyniku generatora zamiast
 * zmiany jego wejścia. Ten sam argument stoi przy `with-cleartext-host.js`
 * obok i przy podpisywaniu `apksigner`-em w `android-release.yml`.
 *
 * Konsekwencja jest praktyczna, nie estetyczna: wtyczka działa także przy
 * `expo run:android` na własnej maszynie, więc budowa lokalna i budowa w CI
 * mają te same ustawienia — a to jest różnica, której inaczej nikt nie
 * zauważy, dopóki jedna z nich nie zacznie się wywalać.
 *
 * @see config/abis.js — lista architektur i jej sprawdzenie
 * @see config/gradle-memory.js — ile pamięci i dlaczego tyle
 */

const { withGradleProperties } = require('expo/config-plugins');

/**
 * @type {import('expo/config-plugins').ConfigPlugin<{ properties: Record<string, string> }>}
 */
const withGradlePropertiesOverrides = (config, { properties }) => {
  const entries = Object.entries(properties);
  if (entries.length === 0) return config;

  return withGradleProperties(config, (modConfig) => {
    // Wpisy generatora są **usuwane**, a nie nadpisywane w miejscu:
    // `gradle.properties` może zawierać tę samą właściwość więcej niż raz,
    // a gradle czyta wtedy ostatnią. Podmiana pierwszego trafienia dałaby plik,
    // w którym nasza wartość jest, wygląda poprawnie i nie obowiązuje.
    const overridden = new Set(entries.map(([key]) => key));
    const kept = modConfig.modResults.filter(
      (item) => !(item.type === 'property' && overridden.has(item.key)),
    );

    for (const [key, value] of entries) {
      kept.push({
        type: 'comment',
        value: 'Ustawiane przez config/with-gradle-properties.js — nie edytuj ręcznie.',
      });
      kept.push({ type: 'property', key, value });
    }

    modConfig.modResults = kept;
    return modConfig;
  });
};

module.exports = withGradlePropertiesOverrides;
module.exports.withGradlePropertiesOverrides = withGradlePropertiesOverrides;
