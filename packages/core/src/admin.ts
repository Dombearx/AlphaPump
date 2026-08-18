/**
 * Kontrakt panelu administracyjnego i transferu danych.
 *
 * Schematy są tutaj, a nie w API, z tego samego powodu, z którego są tu wszystkie
 * pozostałe: panel jest osobną aplikacją, która czyta te odpowiedzi, a dwie
 * niezależne definicje tego samego kształtu rozjeżdżają się przy pierwszym
 * dodanym polu — cicho, bo TypeScript po obu stronach jest wtedy zadowolony.
 *
 * Rdzeń nie wie nic o Hono ani o Drizzle i wiedzieć nie musi: to zwykłe opisy
 * kształtu danych, z których API wyprowadza walidację i dokumentację OpenAPI,
 * a panel — typy odpowiedzi.
 */

import { z } from 'zod';
import { userRoleSchema, userSchema } from './schemas.js';

/* ------------------------------------------------------------------- konta */

/**
 * Konto w widoku administratora: to, co widzi każdy, plus blokada i dwie liczby,
 * po których poznaje się konto porzucone i konto w użyciu.
 */
export const adminUserSchema = userSchema.extend({
  banned: z.boolean(),
  banReason: z.string().nullable(),
  setCount: z.int().min(0),
  exerciseCount: z.int().min(0),
});

export type AdminUser = z.infer<typeof adminUserSchema>;

export const adminUserListSchema = z.object({ users: z.array(adminUserSchema) });

/**
 * Zmiana konta. Każde pole opcjonalne, ale przynajmniej jedno wymagane — żądanie,
 * które nic nie zmienia, jest zwykle pomyłką w kliencie i lepiej o niej powiedzieć
 * niż zwrócić 200 bez skutku.
 */
export const updateUserInputSchema = z
  .object({
    nickname: z.string().trim().min(1).max(40).optional(),
    role: userRoleSchema.optional(),
    banned: z.boolean().optional(),
    /** Ustawiany razem z blokadą; jej zdjęcie czyści powód. */
    banReason: z.string().trim().max(200).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'Żądanie nie zmienia żadnego pola',
  });

export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

/* --------------------------------------------------------- dane systemowe */

/**
 * Liczby, po których widać stan systemu bez zaglądania do bazy.
 *
 * Podział na grupy nie jest kosmetyką: `derived` i `duplicates` to dane
 * **odtwarzalne** (front Pareto, embeddingi, cache werdyktów), a `users`,
 * `library` i `training` — nie. Administrator patrzący na te liczby powinien od
 * razu widzieć, co da się przeliczyć, a co można tylko odtworzyć z kopii.
 */
export const systemStatsSchema = z.object({
  users: z.object({
    total: z.int().min(0),
    admins: z.int().min(0),
    banned: z.int().min(0),
  }),
  library: z.object({
    tags: z.int().min(0),
    exercises: z.int().min(0),
    builtInExercises: z.int().min(0),
    /** Wiersze z tombstonem — kandydaci dla zadania porządkowego. */
    deletedExercises: z.int().min(0),
    deletedTags: z.int().min(0),
  }),
  training: z.object({
    sets: z.int().min(0),
    deletedSets: z.int().min(0),
    cycles: z.int().min(0),
    /** Ostatni dzień, w którym ktokolwiek zapisał serię; `null` na pustej bazie. */
    lastPerformedOn: z.string().nullable(),
  }),
  derived: z.object({
    globalRecords: z.int().min(0),
  }),
  duplicates: z.object({
    semanticEnabled: z.boolean(),
    rerankerEnabled: z.boolean(),
    embeddings: z.int().min(0),
    cachedVerdicts: z.int().min(0),
  }),
});

export type SystemStats = z.infer<typeof systemStatsSchema>;

/* -------------------------------------------------- segregacja zgłoszeń */

/**
 * Wynik przeglądu zgłoszeń zwrotnych wyzwolonego z panelu — sprawdzenie,
 * klasyfikacja, założenie issue albo otwarcie dyskusji na Discordzie. Kształt
 * odpowiada `DailyReport` z `services/triage/src/alphapump_triage/models.py`;
 * `failures` jest listą, nie liczbą, bo administrator, który widzi „2 błędy",
 * i tak musi zajrzeć do logu usługi — nazwa pliku od razu mówi, którego.
 */
export const feedbackTriageReportSchema = z.object({
  scanned: z.int().min(0),
  bugs: z.int().min(0),
  changeRequests: z.int().min(0),
  duplicates: z.int().min(0),
  failures: z.array(z.object({ file: z.string(), error: z.string() })),
});

export type FeedbackTriageReport = z.infer<typeof feedbackTriageReportSchema>;

/* ------------------------------------------------------- transfer danych */

const transferCountsSchema = z.object({
  users: z.int().min(0),
  tags: z.int().min(0),
  exercises: z.int().min(0),
  sets: z.int().min(0),
  cycles: z.int().min(0),
});

/**
 * Raport importu.
 *
 * `skipped` i `notes` są w nim równie ważne jak `imported`: import, który po
 * cichu pominął połowę serii, wyglądałby dokładnie jak import udany. Odtwarzanie
 * kopii zapasowej jest tym momentem, w którym „prawdopodobnie się udało" nie
 * wystarcza.
 */
export const importReportSchema = z.object({
  scope: z.enum(['user', 'system']),
  imported: transferCountsSchema,
  skipped: transferCountsSchema,
  /** Ćwiczenia, którym po dopasowaniu autora zmienił się identyfikator. */
  remappedExercises: z.int().min(0),
  notes: z.array(z.string()),
});

export type ImportReport = z.infer<typeof importReportSchema>;

/* ---------------------------------------------------- regeneracja seeda */

/**
 * Treść `packages/db/src/seed/data.ts` złożona z żywej biblioteki konta
 * systemowego — do pobrania w panelu i wklejenia z powrotem do repozytorium.
 * Patrz `packages/db/src/seed/render.ts` po stronę generowania i
 * `routes/admin.ts` po endpoint.
 */
export const seedExportSchema = z.object({
  fileName: z.string(),
  content: z.string(),
  tags: z.int().min(0),
  exercises: z.int().min(0),
  /** Zmienione po utworzeniu nazwy — ich id w bazie nie zgadza się z tym, co da świeży seed. */
  warnings: z.array(z.string()),
});

export type SeedExport = z.infer<typeof seedExportSchema>;
