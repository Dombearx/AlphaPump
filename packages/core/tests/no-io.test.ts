/**
 * Strażnik kryterium ukończenia etapu 1: pakiet nie ma żadnej zależności od I/O.
 *
 * To nie jest test kosmetyczny. Gdy do rdzenia wejdzie odczyt bazy, zapytanie
 * sieciowe albo zmienna środowiskowa, przestanie on być tym samym kodem po obu
 * stronach — na telefonie w Hermesie po prostu się wywali, i to dopiero na
 * urządzeniu.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src', import.meta.url));

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') ? [path] : [];
  });
}

const files = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  source: readFileSync(path, 'utf8'),
}));

/** Wszystko poza tym musi być importem względnym. */
const ALLOWED_DEPENDENCIES = new Set(['zod', 'uuid']);

const IMPORT_PATTERN = /(?:from|import)\s+'([^']+)'/g;

describe('rdzeń domenowy nie dotyka I/O', () => {
  it('ma co sprawdzać', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files)('$path importuje wyłącznie dozwolone pakiety', ({ source }) => {
    const specifiers = [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] as string);
    const external = specifiers.filter((specifier) => !specifier.startsWith('.'));
    for (const specifier of external) {
      expect(ALLOWED_DEPENDENCIES.has(specifier)).toBe(true);
    }
  });

  it.each(files)('$path nie sięga po sieć, dysk ani środowisko', ({ source }) => {
    const forbidden = [
      /\bfetch\s*\(/,
      /\bXMLHttpRequest\b/,
      /\brequire\s*\(/,
      /\bprocess\.env\b/,
      /\blocalStorage\b/,
      /\bnode:/,
    ];
    for (const pattern of forbidden) {
      expect(source).not.toMatch(pattern);
    }
  });

  it.each(files)('$path nie czyta zegara w sposób ukryty', ({ source }) => {
    // Czas zawsze wchodzi do rdzenia jawnie, argumentem. Inaczej ta sama seria
    // dawałaby różne wyniki na telefonie i na serwerze.
    expect(source).not.toMatch(/\bDate\.now\s*\(/);
    expect(source).not.toMatch(/new Date\s*\(\s*\)/);
  });
});
