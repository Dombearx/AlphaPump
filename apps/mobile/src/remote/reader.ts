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
import { createRemoteReader } from './read-only';

export const remoteReader = createRemoteReader({
  baseUrl: appConfig.apiUrl,
  cookie: sessionCookie,
});
