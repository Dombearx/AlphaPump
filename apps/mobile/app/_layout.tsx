/**
 * Korzeń aplikacji.
 *
 * Kolejność importów na górze pliku ma znaczenie: `react-native-get-random-values`
 * musi wejść **przed** czymkolwiek, co sięga po `crypto.getRandomValues` —
 * a robi to generator UUID-ów z `@alphapump/core`, czyli praktycznie każdy zapis.
 * Hermes nie ma tego API wbudowanego i bez polyfilla identyfikator serii
 * wywala się dopiero na urządzeniu.
 *
 * Motyw jest ciemny i nie ma przełącznika. Specyfikacja wymaga dark theme,
 * a jeden motyw znaczy jeden zestaw kolorów do utrzymania.
 */

import 'react-native-get-random-values';
import '../global.css';

import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { installConsoleCapture } from '../src/app-log';
import { appConfig, isGoogleSignInConfigured } from '../src/config/index';
import { DatabaseProvider } from '../src/db/provider';
import { SyncProvider } from '../src/sync/provider';
import { COLORS } from '../src/theme';
import { UpdatePrompt } from '../src/ui/update-prompt';

// Jak najwcześniej, żeby żaden log wystrzelony podczas startu (importy,
// pierwszy render) nie ominął bufora zgłoszeń zwrotnych — patrz `app-log.ts`.
installConsoleCapture();

export default function RootLayout() {
  useEffect(() => {
    // Import jest **leniwy**, i to jest różnica widoczna w każdym starcie:
    // `@react-native-google-signin` to moduł natywny, a wpisany na górze pliku
    // ładował się i inicjalizował przy każdym uruchomieniu aplikacji — także
    // wtedy, gdy metoda jest wyłączona, czyli domyślnie i u nas.
    if (!isGoogleSignInConfigured(appConfig)) return;
    void import('../src/auth/google').then(({ configureGoogleSignIn }) => {
      configureGoogleSignIn(appConfig);
    });
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
        {/* Nad bazą i nad synchronizacją, bo nie zależy od żadnej z nich:
            aktualizacja ma się proponować także wtedy, gdy migracje padły albo
            nikt nie jest zalogowany — czyli dokładnie wtedy, gdy nowsze wydanie
            bywa lekarstwem. */}
        <UpdatePrompt />
        <DatabaseProvider>
          {/* Silnik synchronizacji stoi **wewnątrz** bazy, a nie obok niej:
              wymiana danych pisze do tych samych tabel, więc nie ma prawa
              ruszyć, zanim przejdą migracje. */}
          <SyncProvider>
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: COLORS.surface },
                headerTintColor: COLORS.text,
                contentStyle: { backgroundColor: COLORS.base },
                // Przejścia między dniami i ekranem serii mają być natychmiastowe
                // — „bardzo szybko" ze specyfikacji dotyczy też nawigacji.
                animation: 'fade',
              }}
            >
              <Stack.Screen name="index" options={{ title: 'Today' }} />
              <Stack.Screen name="sign-in" options={{ title: 'Sign in', headerShown: false }} />
            </Stack>
          </SyncProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
