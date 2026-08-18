/**
 * Odczyt zmiennych środowiskowych na potrzeby `app.config.js`.
 *
 * Istnieje z powodu jednej różnicy, która kosztowała aplikację uruchomienie:
 * `??` łapie wyłącznie `undefined`, a GitHub Actions ustawia `env:` na **pusty
 * napis**, gdy zmienna repozytorium (`vars.*`) nie istnieje. Zapis
 * `process.env.X ?? null` dawał więc w wydaniu z CI `''` zamiast `null`, pusty
 * napis dojeżdżał do `extra` w manifeście, a schemat konfiguracji odrzucał go
 * przy starcie — czyli aplikacja wywalała się, zanim zdążyła cokolwiek
 * narysować, i to bez żadnego komunikatu na ekranie.
 *
 * Zmienna pusta znaczy tu dokładnie to samo, co zmienna nieustawiona: „nie
 * podano". Nie ma pola, w którym pusty napis byłby sensowną wartością.
 *
 * Plik jest zwykłym modułem CommonJS, a nie TypeScriptem, bo czyta go loader
 * konfiguracji Expo — ten transpiluje wyłącznie sam `app.config`, a importy
 * względne ładuje już zwykłym `require`.
 */

/**
 * Wartość zmiennej albo `null`, gdy jej nie ma lub jest pusta.
 * @param {string} name
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {string | null}
 */
function envValue(name, source = process.env) {
  const value = source[name];
  if (value === undefined || value.trim() === '') return null;
  return value;
}

module.exports = { envValue };
