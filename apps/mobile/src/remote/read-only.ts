/**
 * Odczyt danych, których nie ma i nie będzie w bazie lokalnej.
 *
 * Cała reszta aplikacji czyta z SQLite i działa bez sieci — to jest reguła,
 * a nie preferencja. Rekordy globalne i rankingi są **jedynym** wyjątkiem i
 * wyjątkiem koniecznym: liczą się z serii wszystkich użytkowników, a cudze serie
 * są prywatne i nigdy nie zjadą na telefon. Nie da się ich policzyć lokalnie,
 * bo nie ma z czego.
 *
 * Wynika z tego kształt tej warstwy:
 *
 * - **tylko odczyt** — niczego tu nie zapisujemy i nie kolejkujemy w outboxie,
 * - **bez cache'u** — dane pochodne serwera zmieniają się po każdym cudzym
 *   treningu, a nieświeży ranking pokazany jako świeży jest gorszy niż jego brak,
 * - **brak sieci to nie błąd** — ekran mówi wtedy „offline" i pokazuje przycisk
 *   ponowienia, tak samo jak odznaka synchronizacji.
 *
 * Klasy błędów są te same co przy synchronizacji — telefon poza VPN-em
 * zachowuje się tu tak samo jak przy pushu: spokojnie, bez komunikatu o awarii.
 *
 * Adres API i sesję moduł dostaje z zewnątrz, a nie czyta sam. Sięgnięcie po nie
 * wprost wciągnęłoby tu `expo-constants` i klienta better-auth, czyli moduły
 * natywne — a wtedy tej warstwy nie dałoby się przetestować poza urządzeniem.
 * Gotowy czytnik składa `reader.ts`.
 */

import {
  duplicateCheckResponseSchema,
  globalRecordsResponseSchema,
  rankingResponseSchema,
  type DuplicateCheckResponse,
  type GlobalRecord,
  type RankingEntry,
  type RankingMetric,
} from '@alphapump/core';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../sync/transport';

const TIMEOUT_MS = 10_000;

export interface RemoteReaderOptions {
  /** Adres API bez końcowego ukośnika. */
  baseUrl: string;
  /** Ciasteczko sesji; funkcja, bo sesja zmienia się częściej niż czytnik. */
  cookie: () => string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export interface RemoteReader {
  globalRecords(exerciseId: string): Promise<GlobalRecord[]>;
  ranking(metric: RankingMetric): Promise<RankingEntry[]>;
  /**
   * Dokładniejsze wykrywanie duplikatów ćwiczeń (etap 12).
   *
   * Trzeci odczyt sieciowy w aplikacji i jedyny, którego brak **nic nie psuje**:
   * ostrzeżenie o podobnych ćwiczeniach liczy się lokalnie z pisowni i działa
   * offline. Serwer dokłada do niego dopasowanie po znaczeniu („martwy ciąg"
   * i „deadlift") oraz uzasadnienie od modelu — czyli trafność, nie funkcję.
   * Dlatego wołający traktuje brak odpowiedzi jak brak wyniku, a nie jak awarię.
   */
  similarExercises(name: string, excludeId?: string | null): Promise<DuplicateCheckResponse>;
}

export function createRemoteReader(options: RemoteReaderOptions): RemoteReader {
  const { baseUrl, cookie } = options;

  const read = async (path: string): Promise<unknown> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? TIMEOUT_MS);
    const call = options.fetchImpl ?? fetch;

    let response: Response;
    try {
      response = await call(`${baseUrl}${path}`, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', cookie: cookie() },
      });
    } catch (error) {
      // Brak trasy do hosta i nasz timeout znaczą to samo: jesteśmy poza VPN-em.
      throw new SyncOfflineError(error);
    } finally {
      clearTimeout(timeout);
    }

    if (response.status === 401 || response.status === 403) throw new SyncAuthError();
    if (!response.ok) {
      throw new SyncServerError(`Serwer odpowiedział ${String(response.status)}`, response.status);
    }

    try {
      return (await response.json()) as unknown;
    } catch (error) {
      throw new SyncServerError(`Odpowiedź serwera nie jest poprawnym JSON-em: ${String(error)}`);
    }
  };

  return {
    async globalRecords(exerciseId) {
      const body = await read(`/exercises/${exerciseId}/records`);
      const parsed = globalRecordsResponseSchema.safeParse(body);
      if (!parsed.success) throw new SyncServerError('Odpowiedź o rekordach ma nieznany kształt');
      return parsed.data.records;
    },

    async ranking(metric) {
      const body = await read(`/rankings?metric=${metric}`);
      const parsed = rankingResponseSchema.safeParse(body);
      if (!parsed.success) throw new SyncServerError('Odpowiedź rankingu ma nieznany kształt');
      return parsed.data.entries;
    },

    async similarExercises(name, excludeId = null) {
      const query = new URLSearchParams({ name });
      if (excludeId !== null) query.set('excludeId', excludeId);

      const body = await read(`/exercises/similar?${query.toString()}`);
      const parsed = duplicateCheckResponseSchema.safeParse(body);
      if (!parsed.success) {
        throw new SyncServerError('Odpowiedź o podobnych ćwiczeniach ma nieznany kształt');
      }
      return parsed.data;
    },
  };
}
