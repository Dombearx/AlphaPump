/**
 * Kontekst żądania: co aplikacja Hono wie o sobie i o tym, kto pyta.
 */

import type { UserRole } from '@alphapump/core';
import type { Auth } from './auth.js';
import type { Database } from './db.js';
import type { DerivedRecomputation } from './sync/derived.js';

/** Skąd wzięło się uwierzytelnienie — przydaje się w logach i w testach. */
export type Credential = 'session' | 'api-key';

export interface Principal {
  id: string;
  email: string;
  nickname: string;
  role: UserRole;
  credential: Credential;
}

export interface AppEnvironment {
  Variables: {
    principal: Principal;
  };
  Bindings: Record<string, never>;
}

export interface AppDependencies {
  db: Database;
  auth: Auth;
  /**
   * Przeliczenia danych pochodnych wołane po każdej zmianie serii — pushem albo
   * zwykłym CRUD-em. Pominięcie pola daje zestaw domyślny
   * (`DERIVED_RECOMPUTATIONS`), więc produkcja nie ma jak zostać bez
   * przeliczania rekordów globalnych; test podstawia tu własną listę, także
   * pustą.
   */
  derived?: readonly DerivedRecomputation[];
}
