/**
 * Wejście serwera.
 *
 * Kolejność startu jest celowa: konfiguracja, potem migracje, dopiero potem
 * nasłuch. Serwer, który przyjmuje żądania na niezmigrowanej bazie, oddaje
 * błędy zamiast po prostu poczekać kilka sekund na zakończenie migracji.
 */

import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { createAuth } from './auth.js';
import { loadConfig } from './config.js';
import { createDatabase, runMigrations } from './db.js';

export { createApp, type App } from './app.js';
export { createAuth, type Auth } from './auth.js';
export { loadConfig, type AppConfig } from './config.js';
export { createDatabase, runMigrations, type Database } from './db.js';
export { buildOpenApiDocument } from './openapi.js';

export async function main(): Promise<void> {
  const config = loadConfig();
  const connection = createDatabase(config.databaseUrl);

  await runMigrations(connection);

  const auth = createAuth(connection.db, config);
  const app = createApp({ db: connection.db, auth }, config);

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
