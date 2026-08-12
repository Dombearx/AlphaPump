/**
 * Tokeny API — kształt danych i reguły, bez sieci.
 *
 * Specyfikacja daje każdemu użytkownikowi **wiele** tokenów API: służą do
 * korzystania z API poza aplikacją, na przykład przez bota Discord działającego
 * w tym samym VPN-ie. Same tokeny wydaje better-auth (plugin `apiKey`), więc tu
 * nie ma ani generowania, ani hashowania — jest wyłącznie to, co ekran musi
 * wiedzieć o odpowiedzi serwera i o nazwie wpisanej przez użytkownika.
 *
 * Moduł jest czysty i dlatego przetestowany. Ekran nie jest: to kilka pól
 * i lista, a cała logika, która mogłaby się pomylić — zawężenie odpowiedzi,
 * porządek listy i walidacja nazwy — mieszka tutaj.
 *
 * ## Sekret widać raz
 *
 * `POST /api/auth/api-key/create` zwraca pełny token **jedyny raz**; potem
 * serwer trzyma już tylko jego hash i kilka pierwszych znaków. Nie ma więc
 * ekranu „pokaż token ponownie" i nie może być — zgubiony token się unieważnia
 * i tworzy nowy. Stąd `ApiKeySummary` nie ma pola na sekret: to, czego nie da
 * się odzyskać, nie powinno mieć miejsca w modelu listy.
 */

import { toIsoDate, type IsoDate } from '@alphapump/core';
import { z } from 'zod';
import { formatDate } from './day-labels';

/** Nazwa tokenu jest etykietą dla człowieka — „bot Discord", „skrypt na laptopie". */
export const API_KEY_NAME_MAX_LENGTH = 40;

/**
 * Token w kształcie, który pokazuje lista.
 *
 * Celowo węższy niż odpowiedź better-autha: reszta jego pól (limity, wygasanie,
 * uprawnienia) należy do konfiguracji serwera, a nie do decyzji użytkownika,
 * więc pokazywanie ich sugerowałoby, że da się je tu zmienić.
 */
export interface ApiKeySummary {
  id: string;
  name: string;
  /** Pierwsze znaki tokenu — jedyny jego fragment, jaki serwer oddaje później. */
  start: string | null;
  createdAt: Date;
  /** Ostatnie użycie; `null` znaczy „jeszcze nigdy". */
  lastUsedAt: Date | null;
}

/**
 * Odpowiedź better-autha zawężona do tego, na czym stoi ekran.
 *
 * `createdAt` bywa datą albo napisem ISO — zależnie od tego, czy odpowiedź
 * przeszła przez deserializację klienta, czy przez zwykły `JSON.parse`.
 * `coerce` przyjmuje jedno i drugie, więc ekran nie musi o tym wiedzieć.
 */
const apiKeyRowSchema = z.object({
  id: z.string().min(1),
  name: z.string().nullish(),
  start: z.string().nullish(),
  createdAt: z.coerce.date(),
  lastRequest: z.coerce.date().nullish(),
});

/** Etykieta tokenu bez nazwy — starsze wpisy i tokeny wydane spoza aplikacji. */
export const UNNAMED_API_KEY = 'Token bez nazwy';

/**
 * Zawęża i porządkuje odpowiedź serwera. Wiersz w nieznanym kształcie jest
 * pomijany, a nie wywraca listy: jeden dziwny wpis nie może odciąć użytkownika
 * od unieważnienia pozostałych.
 */
export function toApiKeySummaries(rows: readonly unknown[]): ApiKeySummary[] {
  const summaries: ApiKeySummary[] = [];

  for (const row of rows) {
    const parsed = apiKeyRowSchema.safeParse(row);
    if (!parsed.success) continue;

    summaries.push({
      id: parsed.data.id,
      name: parsed.data.name?.trim() ? parsed.data.name.trim() : UNNAMED_API_KEY,
      start: parsed.data.start ?? null,
      createdAt: parsed.data.createdAt,
      lastUsedAt: parsed.data.lastRequest ?? null,
    });
  }

  // Najnowsze u góry — świeżo utworzony token ma się pokazać tam, gdzie patrzy
  // użytkownik. Remis rozstrzyga identyfikator, żeby kolejność była stabilna.
  return summaries.sort(
    (a, b) =>
      b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

/** Nazwa po sprzątnięciu: bez brzegowych spacji, bez ciągów spacji, przycięta. */
export function normalizeApiKeyName(input: string): string {
  return input.trim().replace(/\s+/g, ' ').slice(0, API_KEY_NAME_MAX_LENGTH);
}

/**
 * Powód, dla którego nazwy nie da się użyć — albo `null`, gdy jest w porządku.
 *
 * Nazwa jest wymagana, bo token bez niej jest nie do odróżnienia od innych
 * w chwili, w której trzeba unieważnić dokładnie jeden.
 */
export function apiKeyNameProblem(input: string): string | null {
  return normalizeApiKeyName(input).length === 0 ? 'Podaj nazwę — po niej poznasz token' : null;
}

/**
 * Podpis pod nazwą tokenu: kiedy powstał i kiedy był ostatnio używany.
 *
 * Data ostatniego użycia jest tu jedyną odpowiedzią na pytanie „czy ten token
 * jeszcze do czegoś służy" — a to ono pada, zanim ktoś go unieważni.
 */
export function describeApiKey(key: ApiKeySummary, today: IsoDate): string {
  const created = `utworzony ${formatDate(toIsoDate(key.createdAt), today)}`;
  const used =
    key.lastUsedAt === null
      ? 'jeszcze nieużywany'
      : `ostatnio użyty ${formatDate(toIsoDate(key.lastUsedAt), today)}`;

  return `${created} · ${used}`;
}

/** Token na liście widać wyłącznie po początku — reszty serwer już nie zna. */
export function maskApiKey(key: ApiKeySummary): string {
  return key.start === null || key.start.length === 0 ? '••••' : `${key.start}••••`;
}
