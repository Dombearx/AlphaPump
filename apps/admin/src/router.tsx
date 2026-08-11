/**
 * Trasy panelu — definiowane w kodzie, nie z plików.
 *
 * TanStack Router potrafi generować drzewo tras z układu katalogów, ale generator
 * dokłada wtyczkę do buildu i plik generowany, trzymany w repozytorium. Przy
 * czterech ekranach kosztuje to więcej, niż daje: cztery deklaracje niżej są
 * krótsze niż konfiguracja generatora i widać w nich całą nawigację naraz.
 */

import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { Layout } from './components/layout';
import { DataPage } from './pages/data';
import { LibraryPage } from './pages/library';
import { OverviewPage } from './pages/overview';
import { UsersPage } from './pages/users';

const rootRoute = createRootRoute({ component: Layout });

const routes = [
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/users', component: UsersPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/library', component: LibraryPage }),
  createRoute({ getParentRoute: () => rootRoute, path: '/data', component: DataPage }),
];

export const router = createRouter({ routeTree: rootRoute.addChildren(routes) });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
