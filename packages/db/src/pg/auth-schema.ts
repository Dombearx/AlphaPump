/**
 * Tabele autoryzacji — kształt narzucony przez better-auth.
 *
 * Nazwy **właściwości** w tym pliku nie są dowolne: adapter Drizzle w
 * better-auth szuka kolumn po nazwach swoich pól (`emailVerified`, `userId`,
 * `providerId`…), więc muszą się zgadzać co do znaku. Nazwy kolumn w bazie już
 * dowolne są i trzymamy je w `snake_case`, jak resztę schematu.
 *
 * Sama tabela użytkowników mieszka w `schema.ts`, bo wskazują na nią klucze
 * obce danych domenowych — jest częścią modelu, a nie tylko warstwy logowania.
 *
 * Tabel autoryzacyjnych **nie synchronizujemy**. Nie mają `server_seq` ani
 * tombstone'ów: sesje i klucze API są sprawą jednego urządzenia i serwera,
 * a hashe haseł nie mają czego szukać na telefonie ani w kopii zapasowej.
 */

import {
  boolean,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { users } from './schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Sesja logowania.
 *
 * Ciasteczko sesyjne świadomie **nie** dostaje flagi `Secure`: API działa po
 * HTTP wewnątrz VPN, a ciasteczko oznaczone jako `Secure` nigdy by nie
 * dojechało. Szyfrowanie zapewnia WireGuard pod spodem.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: text('id').primaryKey(),
    token: text('token').notNull(),
    expiresAt: instant('expires_at').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Plugin `admin`: sesja założona przez administratora „w imieniu" kogoś. */
    impersonatedBy: text('impersonated_by'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('sessions_token_unique').on(table.token),
    index('sessions_user_idx').on(table.userId),
  ],
);

/**
 * Powiązanie konta z metodą logowania. Jeden wiersz na e-mail z hasłem
 * (`password`) i jeden na konto Google (`providerId = 'google'`) — dzięki czemu
 * ta sama osoba może korzystać z obu metod.
 */
export const accounts = pgTable(
  'accounts',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: instant('access_token_expires_at'),
    refreshTokenExpiresAt: instant('refresh_token_expires_at'),
    scope: text('scope'),
    /** Hash hasła. Poza eksportem i kopią zapasową — patrz dokument stacku. */
    password: text('password'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('accounts_user_idx').on(table.userId),
    uniqueIndex('accounts_provider_account_unique').on(table.providerId, table.accountId),
  ],
);

/** Tokeny jednorazowe better-auth (weryfikacje, zmiany adresu e-mail). */
export const verifications = pgTable(
  'verifications',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: instant('expires_at').notNull(),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [index('verifications_identifier_idx').on(table.identifier)],
);

/**
 * Klucz API. Użytkownik może mieć ich wiele — to nimi rozmawia z API bot
 * Discord działający w tym samym VPN.
 *
 * `referenceId` to identyfikator właściciela klucza. Bez klucza obcego, bo
 * plugin dopuszcza tam także byty inne niż użytkownik; u nas jest to zawsze
 * `users.id`.
 */
export const apiKeys = pgTable(
  'api_keys',
  {
    id: text('id').primaryKey(),
    configId: text('config_id').notNull(),
    name: text('name'),
    /** Kilka pierwszych znaków klucza — do rozpoznania go na liście po utworzeniu. */
    start: text('start'),
    prefix: text('prefix'),
    /** Hash klucza; wartość jawna pokazuje się użytkownikowi raz, przy utworzeniu. */
    key: text('key').notNull(),
    referenceId: text('reference_id').notNull(),
    refillInterval: integer('refill_interval'),
    refillAmount: integer('refill_amount'),
    lastRefillAt: instant('last_refill_at'),
    enabled: boolean('enabled').notNull().default(true),
    rateLimitEnabled: boolean('rate_limit_enabled').notNull().default(true),
    rateLimitTimeWindow: integer('rate_limit_time_window'),
    rateLimitMax: integer('rate_limit_max'),
    requestCount: integer('request_count').notNull().default(0),
    remaining: integer('remaining'),
    lastRequest: instant('last_request'),
    expiresAt: instant('expires_at'),
    permissions: text('permissions'),
    metadata: text('metadata'),
    createdAt: instant('created_at').notNull().defaultNow(),
    updatedAt: instant('updated_at').notNull().defaultNow(),
  },
  (table) => [index('api_keys_reference_idx').on(table.referenceId)],
);

export type SessionRow = typeof sessions.$inferSelect;
export type AccountRow = typeof accounts.$inferSelect;
export type VerificationRow = typeof verifications.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
