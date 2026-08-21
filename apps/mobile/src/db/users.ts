/**
 * Cache kont w bazie lokalnej.
 *
 * Telefon trzyma konta z dwóch powodów: ćwiczenie ma autora, a rekord globalny
 * ma nick — i jedno, i drugie ma się wyświetlić bez sieci. Właściciel urządzenia
 * trafia tu przy logowaniu, reszta przyjeżdża pullem.
 *
 * Zapis własnego konta przy logowaniu nie jest kosmetyką: to on sprawia, że
 * ćwiczenia tworzone lokalnie mają na co wskazywać kluczem obcym `author_id`,
 * zanim urządzenie zdąży się z czymkolwiek zsynchronizować.
 */

import { users, type SqliteDatabase } from '@alphapump/db/sqlite';
import type { UserRole } from '@alphapump/core';

/** Konto w kształcie, w jakim oddaje je better-auth. */
export interface SessionUser {
  id: string;
  email: string;
  name?: string | null;
  nickname?: string | null;
  role?: string | null;
}

export interface LocalUser {
  id: string;
  email: string | null;
  nickname: string;
  role: UserRole;
}

/**
 * Nick jest wymagany, a sesja bywa go pozbawiona zaraz po rejestracji e-mailem.
 * Wyprowadzamy go tą samą drogą co serwer: nazwa konta, a w ostateczności część
 * adresu przed małpą.
 */
export function toLocalUser(user: SessionUser): LocalUser {
  const nickname = (user.nickname ?? user.name ?? '').trim();
  return {
    id: user.id,
    email: user.email,
    nickname: (nickname.length > 0 ? nickname : (user.email.split('@')[0] ?? user.email)).slice(
      0,
      40,
    ),
    role: user.role === 'admin' ? 'admin' : 'user',
  };
}

/** Wstawia albo odświeża konto właściciela urządzenia. */
export async function cacheSessionUser(
  db: SqliteDatabase,
  user: SessionUser,
  now: Date = new Date(),
): Promise<LocalUser> {
  const local = toLocalUser(user);

  await db
    .insert(users)
    .values({ ...local, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({
      target: users.id,
      set: { email: local.email, nickname: local.nickname, role: local.role, updatedAt: now },
    });

  return local;
}
