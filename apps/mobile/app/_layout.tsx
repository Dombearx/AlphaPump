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
import { configureGoogleSignIn } from '../src/auth/google';
import { appConfig, isGoogleSignInConfigured } from '../src/config/index';
import { DatabaseProvider } from '../src/db/provider';
import { SyncProvider } from '../src/sync/provider';
import { COLORS } from '../src/theme';

// Jak najwcześniej, żeby żaden log wystrzelony podczas startu (importy,
// pierwszy render) nie ominął bufora zgłoszeń zwrotnych — patrz `app-log.ts`.
installConsoleCapture();

export default function RootLayout() {
  useEffect(() => {
    if (isGoogleSignInConfigured(appConfig)) configureGoogleSignIn(appConfig);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: COLORS.base }}>
      <SafeAreaProvider>
        <StatusBar style="light" />
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
              <Stack.Screen name="sign-in" options={{ title: 'Logowanie', headerShown: false }} />
            </Stack>
          </SyncProvider>
        </DatabaseProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
