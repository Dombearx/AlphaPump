/**
 * Pamięć dla maszyny wirtualnej, na której chodzi gradle.
 *
 * Szablon React Native daje 2 GiB sterty i 512 MiB metaspace. Dla tego projektu
 * to za mało i objawia się w najgorszy możliwy sposób — budowa **nie** kończy
 * się błędem kompilacji, tylko zabiciem procesów:
 *
 * ```
 * The Daemon will expire after the build after running out of JVM Metaspace.
 * The currently configured max heap space is '2 GiB' and the configured max
 * metaspace is '512 MiB'.
 * ...
 * > Task :app:mergeExtDexRelease FAILED
 * > Task :app:compileReleaseKotlin FAILED
 * ```
 *
 * — i ani jednej linii mówiącej **dlaczego**. Gradle po takim padzie potrafi
 * nie wyjść wcale: przebieg, który to wykrył, wisiał potem 79 minut do
 * timeoutu, zostawiając osiem osieroconych procesów `java` i `aapt2`. Czyli
 * awaria kosztowna w diagnozie i myląca: wygląda jak zawieszenie CI, a jest
 * brakiem pamięci.
 *
 * Granicę przekroczyło dołożenie `expo-updates`, które dociąga sześć modułów
 * Gradle naraz (`expo-updates`, `expo-updates-interface`, `expo-eas-client`,
 * `expo-manifests`, `expo-json-utils`, `expo-structured-headers`). Metaspace
 * rośnie z liczbą kompilowanych modułów, a nie z rozmiarem naszego kodu.
 *
 * Wartości są dobrane z zapasem względem tego, co runner `ubuntu-latest` ma do
 * dyspozycji (16 GiB), bo koszt zapasu to zero, a koszt jego braku to godzina
 * i pół przebiegu zakończonego niczym. `-Dfile.encoding=UTF-8` zostaje
 * z szablonu — bez niego kompilator bierze kodowanie z ustawień systemu.
 */

const GRADLE_JVM_ARGS = '-Xmx4096m -XX:MaxMetaspaceSize=1024m -Dfile.encoding=UTF-8';

module.exports = { GRADLE_JVM_ARGS };
