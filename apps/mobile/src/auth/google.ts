/**
 * Logowanie przez Google — natywne, nie przez przeglądarkę.
 *
 * Google Cloud Console wymaga HTTPS dla adresów przekierowania OAuth, a nasze
 * API stoi po HTTP wewnątrz VPN — przepływ przeglądarkowy nie miałby dokąd
 * wrócić. Natywnego Sign-Ina to nie dotyczy: telefon pobiera `idToken` od
 * Google publicznym internetem po HTTPS i przekazuje go do naszego API, które
 * weryfikuje podpis kluczami publicznymi Google.
 *
 * Działa to więc także wtedy, gdy API jest niedostępne z internetu — jedyne,
 * czego wymaga, to żeby telefon widział naraz Google i VPN.
 */

import { GoogleSignin } from '@react-native-google-signin/google-signin';
import type { AppConfig } from '../config/index';
import { authClient } from './client';

export function configureGoogleSignIn(config: AppConfig): void {
  if (config.googleWebClientId === null) return;
  GoogleSignin.configure({
    webClientId: config.googleWebClientId,
    ...(config.googleIosClientId === null ? {} : { iosClientId: config.googleIosClientId }),
    offlineAccess: false,
  });
}

/** Zwraca `null`, gdy użytkownik przerwał wybór konta — to nie jest błąd. */
export async function signInWithGoogle(): Promise<{ cancelled: boolean }> {
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });

  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') return { cancelled: true };

  const idToken = response.data?.idToken;
  if (!idToken) {
    throw new Error("Google didn't return an identity token");
  }

  const { error } = await authClient.signIn.social({
    provider: 'google',
    idToken: { token: idToken },
  });
  if (error) throw new Error(error.message ?? 'Google sign-in failed');

  return { cancelled: false };
}
