/**
 * Środowisko testów integracyjnych.
 *
 * Stawia **całą** aplikację: prawdziwego Postgresa (PGlite w procesie), komplet
 * migracji z paczki `@alphapump/db`, better-auth i wszystkie trasy. Żadnych
 * atrap — testy chodzą po tym samym kodzie, który pojedzie na minipc, więc
 * „można założyć konto, zalogować się i wykonać CRUD serii" jest sprawdzane,
 * a nie zakładane.
 */

import { PGlite } from '@electric-sql/pglite';
import { pgMigrationsFolder } from '@alphapump/db/migrations';
import { seedPostgres } from '@alphapump/db/pg';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import { users } from '../src/schema.js';

export const TEST_CONFIG: AppConfig = {
  nodeEnv: 'test',
  host: '127.0.0.1',
  port: 3000,
  databaseUrl: 'pglite://memory',
  authSecret: 'testowy-sekret-o-dlugosci-ponad-32-znakow',
  baseUrl: 'http://localhost:3000',
  trustedOrigins: ['http://localhost:3000'],
  google: { clientId: 'google-client-id', clientSecret: 'google-client-secret' },
};

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Nagłówki z sesją — gotowe do wklejenia w żądanie. */
  headers: Record<string, string>;
}

export interface Harness {
  db: Database;
  request: (path: string, init?: RequestInit) => Promise<Response>;
  /** Żądanie JSON-owe z podanymi nagłówkami uwierzytelnienia. */
  json: <T = unknown>(
    method: string,
    path: string,
    options?: { body?: unknown; headers?: Record<string, string> },
  ) => Promise<{ status: number; body: T }>;
  signUp: (email: string, password?: string, name?: string) => Promise<TestUser>;
  signIn: (email: string, password: string) => Promise<Record<string, string>>;
  createApiKey: (user: TestUser, name?: string) => Promise<string>;
  promoteToAdmin: (user: TestUser) => Promise<void>;
  close: () => Promise<void>;
}

const BASE = 'http://localhost:3000';

export async function createHarness(): Promise<Harness> {
  const client = new PGlite();
  const db = drizzle(client) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: pgMigrationsFolder });
  await seedPostgres(db);

  const auth = createAuth(db, TEST_CONFIG);
  const app = createApp({ db, auth }, TEST_CONFIG);

  const request = async (path: string, init: RequestInit = {}) =>
    app.fetch(new Request(BASE + path, init));

  const json = async <T = unknown>(
    method: string,
    path: string,
    options: { body?: unknown; headers?: Record<string, string> } = {},
  ) => {
    const response = await request(path, {
      method,
      headers: {
        ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        ...options.headers,
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: (text.length === 0 ? null : JSON.parse(text)) as T,
    };
  };

  /** Sesja jedzie nagłówkiem — plugin `bearer` zwraca token w `set-auth-token`. */
  const sessionHeaders = (response: Response): Record<string, string> => {
    const token = response.headers.get('set-auth-token');
    if (!token) throw new Error('Odpowiedź logowania nie zawiera tokenu sesji');
    return { Authorization: `Bearer ${token}` };
  };

  const signUp = async (email: string, password = 'haslo-testowe-123', name = 'Testowy') => {
    const response = await request('/api/auth/sign-up/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name }),
    });
    if (!response.ok) throw new Error(`Rejestracja nie powiodła się: ${await response.text()}`);

    const headers = sessionHeaders(response);
    const [row] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!row) throw new Error('Konto nie trafiło do bazy');

    return { id: row.id, email, password, headers } satisfies TestUser;
  };

  const signIn = async (email: string, password: string) => {
    const response = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!response.ok) throw new Error(`Logowanie nie powiodło się: ${await response.text()}`);
    return sessionHeaders(response);
  };

  const createApiKey = async (user: TestUser, name = 'bot-discord') => {
    const response = await request('/api/auth/api-key/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...user.headers },
      body: JSON.stringify({ name }),
    });
    if (!response.ok)
      throw new Error(`Tworzenie klucza API nie powiodło się: ${await response.text()}`);
    const body = (await response.json()) as { key?: string };
    if (!body.key) throw new Error('Odpowiedź nie zawiera klucza API');
    return body.key;
  };

  const promoteToAdmin = async (user: TestUser) => {
    await db.update(users).set({ role: 'admin' }).where(eq(users.id, user.id));
  };

  return {
    db,
    request,
    json,
    signUp,
    signIn,
    createApiKey,
    promoteToAdmin,
    close: () => client.close(),
  };
}
