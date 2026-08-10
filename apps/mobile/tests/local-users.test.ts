/**
 * Zapis konta do bazy lokalnej.
 *
 * Test jedzie po **prawdziwym** schemacie lokalnym: bierze bundle migracji,
 * który trafia do aplikacji, uruchamia go na czystej bazie SQLite i zapisuje
 * konto tym samym kodem, którym robi to ekran logowania. Bez tego „dane
 * zapisują się lokalnie" byłoby sprawdzalne dopiero na urządzeniu.
 */

import migrations from '@alphapump/db/sqlite-migrations';
import { users } from '@alphapump/db/sqlite';
import BetterSqlite3 from 'better-sqlite3';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cacheSessionUser, toLocalUser } from '../src/db/users';

function migrated(client: BetterSqlite3.Database): void {
  for (const entry of migrations.journal.entries) {
    const sql = migrations.migrations[`m${String(entry.idx).padStart(4, '0')}`];
    for (const statement of (sql as string).split('--> statement-breakpoint')) {
      client.exec(statement);
    }
  }
}

describe('nick w cache’u kont', () => {
  it('bierze nick wprost, gdy jest', () => {
    expect(
      toLocalUser({ id: 'u-1', email: 'kuba@example.com', nickname: 'Kuba', role: 'user' })
        .nickname,
    ).toBe('Kuba');
  });

  it('wyprowadza nick z nazwy konta', () => {
    expect(toLocalUser({ id: 'u-1', email: 'kuba@example.com', name: 'Kuba K.' }).nickname).toBe(
      'Kuba K.',
    );
  });

  it('w ostateczności bierze część adresu przed małpą', () => {
    // Rejestracja e-mailem nie pyta o nick, a kolumna jest `NOT NULL`.
    expect(toLocalUser({ id: 'u-1', email: 'kuba@example.com' }).nickname).toBe('kuba');
  });

  it('rolę spoza słownika sprowadza do zwykłego użytkownika', () => {
    expect(toLocalUser({ id: 'u-1', email: 'a@b.pl', role: 'superadmin' }).role).toBe('user');
    expect(toLocalUser({ id: 'u-1', email: 'a@b.pl', role: 'admin' }).role).toBe('admin');
  });
});

describe('zapis konta do bazy lokalnej', () => {
  let client: BetterSqlite3.Database;
  let db: ReturnType<typeof drizzle>;

  beforeEach(() => {
    client = new BetterSqlite3(':memory:');
    client.pragma('foreign_keys = ON');
    migrated(client);
    db = drizzle(client);
  });

  afterEach(() => {
    client.close();
  });

  it('zapisuje konto właściciela urządzenia', async () => {
    await cacheSessionUser(db, { id: 'u-1', email: 'kuba@example.com', name: 'Kuba' });

    const [row] = await db.select().from(users).where(eq(users.id, 'u-1'));
    expect(row).toMatchObject({ email: 'kuba@example.com', nickname: 'Kuba', role: 'user' });
  });

  it('powtórne logowanie odświeża wiersz zamiast go dublować', async () => {
    await cacheSessionUser(db, { id: 'u-1', email: 'kuba@example.com', name: 'Kuba' });
    await cacheSessionUser(db, { id: 'u-1', email: 'kuba@example.com', name: 'Kubaa' });

    const rows = await db.select().from(users).where(eq(users.id, 'u-1'));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.nickname).toBe('Kubaa');
  });
});
