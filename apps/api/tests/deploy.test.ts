/**
 * Kontrakt między API a warstwą wejściową wdrożenia.
 *
 * Na produkcji Caddy rozdziela ruch **ścieżką**: część wzorców idzie do API,
 * reszta do panelu, który na każdą nieznaną ścieżkę oddaje `index.html` ze
 * statusem 200. Nowa trasa API, której nikt nie dopisał do `deploy/Caddyfile`,
 * nie daje więc 404, tylko stronę HTML z kodem sukcesu — a klient zgłasza to jako
 * błąd parsowania JSON-a w losowym miejscu. Awaria jest przy tym niewidoczna
 * lokalnie, bo w trybie deweloperskim nikt Caddy'ego nie uruchamia.
 *
 * Test pilnuje obu kierunków rozdziału:
 *
 * 1. każda trasa opisana w OpenAPI trafia do API,
 * 2. żadna trasa panelu do API nie trafia.
 *
 * Drugi kierunek wymaga sięgnięcia do źródła panelu. Robimy to napisem, a nie
 * importem, bo import pociągnąłby komponenty Reacta do testu backendu — a jedyne,
 * czego tu potrzeba, to lista ścieżek routera.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { documentedRoutes } from '../src/app.js';

const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
const caddyfile = readFileSync(`${repositoryRoot}deploy/Caddyfile`, 'utf8');
const adminRouter = readFileSync(`${repositoryRoot}apps/admin/src/router.tsx`, 'utf8');

/**
 * Trasy spoza opisu OpenAPI, które mimo to muszą dojść do API: obsługa logowania
 * (better-auth montuje własne podtrasy) i sam dokument.
 */
const UNDOCUMENTED_API_PATHS = ['/api/auth/sign-in/email', '/openapi.json'];

/**
 * Wzorce ścieżek z nazwanego dopasowania `@api`. Caddy łamie długie linie
 * odwrotnym ukośnikiem, więc najpierw sklejamy je z powrotem.
 */
function proxiedPatterns(configuration: string): string[] {
  const joined = configuration.replace(/\\\r?\n\s*/g, ' ');
  const match = /^\s*@api\s+path\s+(.+)$/m.exec(joined);
  if (!match?.[1]) throw new Error('Nie znalazłem dopasowania `@api path …` w deploy/Caddyfile');
  return match[1].trim().split(/\s+/);
}

/** Dopasowanie ścieżki po regułach Caddy'ego: gwiazdka na końcu albo równość. */
function matchesPattern(pattern: string, path: string): boolean {
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1));
  return pattern === path;
}

/** `/sets/:id` → `/sets/przykład`; wzorce Caddy'ego nie znają parametrów Hono. */
function sampleRequestPath(honoPath: string): string {
  return honoPath.replace(/:[^/]+/g, 'przykład');
}

/** Ścieżki routera panelu — źródło jest w `apps/admin/src/router.tsx`. */
function panelPaths(source: string): string[] {
  const paths = [...source.matchAll(/path:\s*'([^']+)'/g)].map((match) => match[1] as string);
  // Zero dopasowań znaczy, że panel przestawił się na inny zapis tras, a nie że
  // tras nie ma. Test ma wtedy krzyknąć, a nie przejść na pustej liście.
  if (paths.length === 0)
    throw new Error('Nie znalazłem żadnej ścieżki w apps/admin/src/router.tsx');
  return paths;
}

describe('rozdział ruchu w deploy/Caddyfile', () => {
  const patterns = proxiedPatterns(caddyfile);

  it.each(documentedRoutes.map((route) => route.path))('trasa API %s trafia do API', (honoPath) => {
    const path = sampleRequestPath(honoPath);
    expect(
      patterns.some((pattern) => matchesPattern(pattern, path)),
      `${path} nie pasuje do żadnego wzorca @api — Caddy odda na nią panel`,
    ).toBe(true);
  });

  it.each(UNDOCUMENTED_API_PATHS)('trasa %s trafia do API mimo braku opisu', (path) => {
    expect(patterns.some((pattern) => matchesPattern(pattern, path))).toBe(true);
  });

  it.each(panelPaths(adminRouter))('trasa panelu %s zostaje przy panelu', (path) => {
    expect(
      patterns.some((pattern) => matchesPattern(pattern, path)),
      `${path} pasuje do wzorca @api — panel dostanie pod tym adresem odpowiedź API`,
    ).toBe(false);
  });

  it('nie proxuje ścieżki, której API nie obsługuje', () => {
    // Wzorzec bez pokrycia w trasach to albo literówka, albo pozostałość po
    // usuniętym endpoincie. Jedno i drugie zabiera panelowi ścieżkę.
    const covered = new Set(
      documentedRoutes
        .map((route) => sampleRequestPath(route.path))
        .concat(UNDOCUMENTED_API_PATHS)
        .flatMap((path) => patterns.filter((pattern) => matchesPattern(pattern, path))),
    );
    expect([...patterns].filter((pattern) => !covered.has(pattern))).toEqual([]);
  });
});

/**
 * Seed przy starcie serwera.
 *
 * Testu na `main()` nie ma jak napisać uczciwie — wchodzi tam nasłuch na porcie
 * — a to jest dokładnie ten jeden wiersz, którego brak nie zgłasza się niczym
 * poza cichym rozjazdem danych: telefon seeduje swoją bazę sam, więc aplikacja
 * pokazuje ćwiczenia wbudowane, których serwer i panel administracyjny nie
 * widzą. Sprawdzamy więc źródło: seed **jest** i jedzie **po** migracjach.
 */
describe('start serwera', () => {
  const entrypoint = readFileSync(`${repositoryRoot}apps/api/src/index.ts`, 'utf8');

  it('wypełnia bazę danymi startowymi po migracjach', () => {
    const migrations = entrypoint.indexOf('await runMigrations(');
    const seed = entrypoint.indexOf('await seedPostgres(');

    expect(migrations, 'start serwera nie uruchamia migracji').toBeGreaterThan(-1);
    expect(
      seed,
      'start serwera nie uruchamia seeda — biblioteka wbudowana nigdy nie powstanie',
    ).toBeGreaterThan(-1);
    expect(seed).toBeGreaterThan(migrations);
  });
});
