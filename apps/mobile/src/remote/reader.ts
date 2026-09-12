/**
 * Czytnik danych serwerowych używany przez ekrany.
 *
 * Jedna instancja na całą aplikację, tak jak jeden uchwyt do bazy lokalnej.
 * Sesja jest czytana przy każdym żądaniu (`sessionCookie` jest funkcją), więc
 * wylogowanie i odświeżenie tokenu nie wymagają tworzenia czytnika od nowa —
 * a ekrany dostają wartość o stałej tożsamości, którą można podać wprost do
 * zależności `useRemote`.
 */

import { sessionCookie } from '../auth/client';
import { appConfig } from '../config/index';
import { createAccountClient } from './account';
import { createRemoteReader } from './read-only';
import { createVoiceClient } from './voice';

export const remoteReader = createRemoteReader({
  baseUrl: appConfig.apiUrl,
  cookie: sessionCookie,
});

/**
 * Klient dyktowania — obok czytnika, bo żyje z tych samych dwóch rzeczy: adresu
 * API i sesji czytanej przy każdym żądaniu. Osobno od `remoteReader`, bo tamten
 * jest **tylko do odczytu** i ma tak zostać: tu w żądaniu jedzie plik.
 */
export const voiceClient = createVoiceClient({
  baseUrl: appConfig.apiUrl,
  cookie: sessionCookie,
});

/**
 * Stan konta po stronie serwera — w tej chwili wyłącznie po to, żeby telefon
 * wiedział, czy konto ma hasło tymczasowe do zmiany. Znowu obok czytnika i z
 * tych samych dwóch rzeczy: adresu API i sesji czytanej przy każdym żądaniu.
 */
export const accountClient = createAccountClient({
  baseUrl: appConfig.apiUrl,
  cookie: sessionCookie,
});
