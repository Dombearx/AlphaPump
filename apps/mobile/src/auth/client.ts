/**
 * Klient better-auth dla React Native.
 *
 * Sesja jedzie **nagłówkiem**, a token leży w bezpiecznym magazynie systemowym.
 * To nie jest wybór estetyczny: API działa po HTTP wewnątrz VPN, a ciasteczko
 * z flagą `Secure` po HTTP nigdy by nie dojechało. Plugin Expo robi dokładnie
 * to — trzyma sesję w `SecureStore` i dokleja ją do żądań.
 */

import { expoClient } from '@better-auth/expo/client';
import { createAuthClient } from 'better-auth/react';
import * as SecureStore from 'expo-secure-store';
import { appConfig } from '../config/index';

/** Schemat deep linków aplikacji; musi zgadzać się z `scheme` w `app.config.js`. */
export const APP_SCHEME = 'alphapump';

export const authClient = createAuthClient({
  baseURL: appConfig.apiUrl,
  plugins: [
    /**
     * Rozjazd sygnatur w samej bibliotece: `expoClient` deklaruje `getActions`
     * z dwoma parametrami, a interfejs wtyczki oczekuje trzech. Zachowanie jest
     * poprawne, niezgodność dotyczy wyłącznie typu — a rezygnacja z wtyczki
     * oznaczałaby sesję poza bezpiecznym magazynem systemowym.
     */
    // @ts-expect-error -- patrz komentarz powyżej
    expoClient({
      scheme: APP_SCHEME,
      storagePrefix: APP_SCHEME,
      storage: SecureStore,
    }),
  ],
});

export const { useSession, signIn, signUp, signOut } = authClient;
