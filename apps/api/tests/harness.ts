/**
 * Środowisko testów integracyjnych.
 *
 * Stawia **całą** aplikację: prawdziwego Postgresa (PGlite w procesie), komplet
 * migracji z paczki `@alphapump/db`, better-auth i wszystkie trasy. Żadnych
 * atrap — testy chodzą po tym samym kodzie, który pojedzie na minipc, więc
 * „można założyć konto, zalogować się i wykonać CRUD serii" jest sprawdzane,
 * a nie zakładane.
 */

import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { vector } from '@electric-sql/pglite-pgvector';
import { pgMigrationsFolder } from '@alphapump/db/migrations';
import { seedPostgres } from '@alphapump/db/pg';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { createApp } from '../src/app.js';
import { createAuth } from '../src/auth.js';
import type { AppConfig } from '../src/config.js';
import type { Database } from '../src/db.js';
import type { DuplicateLayers } from '../src/duplicates/layers.js';
import type { DerivedRecomputation } from '../src/sync/derived.js';
import type { TriageClient } from '../src/triage.js';
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
  // Warstwa semantyczna jest w testach wyłączona domyślnie i włączana wyłącznie
  // podstawionymi atrapami — CI nie może zależeć od cudzego serwisu ani od
  // klucza w sekretach.
  llm: null,
  // Nadpisywane per-uruchomienie przez `createHarness` własnym katalogiem
  // tymczasowym — testy zgłoszeń piszą naprawdę na dysk i nie mogą dzielić
  // katalogu między sobą.
  feedbackDir: './data/feedback',
  // Katalog kopii zapasowych niepodmontowany — czyli dokładnie stan produkcyjny
  // przy `RCLONE_REMOTE`, kiedy kopie stoją poza maszyną. `/admin/stats` oddaje
  // wtedy `backups: null`, a testy sprawdzają właśnie ten wariant.
  backupDir: null,
  // Jak `feedbackDir` wyżej: własny katalog na uruchomienie, bo testy
  // aktualizacji OTA kładą na dysku prawdziwe opisy wydań.
  otaDir: './data/ota',
  // Domyślnie wyłączony jak `llm` wyżej — testy podstawiają atrapę klienta
  // przez `HarnessOptions.triage`, kiedy sprawdzają `POST /admin/feedback/run`.
  triage: null,
};

export interface TestUser {
  id: string;
  email: string;
  password: string;
  /** Nagłówki z sesją — gotowe do wklejenia w żądanie. */
  headers: Record<string, string>;
}

export interface HarnessOptions {
  /** Przeliczenia danych pochodnych wołane po pushu — test podstawia własne. */
  derived?: readonly DerivedRecomputation[];
  /**
   * Warstwy wykrywania duplikatów. Pominięcie znaczy „warstwa semantyczna
   * wyłączona" — czyli dokładnie stan, w którym musi działać tworzenie ćwiczeń.
   */
  duplicates?: DuplicateLayers;
  /**
   * Katalog kopii zapasowych do podejrzenia. Pominięcie znaczy „niepodmontowany",
   * czyli stan produkcyjny przy kopiach stojących poza stosem.
   */
  backupDir?: string;
  /** Klient usługi triage — pominięcie znaczy „panel nie wyzwoli przeglądu ręcznie". */
  triage?: TriageClient;
}

export interface Harness {
  db: Database;
  /** Katalog na zgłoszenia zwrotne tego uruchomienia — świeży, tylko jego. */
  feedbackDir: string;
  /** Katalog z wydaniami OTA tego uruchomienia — świeży, tylko jego. */
  otaDir: string;
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

export async function createHarness(options: HarnessOptions = {}): Promise<Harness> {
  // Rozszerzenia muszą być wkompilowane przy tworzeniu instancji — `CREATE
  // EXTENSION` w migracji jedynie je włącza (patrz `packages/db/tests/databases.ts`).
  const client = new PGlite({ extensions: { vector, pg_trgm } });
  const db = drizzle(client) as unknown as Database;
  await migrate(drizzle(client), { migrationsFolder: pgMigrationsFolder });
  await seedPostgres(db);

  const feedbackDir = mkdtempSync(path.join(tmpdir(), 'alphapump-feedback-'));
  const otaDir = mkdtempSync(path.join(tmpdir(), 'alphapump-ota-'));
  const config = { ...TEST_CONFIG, feedbackDir, otaDir, backupDir: options.backupDir ?? null };

  const auth = createAuth(db, config);
  const app = createApp(
    { db, auth, derived: options.derived, duplicates: options.duplicates, triage: options.triage },
    config,
  );

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
    feedbackDir,
    otaDir,
    request,
    json,
    signUp,
    signIn,
    createApiKey,
    promoteToAdmin,
    close: async () => {
      await rm(feedbackDir, { recursive: true, force: true });
      await rm(otaDir, { recursive: true, force: true });
      await client.close();
    },
  };
}
