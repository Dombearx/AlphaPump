/**
 * Panel administracyjny jako zwykłe SPA.
 *
 * Vite, a nie Next.js: specyfikacja mówi „prosty panel", a panel widoczny
 * wyłącznie wewnątrz VPN i dla kilku osób nie ma czego zyskać na renderowaniu po
 * stronie serwera — miałby za to drugi proces do utrzymania na minipc obok API.
 *
 * Adres API wchodzi zmienną `VITE_API_URL`. W trybie deweloperskim żądania idą
 * przez proxy Vite pod `/api-proxy`, żeby przeglądarka widziała jedno pochodzenie
 * i nie wchodziła w CORS ani w blokadę ciasteczek między witrynami. Na produkcji
 * panel i API stoją za tym samym Caddym, więc proxy nie jest potrzebne.
 */

import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const target = env.VITE_API_URL ?? 'http://localhost:3000';

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        '/api-proxy': {
          target,
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api-proxy/, ''),
        },
      },
    },
    build: { outDir: 'dist', sourcemap: true },
  };
});
