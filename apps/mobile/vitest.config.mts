import { defineConfig } from 'vitest/config';

/**
 * Dwa zestawy testów, bo sprawdzają dwie różne rzeczy i mają różny koszt.
 *
 * **`logika`** — wszystko, co nie dotyka Reacta: konfiguracja, wyjątki sieciowe,
 * mapowanie danych do bazy lokalnej, synchronizacja. Chodzi w Node i jest
 * najszybszym sprawdzeniem, jakie mamy.
 *
 * **`ekrany`** — ekrany renderowane naprawdę, na **prawdziwej** bazie lokalnej
 * (SQLite w pamięci, ten sam bundle migracji i ten sam seed, co w aplikacji).
 * Sprawdzają to, czego żaden test logiki nie widzi: że ekran w ogóle się składa,
 * że pola formularza odpowiadają typowi logowania ćwiczenia i że zapis dojeżdża
 * do bazy tą samą drogą, którą jedzie z palca.
 *
 * `react-native` jest tu podmieniony na `react-native-web`. Powód jest
 * praktyczny: źródła React Native są w składni Flow i nie da się ich wykonać
 * w Node bez przepuszczenia całej paczki przez Babel, co zjada sekundy przy
 * każdym uruchomieniu. `react-native-web` odwzorowuje `View`, `Text`,
 * `Pressable`, `TextInput` i `ScrollView` na DOM, więc sprawdzamy **nasze**
 * drzewo komponentów i naszą logikę, a nie implementację warstwy natywnej —
 * tę i tak sprawdza wyłącznie prawdziwe urządzenie. Przy okazji jest to
 * dokładnie ta warstwa, na której stanie wersja PWA.
 *
 * Czego te testy **nie** zastąpią: nawigacji między ekranami, gestów,
 * klawiatury i zachowania SQLite na telefonie. To zostaje dla testu na
 * urządzeniu i jest tu napisane, żeby nikt nie wziął zieleni w CI za dowód,
 * że aplikacja działa na telefonie.
 */
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'logika',
          include: ['tests/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        resolve: { alias: { 'react-native': 'react-native-web' } },
        // Globalna flaga React Native. Bundler aplikacji podstawia ją sam;
        // tutaj podstawiamy ją my, bo bez niej moduły korzystające z niej
        // wywracają się na `__DEV__ is not defined`.
        define: { __DEV__: 'true' },
        test: {
          name: 'ekrany',
          include: ['tests/**/*.test.tsx'],
          environment: 'jsdom',
          setupFiles: ['./tests/screens/setup.tsx'],
          // Renderowanie ekranu przelicza wszystkie jego zapytania do bazy przy
          // każdym przerysowaniu, więc pojedynczy test bywa o rząd wielkości
          // wolniejszy od testu logiki. Zapas jest po to, żeby obciążony runner
          // nie zapalał czerwonego tam, gdzie nic nie jest zepsute.
          testTimeout: 20_000,
        },
      },
    ],
  },
});
