/**
 * Wejście serwera.
 *
 * Kolejność startu jest celowa: konfiguracja, migracje, seed, dopiero potem
 * nasłuch. Serwer, który przyjmuje żądania na niezmigrowanej bazie, oddaje
 * błędy zamiast po prostu poczekać kilka sekund na zakończenie migracji.
 *
 * ## Dlaczego seed jedzie przy każdym starcie
 *
 * Bo inaczej nie jedzie nigdy. Telefon seeduje swoją bazę sam, przy każdym
 * uruchomieniu aplikacji (`apps/mobile/src/db/provider.tsx`) — jeśli serwer
 * tego nie robi, obie biblioteki rozjeżdżają się od pierwszego dnia: aplikacja
 * pokazuje ćwiczenia wbudowane, których panel administracyjny nie widzi, a push
 * serii na takie ćwiczenie odbija się o „Ćwiczenie serii nie istnieje". Krok
 * ręczny w instrukcji wdrożenia jest tu gorszy niż bezużyteczny — pominięcie go
 * nie zgłasza się żadnym błędem, tylko cichym rozjazdem danych.
 *
 * Seed jest do tego przygotowany: wstawia wyłącznie brakujące wiersze
 * (`onConflictDoNothing`), więc nie cofa zmian zrobionych w panelu i nie
 * wskrzesza tego, co administrator usunął. Jego `updated_at` leży w przeszłości
 * (`SEED_TIMESTAMP`), więc nigdy nie wygrywa LWW z edycją użytkownika.
 */

import { seedPostgres } from '@alphapump/db/pg';
import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase, runMigrations } from './db.js';
import { createEmbeddingBacklog, createOpenRouterLayers } from './duplicates/index.js';
import { logger } from './logger.js';
import { createTriageClient } from './triage.js';

export { createApp, type App } from './app.js';
export { createAuth, type Auth } from './auth.js';
export { loadConfig, type AppConfig } from './config.js';
export { createDatabase, runMigrations, type Database } from './db.js';
export { buildOpenApiDocument } from './openapi.js';
export { exportArchive, importArchive } from './transfer/index.js';
export { createTriageClient, type TriageClient } from './triage.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  await runMigrations(connection);
  const seeded = await seedPostgres(connection.db);
  logger.info('dane startowe w zestawie', {
    tags: seeded.tags,
    exercises: seeded.exercises,
    note: 'wstawione zostały tylko te, których brakowało',
  });

  const auth = createAuth(connection.db, config);
  // Warstwy wykrywania duplikatów powstają **tutaj**, z konfiguracji — nie
  // domyślnie w `createApp`. Wyłącznik warstwy i brak klucza OpenRoutera dają
  // ten sam wynik: `null` w konfiguracji i wykrywanie duplikatów sprowadzone do
  // warstwy leksykalnej, bez żadnego wpływu na tworzenie ćwiczeń.
  const duplicates = createOpenRouterLayers(config.llm);
  // `undefined`, nie `null`: `AppDependencies.triage` jest opcjonalne dokładnie
  // dlatego, żeby brak konfiguracji triage'a nie wymagał osobnej gałęzi tutaj —
  // `createAdminRouter` traktuje pominięcie pola jako „panel nie wyzwoli
  // przeglądu ręcznie".
  const triage = config.triage ? createTriageClient(config.triage) : undefined;
  // Jedna kolejka na proces, złożona z tych samych warstw co wykrywanie
  // duplikatów: liczenie wektorów zeszło ze ścieżki żądania, bo wywołanie
  // u dostawcy modeli trwa dłużej, niż telefon czeka na odpowiedź pushu.
  const embeddings = createEmbeddingBacklog(connection.db, duplicates);
  const app = createApp({ db: connection.db, auth, duplicates, embeddings, triage }, config);

  if (config.llm === null) {
    logger.warn('warstwa semantyczna wyłączona', {
      reason: 'brak OPENROUTER_API_KEY albo LLM_ENABLED=false',
      effect: 'ostrzeżenia o duplikatach liczone leksykalnie',
    });
  }

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    logger.info('API słucha', { host: config.host, port: info.port });
  });

  const shutdown = () => {
    server.close(() => {
      void connection.close();
    });
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Uruchamiamy serwer tylko wtedy, gdy plik jest punktem wejścia procesu —
// import z testów albo z innego pakietu ma dawać same funkcje.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  await main();
}
