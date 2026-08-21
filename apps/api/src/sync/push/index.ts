/**
 * Przyjęcie paczki mutacji z telefonu.
 *
 * ## Dlaczego jeden wiersz nie może wywrócić paczki
 *
 * Outbox na telefonie jest kolejką: dopóki wpis z niej nie zejdzie, nic za nim
 * nie pojedzie. Gdyby jeden odrzucony wiersz kończył całe żądanie błędem, jedna
 * zatruta mutacja zatrzymałaby synchronizację urządzenia **na zawsze**. Dlatego
 * każdy wiersz jest rozstrzygany osobno, a odpowiedź niesie wynik dla każdego
 * z osobna — kolejka rusza dalej, a użytkownik nie ląduje w martwym punkcie.
 *
 * ## Dlaczego mimo to całość jest jedną transakcją
 *
 * „Osobno rozstrzygany" nie znaczy „osobno zapisywany". Odrzucenie jest wynikiem,
 * a nie awarią, i ląduje w odpowiedzi, nie w bazie — więc per-wierszowy zapis nie
 * dawał nic poza stanem częściowym po przerwanym żądaniu. Transakcja domyka też
 * wyścig między odczytem a zapisem, który wcześniej kończył się `undefined` tam,
 * gdzie kod pisał `row!`, czyli 500 na całą paczkę.
 *
 * ## Dlaczego odpowiedź zwraca wiersze
 *
 * Wiersz, który przegrał LWW, nie dostaje nowego `server_seq` — jego numer jest
 * już za kursorem telefonu, więc pull nigdy go nie przywiezie i urządzenie
 * zostałoby ze swoją przegraną wersją na zawsze. Push oddaje więc stan
 * serwerowy dla **każdego** wiersza z paczki, w tym samym kształcie, w jakim
 * robi to pull. Dotyczy to też wierszy przyjętych: serwer przycina znaczniki
 * z przyszłości, więc przyjęty wiersz też potrafi wrócić inny, niż pojechał.
 *
 * ## Kolejność encji
 *
 * Tagi → ćwiczenia → cykle → serie, czyli od bytów niezależnych do zależnych.
 * Dzięki temu jedna paczka może przywieźć nowy tag, nowe ćwiczenie z tym tagiem
 * i serię tego ćwiczenia — a to jest dokładnie scenariusz „wymyśliłem nowe
 * ćwiczenie na siłowni bez zasięgu".
 */

import type {
  SyncChanges,
  SyncDecision,
  SyncEntity,
  SyncPushRequest,
  SyncResult,
} from '@alphapump/core';
import type { Principal } from '../../context.js';
import type { Database } from '../../db.js';
import { emptyScope, type AffectedScope } from '../derived.js';
import { applyCycles } from './cycles.js';
import { applyExercises } from './exercises.js';
import { applySets } from './sets.js';
import { applyTags } from './tags.js';
import type { PushContext, Tx } from './shared.js';

export interface PushOutcome {
  /**
   * Najwyższy `server_seq` nadany w tej paczce; `0`, gdy nic nie weszło.
   * Nie jest kursorem pullu — patrz `syncPushResponseSchema` w rdzeniu.
   */
  cursor: number;
  results: SyncResult[];
  changes: SyncChanges;
  /** Ćwiczenia dotknięte zapisem serii — wejście do przeliczeń pochodnych. */
  scope: AffectedScope;
}

export async function applyPush(
  db: Database,
  principal: Principal,
  request: SyncPushRequest,
  now: Date,
): Promise<PushOutcome> {
  const results: SyncResult[] = [];
  const changes: SyncChanges = { users: [], tags: [], exercises: [], cycles: [], sets: [] };
  const scope = emptyScope();
  let cursor = 0;

  await db.transaction(async (transaction) => {
    const context: PushContext = {
      tx: transaction as Tx,
      principal,
      deviceId: request.deviceId,
      now,
      isAdmin: principal.role === 'admin',
      results,
      changes,
      scope,
      advance(serverSeq) {
        if (serverSeq > cursor) cursor = serverSeq;
      },
      record(entity: SyncEntity, id: string, decision: SyncDecision, reason?: string) {
        results.push({ entity, id, decision, reason: reason ?? null });
      },
    };

    await applyTags(context, request.tags);
    await applyExercises(context, request.exercises);
    await applyCycles(context, request.cycles);
    await applySets(context, request.sets);
  });

  return { cursor, results, changes, scope };
}
