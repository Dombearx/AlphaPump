/**
 * Punkt wejścia panelu.
 *
 * Dwie decyzje w konfiguracji TanStack Query, obie wynikające z tego, czym panel
 * jest:
 *
 * - **`retry: false`.** Panel działa wyłącznie wewnątrz VPN. Gdy API jest
 *   nieosiągalne, ponawianie tylko opóźnia komunikat — a to on jest tu informacją:
 *   „jesteś poza siecią", nie „coś się nie udało".
 * - **`staleTime: 0`.** Administrator patrzy na liczby, po których podejmuje
 *   decyzje, i wchodzi tu rzadko. Świeży odczyt przy każdym wejściu jest tańszy
 *   niż jedna decyzja podjęta na podstawie danych z poprzedniej sesji.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { router } from './router';
import './styles.css';

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 0, refetchOnWindowFocus: false } },
});

const container = document.getElementById('root');
if (!container) throw new Error('No #root element — check index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
