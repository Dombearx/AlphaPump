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
import { createOpenRouterLayers } from './duplicates/index.js';
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
  console.warn(
    `Dane startowe: ${String(seeded.tags)} tagów i ${String(seeded.exercises)} ćwiczeń wbudowanych ` +
      'w zestawie (wstawione zostały tylko te, których brakowało).',
  );

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
  const app = createApp({ db: connection.db, auth, duplicates, triage }, config);

  if (config.llm === null) {
    console.warn(
      'Warstwa semantyczna jest wyłączona (brak OPENROUTER_API_KEY albo LLM_ENABLED=false) — ' +
        'ostrzeżenia o duplikatach liczone leksykalnie.',
    );
  }

  const server = serve({ fetch: app.fetch, hostname: config.host, port: config.port }, (info) => {
    console.warn(`AlphaPump API słucha na http://${config.host}:${info.port}`);
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
