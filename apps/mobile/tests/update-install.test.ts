/**
 * Instalacja pakietu widziana od strony użytkownika.
 *
 * Wydanie natywne pobiera się i instaluje **w aplikacji**, więc okno musi umieć
 * powiedzieć, co się właśnie dzieje — a to jest jedyna część tej drogi, którą
 * da się sprawdzić bez telefonu. Testy pilnują dwóch rzeczy: że postęp bez
 * znanego rozmiaru dalej jest postępem, a nie paskiem donikąd, i że nieudana
 * instalacja mówi, co dalej, zamiast kończyć się pustym oknem.
 */

import { describe, expect, it } from 'vitest';
import { describeInstallFailure, downloadFraction, downloadLabel } from '../src/update/install';

describe('downloadLabel', () => {
  it('pokazuje pobrane obok całości', () => {
    expect(downloadLabel(24_000_000, 62_000_000)).toBe('24 MB / 62 MB');
  });

  it('bez znanej całości mówi tylko o tym, co przyszło', () => {
    // `Content-Length` bywa nieobecny — wtedy „24 MB" jest całą prawdą, jaką
    // mamy, a wymyślony procent byłby paskiem, który nie dojeżdża do końca.
    expect(downloadLabel(24_000_000, null)).toBe('24 MB so far');
    expect(downloadLabel(24_000_000, 0)).toBe('24 MB so far');
  });
});

describe('downloadFraction', () => {
  it('liczy ułamek, gdy wiadomo z czego', () => {
    expect(downloadFraction(31_000_000, 62_000_000)).toBe(0.5);
  });

  it('nie przekracza jedynki', () => {
    // Pasek szerszy niż jego tor wygląda na błąd aplikacji, a nie serwera,
    // który podał mniejszy `Content-Length`, niż potem przysłał.
    expect(downloadFraction(70_000_000, 62_000_000)).toBe(1);
  });

  it('bez całości nie zgaduje', () => {
    expect(downloadFraction(24_000_000, null)).toBeNull();
    expect(downloadFraction(24_000_000, 0)).toBeNull();
  });
});

describe('describeInstallFailure', () => {
  it('mówi, co dalej, i dokleja powód od systemu', () => {
    const described = describeInstallFailure(new Error('No activity found to handle Intent'));

    expect(described).toContain('use the browser');
    expect(described).toContain('(No activity found to handle Intent)');
  });

  it('bez powodu zostaje samo zdanie', () => {
    expect(describeInstallFailure(undefined)).not.toContain('(');
    expect(describeInstallFailure(new Error('   '))).not.toContain('(');
  });
});
