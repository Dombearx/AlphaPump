/**
 * Klient API panelu.
 *
 * Cienka warstwa nad `fetch` z jedną zasadą: **każda odpowiedź przechodzi przez
 * schemat Zod z `@alphapump/core`** — ten sam, którym API ją opisuje. Panel nie
 * ufa więc kształtowi danych na słowo; niezgodność wychodzi w miejscu odczytu,
 * a nie trzy komponenty dalej jako `undefined` w kolumnie tabeli.
 *
 * Błędy API mają jeden kształt (`{ error: { code, message } }`), więc rozpakowanie
 * komunikatu jest tu jedno i dla wszystkich wywołań. Bez tego każde miejsce
 * w panelu wyświetlałoby błąd inaczej, a część — surowe „500".
 *
 * Warstwa nie ma cache'u ani ponawiania. Jedno i drugie robi TanStack Query
 * w komponentach; dublowanie tego tutaj dałoby dwa mechanizmy unieważniania
 * o różnych regułach.
 */

import {
  adminUserListSchema,
  archiveSchema,
  exerciseSchema,
  feedbackTriageReportSchema,
  importReportSchema,
  seedExportSchema,
  systemStatsSchema,
  tagSchema,
  type AdminUser,
  type Archive,
  type CreateExerciseInput,
  type Exercise,
  type FeedbackTriageReport,
  type ImportReport,
  type SeedExport,
  type SystemStats,
  type Tag,
  type UpdateExerciseInput,
  type UpdateUserInput,
  userSchema,
} from '@alphapump/core';
import { z } from 'zod';
import { apiBase } from './config';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

const errorBodySchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Podstawiany w testach; produkcja używa `fetch` przeglądarki. */
  fetchImpl?: typeof fetch;
}

/**
 * Jedno żądanie do API.
 *
 * `credentials: 'include'` jest tu konieczne: sesja jedzie ciasteczkiem bez flagi
 * `Secure` (API działa po HTTP wewnątrz VPN), a domyślne `same-origin` nie
 * wysłałoby go w trybie deweloperskim, gdzie panel stoi na innym porcie.
 */
export async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  options: RequestOptions = {},
): Promise<T> {
  const call = options.fetchImpl ?? fetch;
  const response = await call(`${apiBase}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  });

  const text = await response.text();
  const payload: unknown = text.length === 0 ? null : JSON.parse(text);

  if (!response.ok) {
    const parsed = errorBodySchema.safeParse(payload);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.error.code : 'unknown',
      parsed.success
        ? parsed.data.error.message
        : `Serwer odpowiedział ${String(response.status)} bez czytelnego błędu`,
    );
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiError(
      response.status,
      'schema_mismatch',
      `Odpowiedź ${path} ma nieznany kształt: ${parsed.error.issues[0]?.message ?? 'brak szczegółów'}`,
    );
  }

  return parsed.data;
}

/* -------------------------------------------------------------- moje konto */

/**
 * Rola zalogowanej osoby.
 *
 * Panel pyta o nią API, a nie sesję: rola jest polem konta w bazie i może zostać
 * odebrana w trakcie trwania sesji. Sesja zna ją z chwili logowania, więc
 * ograniczanie dostępu na jej podstawie zostawiałoby ekrany otwarte długo po
 * degradacji konta — same żądania i tak by odbijały, ale panel udawałby, że
 * wszystko jest w porządku.
 */
export const meSchema = userSchema.extend({ credential: z.enum(['session', 'api-key']) });

export type Me = z.infer<typeof meSchema>;

export const getMe = (fetchImpl?: typeof fetch): Promise<Me> =>
  request('/me', meSchema, { fetchImpl });

/* ------------------------------------------------------------------- konta */

export const listUsers = (fetchImpl?: typeof fetch): Promise<AdminUser[]> =>
  request('/admin/users', adminUserListSchema, { fetchImpl }).then((body) => body.users);

export const updateUser = (
  id: string,
  input: UpdateUserInput,
  fetchImpl?: typeof fetch,
): Promise<AdminUser> =>
  request(`/admin/users/${id}`, adminUserListSchema.shape.users.element, {
    method: 'PATCH',
    body: input,
    fetchImpl,
  });

/* ----------------------------------------------------------- dane systemowe */

export const getStats = (fetchImpl?: typeof fetch): Promise<SystemStats> =>
  request('/admin/stats', systemStatsSchema, { fetchImpl });

export const pruneDuplicateCache = (
  olderThanDays: number,
  fetchImpl?: typeof fetch,
): Promise<{ removed: number }> =>
  request('/admin/duplicate-cache/prune', z.object({ removed: z.int() }), {
    method: 'POST',
    body: { olderThanDays },
    fetchImpl,
  });

/**
 * Porządkowanie tombstone'ów.
 *
 * Okna retencji panel **nie podaje**: domyślną wartość ma schemat żądania po
 * stronie serwera, a to serwer wie, jak długa jest najdłuższa realna przerwa
 * w synchronizacji urządzenia. Powtórzenie tej liczby w panelu dałoby drugie
 * miejsce do zmiany i cichy rozjazd, gdyby zmieniło się tylko jedno.
 */
export const pruneTombstones = (
  fetchImpl?: typeof fetch,
): Promise<{ removed: Record<string, number> }> =>
  request('/sync/tombstones/prune', z.object({ removed: z.record(z.string(), z.int()) }), {
    method: 'POST',
    body: {},
    fetchImpl,
  });

/* --------------------------------------------------------- zgłoszenia zwrotne */

/**
 * Ręczne wyzwolenie przeglądu zgłoszeń — sprawdzenie, klasyfikacja, założenie
 * issue albo otwarcie dyskusji na Discordzie. Ten sam przebieg co codzienny,
 * tylko na żądanie z panelu; wykonuje go `services/triage`, API jedynie
 * przekazuje wywołanie.
 */
export const runFeedbackTriage = (fetchImpl?: typeof fetch): Promise<FeedbackTriageReport> =>
  request('/admin/feedback/run', feedbackTriageReportSchema, { method: 'POST', fetchImpl });

/* -------------------------------------------------------------- biblioteka */

export const listExercises = (fetchImpl?: typeof fetch): Promise<Exercise[]> =>
  request('/exercises', z.array(exerciseSchema), { fetchImpl });

export const listTags = (fetchImpl?: typeof fetch): Promise<Tag[]> =>
  request('/tags', z.array(tagSchema), { fetchImpl });

/**
 * Utworzenie ćwiczenia. Kształt wejścia jest **rdzeniowy** (`CreateExerciseInput`),
 * a nie własny dla panelu: to ten sam kontrakt, który waliduje serwer i którego
 * używa aplikacja, więc pole dołożone w rdzeniu nie może się tu po cichu zgubić.
 */
export const createExercise = (
  input: CreateExerciseInput,
  fetchImpl?: typeof fetch,
): Promise<Exercise> =>
  request('/exercises', exerciseSchema, { method: 'POST', body: input, fetchImpl });

/**
 * Zmiana ćwiczenia. Przyjmuje **łatkę**, a nie samą nazwę: `PATCH /exercises/:id`
 * obsługuje też tagi, notatkę i siłownię, a osobna funkcja na każde pole
 * znaczyłaby tyle żądań, ile zmienionych pól — i tyle wpisów w outboksie
 * synchronizacji.
 *
 * Typu logowania nie ma w `UpdateExerciseInput` i nie jest to przeoczenie:
 * jego zmiana unieważniłaby zapisane serie.
 */
export const updateExercise = (
  id: string,
  patch: UpdateExerciseInput,
  fetchImpl?: typeof fetch,
): Promise<Exercise> =>
  request(`/exercises/${id}`, exerciseSchema, { method: 'PATCH', body: patch, fetchImpl });

export const deleteExercise = async (id: string, fetchImpl?: typeof fetch): Promise<void> => {
  await request(`/exercises/${id}`, z.null(), { method: 'DELETE', fetchImpl });
};

/**
 * Utworzenie tagu. Koloru nie podajemy — serwer wylicza go z nazwy, żeby tag
 * utworzony offline miał od razu finalny kolor, identyczny na każdym urządzeniu.
 */
export const createTag = (name: string, fetchImpl?: typeof fetch): Promise<Tag> =>
  request('/tags', tagSchema, { method: 'POST', body: { name }, fetchImpl });

export const renameTag = (id: string, name: string, fetchImpl?: typeof fetch): Promise<Tag> =>
  request(`/tags/${id}`, tagSchema, { method: 'PATCH', body: { name }, fetchImpl });

export const deleteTag = async (id: string, fetchImpl?: typeof fetch): Promise<void> => {
  await request(`/tags/${id}`, z.null(), { method: 'DELETE', fetchImpl });
};

/**
 * Treść `data.ts` złożona na nowo z aktualnej biblioteki konta systemowego —
 * do pobrania i wklejenia z powrotem do repozytorium po edycji w tym panelu.
 * Serwer niczego nie commituje: produkcja nie ma repozytorium pod ręką (obraz
 * API niesie tylko skompilowane `dist/`), więc commit i push zostają po
 * stronie osoby, która ten plik pobierze.
 */
export const exportSeedFile = (fetchImpl?: typeof fetch): Promise<SeedExport> =>
  request('/admin/seed/export', seedExportSchema, { fetchImpl });

/* ---------------------------------------------------------- transfer danych */

export const exportSystemArchive = (fetchImpl?: typeof fetch): Promise<Archive> =>
  request('/export?scope=system', archiveSchema, { fetchImpl });

export const importArchive = (archive: unknown, fetchImpl?: typeof fetch): Promise<ImportReport> =>
  request('/import', importReportSchema, { method: 'POST', body: archive, fetchImpl });
