/**
 * Instalacja pakietu widziana od strony użytkownika: w czym jesteśmy i co o tym
 * napisać.
 *
 * Osobno od `apk.ts`, bo to są dwie różne rzeczy: tam są wywołania systemu,
 * tutaj reguły. Reguły dają się przetestować bez telefonu, wywołania nie —
 * ten sam podział, co między `manifest.ts` a `expo.ts`.
 *
 * Stanów jest cztery, bo tyle jest rzeczy, które użytkownik może w tej chwili
 * zobaczyć: nic (okno dopiero pyta), pasek postępu, „zaraz odezwie się system"
 * i wyjaśnienie, czemu nie wyszło. Ostatni nie jest ślepą uliczką: pobranie
 * z minipc zależy od VPN-u i potrafi się nie udać z powodu, który za minutę
 * zniknie, więc zostaje przy nim droga przez przeglądarkę — ta sama, którą szło
 * się do tej pory.
 */

import { formatBytes } from './manifest';

export type InstallStage =
  /** Jeszcze nic nie robimy — okno pyta, czy pobrać. */
  | { kind: 'idle' }
  /** Plik jedzie. `total` jest `null`, dopóki nie wiadomo, ile go będzie. */
  | { kind: 'downloading'; received: number; total: number | null }
  /** Plik jest na dysku, instalator systemu został poproszony o otwarcie. */
  | { kind: 'installing' }
  /** Nie wyszło. Zostaje przeglądarka. */
  | { kind: 'failed'; reason: string };

/**
 * Napis pod przyciskiem w trakcie pobierania — „24 / 62 MB".
 *
 * Bez procentów, gdy nie wiadomo, ile pliku będzie: „24 MB" jest wtedy całą
 * prawdą, jaką mamy, a wymyślony procent byłby paskiem, który nie dojeżdża
 * do końca.
 */
export function downloadLabel(received: number, total: number | null): string {
  if (total === null || total <= 0) return `${formatBytes(received)} so far`;
  return `${formatBytes(received)} / ${formatBytes(total)}`;
}

/**
 * Ułamek pobrania do paska postępu albo `null`, gdy nie da się go policzyć.
 *
 * Ucinany do jedynki, bo `Content-Length` bywa mniejszy niż to, co naprawdę
 * przyjdzie (kompresja w locie po drodze), a pasek szerszy niż jego tor wygląda
 * na błąd aplikacji, a nie serwera.
 */
export function downloadFraction(received: number, total: number | null): number | null {
  if (total === null || total <= 0) return null;
  return Math.min(1, received / total);
}

/**
 * Zdanie o nieudanej instalacji.
 *
 * Powód od systemu wchodzi **w nawiasie i bez tłumaczenia**: jest po angielsku,
 * przyszedł z zewnątrz i przepisany własnymi słowami byłby opisem błędu,
 * którego nie widzieliśmy. Tak samo robi `running.ts` ze startem awaryjnym.
 */
export function describeInstallFailure(error: unknown): string {
  const detail = error instanceof Error ? error.message.trim() : '';
  const base = 'Could not install it from here. Make sure you are on the VPN, or use the browser.';
  return detail === '' ? base : `${base} (${detail})`;
}
