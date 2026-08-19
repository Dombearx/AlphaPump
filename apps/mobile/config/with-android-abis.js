/**
 * Zawężenie architektur wchodzących do pliku `.apk`.
 *
 * React Native czyta listę architektur z właściwości `reactNativeArchitectures`
 * w `android/gradle.properties` — plik generuje `expo prebuild`, z domyślną
 * wartością obejmującą wszystkie cztery. Wtyczka podmienia tę jedną linię.
 *
 * ## Dlaczego wtyczka, a nie dopisanie linii w CI
 *
 * Kuszące jest `echo reactNativeArchitectures=... >> gradle.properties` w
 * `android-release.yml`, zaraz po `prebuild`. Byłoby krótsze i działałoby —
 * tylko że projekt natywny powstaje na nowo przy każdym wydaniu, więc każda
 * jego modyfikacja w CI jest łataniem wyniku generatora zamiast zmiany jego
 * wejścia. Ten sam argument stoi przy podpisywaniu `apksigner`-em w tym samym
 * workflow i przy `with-cleartext-host.js` obok. Konsekwencja jest praktyczna,
 * nie estetyczna: wtyczka działa także przy `expo run:android` na własnej
 * maszynie, więc plik zbudowany lokalnie i plik z CI mają ten sam rozmiar
 * i te same biblioteki — a to jest różnica, której inaczej nikt nie zauważy,
 * dopóki nie zacznie porównywać wydań.
 *
 * @see config/abis.js — lista architektur i jej sprawdzenie
 */

const { withGradleProperties } = require('expo/config-plugins');

/** Właściwość, z której React Native czyta listę architektur. */
const PROPERTY = 'reactNativeArchitectures';

/**
 * @type {import('expo/config-plugins').ConfigPlugin<{ abis: string[] }>}
 */
const withAndroidAbis = (config, { abis }) => {
  if (abis.length === 0) return config;

  return withGradleProperties(config, (modConfig) => {
    // Wpis generatora zostaje **usunięty**, a nie nadpisany w miejscu:
    // `gradle.properties` może zawierać tę właściwość więcej niż raz, a gradle
    // czyta wtedy ostatnią. Podmiana pierwszego trafienia dałaby plik, w którym
    // nasza wartość jest, wygląda poprawnie i nie obowiązuje.
    const kept = modConfig.modResults.filter(
      (item) => !(item.type === 'property' && item.key === PROPERTY),
    );

    kept.push({
      type: 'comment',
      value: 'Ustawiane przez config/with-android-abis.js — nie edytuj ręcznie.',
    });
    kept.push({ type: 'property', key: PROPERTY, value: abis.join(',') });

    modConfig.modResults = kept;
    return modConfig;
  });
};

module.exports = withAndroidAbis;
module.exports.withAndroidAbis = withAndroidAbis;
