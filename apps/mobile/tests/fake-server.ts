/**
 * Serwer synchronizacji w pamięci.
 *
 * Nie jest atrapą zwracającą przygotowane odpowiedzi — implementuje protokół:
 * nadaje `server_seq` z jednej sekwencji, przycina znaczniki czasu z przyszłości
 * i rozstrzyga konflikty **tą samą funkcją z `@alphapump/core`**, którą robi to
 * prawdziwe API. Dzięki temu test „dwa urządzenia offline" sprawdza zachowanie
 * aplikacji, a nie zgodność z wymyślonymi odpowiedziami.
 *
 * Czego tu nie ma: uwierzytelnienia, uprawnień i trwałości. Te sprawdzają testy
 * integracyjne `@alphapump/api` — powtarzanie ich tutaj oznaczałoby utrzymywanie
 * drugiej implementacji serwera.
 *
 * Dwie reguły spoza LWW są tu jednak odwzorowane, bo bez nich testy
 * przepuściłyby najgorsze z możliwych błędów: **seria wskazująca na nieznane
 * ćwiczenie jest odrzucana** i **ćwiczenie z tagiem, którego serwer nie zna,
 * jest odrzucane** — jak w `apps/api/src/sync/push/`. Pierwsza zżarła serie
 * zapisane na bibliotece wbudowanej, dopóki serwer nie dostawał seeda; druga
 * jest tą, przez którą telefon zostawał z tagiem głównym, którego serwer nigdy
 * nie przyjął.
 *
 * Odmowa oddaje przy tym **wiersz serwerowy**, tak jak `reject` w prawdziwym
 * pushu — to on jest jedyną drogą, którą telefon może wrócić do wersji leżącej
 * na serwerze.
 */

import {
  clampRevision,
  isWrite,
  resolveSyncConflict,
  slug,
  tagColor,
  type SyncChanges,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResponse,
  type SyncResult,
  type SyncRevision,
  type SyncedCycle,
  type SyncedExercise,
  type SyncedTag,
  type SyncedUser,
  type SyncedWorkoutSet,
} from '@alphapump/core';
import { SEED_EXERCISES, SEED_TAGS, SEED_TIMESTAMP } from '@alphapump/db';
import type { SyncTransport } from '../src/sync/transport';

type Stored<T> = T & { deviceId: string | null };

interface Row {
  serverSeq: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  deviceId: string | null;
}

export interface FakeServerOptions {
  /** Kim jest właściciel serii — fałszywy serwer ma jedno konto. */
  userId: string;
  /** Zegar serwera; domyślnie prawdziwy. */
  now?: () => Date;
  /**
   * Czy serwer ma bibliotekę wbudowaną. Domyślnie ma, bo tak wygląda produkcja:
   * seed jedzie przy każdym starcie serwera. `'empty'` odtwarza bazę sprzed tej
   * poprawki — i służy wyłącznie do sprawdzenia, że telefon sobie z nią radzi.
   */
  library?: 'seeded' | 'empty';
}

export class FakeSyncServer implements SyncTransport {
  private sequence = 0;
  private readonly users = new Map<string, Stored<SyncedUser>>();
  private readonly tags = new Map<string, Stored<SyncedTag>>();
  private readonly exercises = new Map<string, Stored<SyncedExercise>>();
  private readonly cycles = new Map<string, Stored<SyncedCycle>>();
  private readonly sets = new Map<string, Stored<SyncedWorkoutSet>>();

  /** Liczniki do sprawdzania, że aplikacja nie dobija się do sieci bez potrzeby. */
  pushCalls = 0;
  pullCalls = 0;
  /** Ustawione na błąd sprawia, że każde żądanie kończy się tym błędem. */
  failWith: Error | null = null;
  /**
   * Wołane na początku pushu, zanim serwer cokolwiek rozstrzygnie. Jedyny
   * sposób, żeby w teście zapisać coś lokalnie **w trakcie** wymiany — a to jest
   * ten przypadek, dla którego wersja lokalna ma pierwszeństwo nad odpowiedzią.
   */
  beforePush: (() => Promise<void>) | null = null;
  /**
   * Wiersze, których serwer nie przyjmie, cokolwiek by przyszło — po
   * identyfikatorze, niezależnie od encji. Prawdziwy serwer odrzuca z paru
   * powodów (cudzy wiersz, niespójne pomiary, reguła tylko dla administratora);
   * testom wystarczy jeden, żeby sprawdzić, co telefon robi z odmową.
   */
  readonly refuse = new Set<string>();

  constructor(private readonly options: FakeServerOptions) {
    if (options.library !== 'empty') this.seedLibrary();
  }

  private get now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private next(): number {
    this.sequence += 1;
    return this.sequence;
  }

  private guard(): void {
    if (this.failWith !== null) throw this.failWith;
  }

  /** Wstawia bibliotekę wbudowaną — tak jak robi to seed serwera przy starcie. */
  seedLibrary(): void {
    const at = SEED_TIMESTAMP.toISOString();

    for (const tag of SEED_TAGS) {
      this.tags.set(tag.id, {
        id: tag.id,
        name: tag.name,
        slug: tag.slug,
        translations: null,
        color: tag.color,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        serverSeq: this.next(),
        deviceId: null,
      });
    }

    for (const exercise of SEED_EXERCISES) {
      this.exercises.set(exercise.id, {
        id: exercise.id,
        name: exercise.name,
        slug: exercise.slug,
        translations: null,
        authorId: exercise.authorId,
        loggingType: exercise.loggingType,
        primaryTagId: exercise.primaryTagId,
        additionalTagIds: [...exercise.additionalTagIds],
        note: null,
        gym: null,
        createdAt: at,
        updatedAt: at,
        deletedAt: null,
        serverSeq: this.next(),
        deviceId: null,
      });
    }
  }

  /** Wstawia konto, żeby pull miał czym zaspokoić klucz obcy serii. */
  seedUser(user: { id: string; email: string | null; nickname: string }): void {
    const at = new Date(0).toISOString();
    this.users.set(user.id, {
      ...user,
      role: 'user',
      createdAt: at,
      updatedAt: at,
      deletedAt: null,
      serverSeq: this.next(),
      deviceId: null,
    });
  }

  async push(request: SyncPushRequest): Promise<SyncPushResponse> {
    this.guard();
    this.pushCalls += 1;
    if (this.beforePush) await this.beforePush();

    const now = this.now;
    const results: SyncResult[] = [];
    const changes: SyncChanges = { users: [], tags: [], exercises: [], cycles: [], sets: [] };

    for (const incoming of request.tags) {
      const revision = clampRevision(revisionOf(incoming, request.deviceId), now);
      const decision = resolveSyncConflict(existing(this.tags.get(incoming.id)), revision);

      if (this.refuse.has(incoming.id)) {
        results.push({
          entity: 'tag',
          id: incoming.id,
          decision: 'rejected',
          reason: 'slug_taken',
          reasonDetail: incoming.name,
        });
        const known = this.tags.get(incoming.id);
        if (known) changes.tags.push(strip(known));
        continue;
      }

      if (isWrite(decision)) {
        // Kolor przydziela serwer, tak jak prawdziwy: nowy tag dostaje wolny
        // z palety, znany zatrzymuje ten, który już ma.
        const known = this.tags.get(incoming.id);
        const taken = [...this.tags.values()]
          .filter((tag) => tag.deletedAt === null && tag.id !== incoming.id)
          .map((tag) => tag.color);

        this.tags.set(incoming.id, {
          id: incoming.id,
          name: incoming.name,
          slug: slug(incoming.name),
          translations: null,
          color: known && known.deletedAt === null ? known.color : tagColor(incoming.name, taken),
          ...revision,
          serverSeq: this.next(),
        });
      }

      results.push({ entity: 'tag', id: incoming.id, decision, reason: null, reasonDetail: null });
      changes.tags.push(strip(this.tags.get(incoming.id) as Stored<SyncedTag>));
    }

    for (const incoming of request.exercises) {
      const revision = clampRevision(revisionOf(incoming, request.deviceId), now);
      const decision = resolveSyncConflict(existing(this.exercises.get(incoming.id)), revision);

      // Druga reguła spoza LWW: **ćwiczenie z tagiem, którego serwer nie zna,
      // jest odrzucane** — dokładnie jak w `apps/api/src/sync/push/exercises.ts`.
      // Odmowa oddaje przy tym wiersz serwerowy, bo bez niego telefon nie miałby
      // jak wrócić do wersji, która na serwerze faktycznie leży.
      const known = this.exercises.get(incoming.id);
      const unknownTag = [incoming.primaryTagId, ...incoming.additionalTagIds].find(
        (id) => !this.tags.has(id),
      );
      if (this.refuse.has(incoming.id) || unknownTag !== undefined) {
        results.push({
          entity: 'exercise',
          id: incoming.id,
          decision: 'rejected',
          reason: unknownTag === undefined ? 'not_author' : 'missing_tags',
          reasonDetail: unknownTag ?? null,
        });
        if (known) changes.exercises.push(strip(known));
        continue;
      }

      if (isWrite(decision)) {
        this.exercises.set(incoming.id, {
          id: incoming.id,
          name: incoming.name,
          slug: slug(incoming.name),
          translations: null,
          authorId: incoming.authorId,
          loggingType: incoming.loggingType,
          primaryTagId: incoming.primaryTagId,
          additionalTagIds: incoming.additionalTagIds,
          note: incoming.note,
          gym: incoming.gym,
          ...revision,
          serverSeq: this.next(),
        });
      }

      results.push({
        entity: 'exercise',
        id: incoming.id,
        decision,
        reason: null,
        reasonDetail: null,
      });
      changes.exercises.push(strip(this.exercises.get(incoming.id) as Stored<SyncedExercise>));
    }

    for (const incoming of request.cycles) {
      const revision = clampRevision(revisionOf(incoming, request.deviceId), now);
      const decision = resolveSyncConflict(existing(this.cycles.get(incoming.id)), revision);

      if (isWrite(decision)) {
        this.cycles.set(incoming.id, {
          id: incoming.id,
          userId: this.options.userId,
          name: incoming.name,
          startsOn: incoming.startsOn,
          endsOn: incoming.endsOn,
          archivedAt: incoming.archivedAt,
          goals: incoming.goals,
          ...revision,
          serverSeq: this.next(),
        });
      }

      results.push({
        entity: 'cycle',
        id: incoming.id,
        decision,
        reason: null,
        reasonDetail: null,
      });
      changes.cycles.push(strip(this.cycles.get(incoming.id) as Stored<SyncedCycle>));
    }

    for (const incoming of request.sets) {
      const revision = clampRevision(revisionOf(incoming, request.deviceId), now);
      const decision = resolveSyncConflict(existing(this.sets.get(incoming.id)), revision);

      if (this.refuse.has(incoming.id) || !this.exercises.has(incoming.exerciseId)) {
        results.push({
          entity: 'set',
          id: incoming.id,
          decision: 'rejected',
          reason: this.refuse.has(incoming.id) ? 'not_owner' : 'missing_exercise',
          reasonDetail: null,
        });
        continue;
      }

      if (isWrite(decision)) {
        this.sets.set(incoming.id, {
          id: incoming.id,
          userId: this.options.userId,
          exerciseId: incoming.exerciseId,
          performedOn: incoming.performedOn,
          position: incoming.position,
          weightG: incoming.weightG,
          reps: incoming.reps,
          durationS: incoming.durationS,
          distanceM: incoming.distanceM,
          bodyweightG: incoming.bodyweightG,
          note: incoming.note,
          ...revision,
          serverSeq: this.next(),
        });
      }

      results.push({ entity: 'set', id: incoming.id, decision, reason: null, reasonDetail: null });
      changes.sets.push(strip(this.sets.get(incoming.id) as Stored<SyncedWorkoutSet>));
    }

    return {
      serverTime: now.toISOString(),
      cursor: this.sequence,
      results,
      changes,
    };
  }

  async pull(since: number, limit = 500): Promise<SyncPullResponse> {
    this.guard();
    this.pullCalls += 1;

    const candidates = [
      ...[...this.users.values()].map((row) => ({ kind: 'users', row }) as const),
      ...[...this.tags.values()].map((row) => ({ kind: 'tags', row }) as const),
      ...[...this.exercises.values()].map((row) => ({ kind: 'exercises', row }) as const),
      ...[...this.cycles.values()].map((row) => ({ kind: 'cycles', row }) as const),
      ...[...this.sets.values()].map((row) => ({ kind: 'sets', row }) as const),
    ]
      .filter(({ row }) => row.serverSeq > since)
      .sort((a, b) => a.row.serverSeq - b.row.serverSeq);

    const batch = candidates.slice(0, limit);
    const changes: SyncChanges = { users: [], tags: [], exercises: [], cycles: [], sets: [] };

    for (const { kind, row } of batch) {
      // Wariant sprowadzony do wspólnego typu — kształt pilnowany jest przez
      // budowanie mapy wyżej, a nie przez to przypisanie.
      (changes[kind] as unknown[]).push(strip(row));
    }

    return {
      serverTime: this.now.toISOString(),
      cursor: batch.at(-1)?.row.serverSeq ?? since,
      hasMore: candidates.length > batch.length,
      changes,
    };
  }

  /**
   * Zmiana wiersza po stronie serwera — tak, jak robi to panel administracyjny:
   * nowy `updated_at` z zegara serwera i kolejny numer sekwencji.
   */
  editExercise(id: string, values: Partial<SyncedExercise>): void {
    const row = this.exercises.get(id);
    if (!row) throw new Error(`Fake server has no exercise ${id}`);
    this.exercises.set(id, {
      ...row,
      ...values,
      updatedAt: this.now.toISOString(),
      deviceId: null,
      serverSeq: this.next(),
    });
  }

  /** Wgląd w stan serwera — do sprawdzania, co faktycznie dojechało. */
  storedSets(): SyncedWorkoutSet[] {
    return [...this.sets.values()].map(strip);
  }

  storedExercises(): SyncedExercise[] {
    return [...this.exercises.values()].map(strip);
  }

  storedCycles(): SyncedCycle[] {
    return [...this.cycles.values()].map(strip);
  }

  storedTags(): SyncedTag[] {
    return [...this.tags.values()].map(strip);
  }
}

function revisionOf(
  row: { createdAt: string; updatedAt: string; deletedAt: string | null },
  deviceId: string,
): SyncRevision {
  return { ...row, deviceId };
}

function existing(row: Row | undefined): SyncRevision | null {
  if (row === undefined) return null;
  const { createdAt, updatedAt, deletedAt, deviceId } = row;
  return { createdAt, updatedAt, deletedAt, deviceId };
}

/** Serwer nie odsyła `device_id` — jest jego wewnętrzną sprawą przy remisach. */
function strip<T>(row: Stored<T>): T {
  const { deviceId: _deviceId, ...rest } = row;
  return rest as T;
}
