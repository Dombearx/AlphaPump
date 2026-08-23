/**
 * Porządkowanie biblioteki z panelu administracyjnego.
 *
 * ## Dlaczego to jednak są osobne endpointy
 *
 * Do tej pory panel zarządzał biblioteką **istniejącym** CRUD-em i to się nie
 * zmienia: dodawanie, edycja i usuwanie dalej idą przez `/exercises` i `/tags`,
 * bo osobna ścieżka zapisu byłaby drugim miejscem, w którym trzeba pamiętać
 * o tombstonie i `server_seq`. Tutaj jest wyłącznie to, czego w CRUD-zie nie ma
 * i być nie może, bo nie jest operacją na **jednym** wierszu:
 *
 * - **widok użycia** — „czy da się to usunąć" jest pytaniem o zapisane serie
 *   wszystkich użytkowników, a nie o uprawnienia pytającego,
 * - **scalenie** — przeniesienie serii z jednego ćwiczenia na drugie i dopiero
 *   potem zdjęcie źródła; usunięcie samo w sobie zabrałoby komuś historię,
 * - **przywrócenie** — zdjęcie tombstone'a, którego zwykły CRUD nie zna,
 * - **przeliczenie wektorów** całej biblioteki, żeby lista podobnych ćwiczeń
 *   działała także dla wierszy starszych niż warstwa semantyczna.
 *
 * ## Reguła, wokół której to wszystko stoi
 *
 * Nic z zalogowanego nie ginie. Ćwiczenie z seriami i tag, na którym coś wisi,
 * nie dają się usunąć w ogóle (patrz `domain/exercises.ts` i `domain/tags.ts`) —
 * jedyną drogą do pozbycia się duplikatu jest scalenie, czyli operacja, która
 * najpierw przenosi, a dopiero potem kasuje. Dlatego scalenie **nie** jest tu
 * wygodą, tylko jedynym wyjściem z sytuacji „to samo ćwiczenie stoi w bazie dwa
 * razy, a serie mam w obu".
 *
 * ## Co się dzieje z telefonami
 *
 * Scalenie i przywrócenie są zwykłymi zapisami z nowym `updated_at`
 * i `server_seq`, więc jadą na urządzenia normalnym pullem i wygrywają LWW
 * z wersją, którą telefon ma u siebie. Nie ma tu żadnego kanału obok
 * synchronizacji i nie ma go być — inaczej urządzenie offline zostałoby
 * z seriami wskazującymi na ćwiczenie, którego już nie ma.
 */

import {
  duplicateCheckResponseSchema,
  embeddingRefreshReportSchema,
  exerciseMergeReportSchema,
  exerciseSchema,
  libraryExerciseListSchema,
  libraryTagListSchema,
  tagMergeReportSchema,
  tagSchema,
  translationRefreshReportSchema,
} from '@alphapump/core';
import { Hono } from 'hono';
import type { AppDependencies, AppEnvironment } from '../../context.js';
import { requireAdmin } from '../../middleware/authenticate.js';
import type { RouteSpec } from '../../openapi.js';
import { idParamSchema } from '../../schemas.js';
import { createLibraryEmbeddingRouter } from './embeddings.js';
import { createLibraryExerciseRouter } from './exercises.js';
import {
  libraryExercisesQuerySchema,
  libraryTagsQuerySchema,
  mergeBodySchema,
  similarQuerySchema,
} from './shared.js';
import { createLibraryTagRouter } from './tags.js';
import { createLibraryTranslationRouter } from './translations.js';

export const adminLibraryRoutes: RouteSpec[] = [
  {
    method: 'get',
    path: '/admin/library/exercises',
    summary: 'Ćwiczenia z widokiem użycia',
    description:
      'Biblioteka razem z tym, co na niej wisi: serie, użytkownicy, cele cykli i wektor. ' +
      'To te liczby, a nie uprawnienia, decydują o tym, czy wiersz da się usunąć. ' +
      'Zawsze komplet wierszy — filtrowanie należy do panelu, bo cel scalenia bywa poza filtrem.',
    tag: 'administracja',
    security: 'admin',
    query: libraryExercisesQuerySchema,
    responses: [{ status: 200, description: 'Ćwiczenia', schema: libraryExerciseListSchema }],
  },
  {
    method: 'get',
    path: '/admin/library/tags',
    summary: 'Tagi z widokiem użycia',
    description:
      'Tagi razem z liczbą ćwiczeń (osobno głównych i dodatkowych), serii zapisanych ' +
      'na tych ćwiczeniach oraz celów cyklu.',
    tag: 'administracja',
    security: 'admin',
    query: libraryTagsQuerySchema,
    responses: [{ status: 200, description: 'Tagi', schema: libraryTagListSchema }],
  },
  {
    method: 'get',
    path: '/admin/library/exercises/:id/similar',
    summary: 'Podobne ćwiczenia',
    description:
      'To samo wyszukiwanie hybrydowe, które ostrzega przed duplikatem przy tworzeniu ' +
      'ćwiczenia w aplikacji — tylko pytaniem jest nazwa istniejącego wiersza. ' +
      'Pole `layer` mówi, które warstwy się wykonały.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    query: similarQuerySchema,
    responses: [
      { status: 200, description: 'Kandydaci na duplikat', schema: duplicateCheckResponseSchema },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/exercises/:id/merge',
    summary: 'Scalenie ćwiczeń',
    description:
      'Przenosi serie i cele cyklu ze wskazanego ćwiczenia na docelowe, przelicza rekordy ' +
      'globalne po obu stronach i dopiero puste źródło oznacza jako usunięte. Typ logowania ' +
      'musi być ten sam — inaczej przeniesione serie nie pasowałyby do ćwiczenia docelowego.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    body: mergeBodySchema,
    responses: [
      { status: 200, description: 'Raport scalenia', schema: exerciseMergeReportSchema },
      { status: 404, description: 'Ćwiczenie źródłowe albo docelowe nie istnieje' },
      { status: 409, description: 'To samo ćwiczenie albo niezgodny typ logowania' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/exercises/:id/restore',
    summary: 'Przywrócenie ćwiczenia',
    description: 'Zdejmuje tombstone. Odmawia, gdy nazwa jest już zajęta u tego autora.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Ćwiczenie przywrócone', schema: exerciseSchema },
      { status: 404, description: 'Ćwiczenie nie istnieje' },
      { status: 409, description: 'Ćwiczenie nie było usunięte, kolizja nazwy albo martwy tag' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/tags/:id/merge',
    summary: 'Scalenie tagów',
    description:
      'Przepina ćwiczenia (jako tag główny i jako dodatkowy) oraz cele cyklu na tag docelowy, ' +
      'a źródłowy oznacza jako usunięty. Ćwiczeniu, które miało oba tagi, zostaje jeden — ' +
      'zestaw tagów jest zbiorem, a nie listą.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    body: mergeBodySchema,
    responses: [
      { status: 200, description: 'Raport scalenia', schema: tagMergeReportSchema },
      { status: 404, description: 'Tag źródłowy albo docelowy nie istnieje' },
      { status: 409, description: 'To sam tag' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/tags/:id/restore',
    summary: 'Przywrócenie tagu',
    description: 'Zdejmuje tombstone. Odmawia, gdy tag o tej nazwie zdążył wrócić pod innym id.',
    tag: 'administracja',
    security: 'admin',
    params: idParamSchema,
    responses: [
      { status: 200, description: 'Tag przywrócony', schema: tagSchema },
      { status: 404, description: 'Tag nie istnieje' },
      { status: 409, description: 'Tag nie był usunięty albo nazwa jest zajęta' },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/embeddings/refresh',
    summary: 'Przeliczenie wektorów biblioteki',
    description:
      'Zgłasza wszystkie żywe ćwiczenia do przeliczenia wektorów i odpowiada od razu — ' +
      'praca dzieje się poza żądaniem, bo przy większej bibliotece nie zmieściłaby się ' +
      'w limicie czasu warstwy wejściowej. Postęp widać w `/admin/stats`. ' +
      '`enabled: false` znaczy, że warstwa jest wyłączona — i nie jest to błąd.',
    tag: 'administracja',
    security: 'admin',
    responses: [
      { status: 202, description: 'Zlecenie przyjęte', schema: embeddingRefreshReportSchema },
      {
        status: 200,
        description: 'Warstwa semantyczna wyłączona — nie ma czym liczyć',
        schema: embeddingRefreshReportSchema,
      },
    ],
  },
  {
    method: 'post',
    path: '/admin/library/translations/refresh',
    summary: 'Uzupełnienie brakujących tłumaczeń',
    description:
      'Zgłasza wszystkie żywe tagi i ćwiczenia bez kompletu nazw do przetłumaczenia ' +
      'i odpowiada od razu — praca dzieje się poza żądaniem. Nazwy wpisane ręcznie ' +
      'zostają nietknięte, a wiersz z kompletem nazw nie trafia do modelu w ogóle. ' +
      '`enabled: false` znaczy, że tłumaczenie jest wyłączone — i nie jest to błąd.',
    tag: 'administracja',
    security: 'admin',
    responses: [
      { status: 202, description: 'Zlecenie przyjęte', schema: translationRefreshReportSchema },
      {
        status: 200,
        description: 'Tłumaczenie wyłączone — nie ma czym tłumaczyć',
        schema: translationRefreshReportSchema,
      },
    ],
  },
];

export function createAdminLibraryRouter(dependencies: AppDependencies) {
  const router = new Hono<AppEnvironment>();

  // Jedno wejście dla wszystkich trzech pod-routerów. Wymóg roli stoi tutaj,
  // a nie w każdym z nich osobno — inaczej dołożenie czwartego pliku byłoby
  // dołożeniem czwartej okazji, żeby o nim zapomnieć.
  router.use('/admin/library/*', requireAdmin);

  router.route('/', createLibraryExerciseRouter(dependencies));
  router.route('/', createLibraryTagRouter(dependencies));
  router.route('/', createLibraryEmbeddingRouter(dependencies));
  router.route('/', createLibraryTranslationRouter(dependencies));

  return router;
}
