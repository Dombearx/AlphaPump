/**
 * Powody, dla których serwer nie przyjął wiersza z paczki pushu.
 *
 * Do tej pory `SyncResult.reason` był zdaniem — po polsku, zbudowanym w tym
 * miejscu kodu serwera, w którym reguła odmówiła. Miało to dwie wady i obie
 * widać było na ekranie: aplikacja jest po angielsku, więc w odznace
 * synchronizacji pojawiał się nagle polski komunikat; a że był zdaniem,
 * telefon nie mógł na nim niczego oprzeć poza wyświetleniem. Rozróżnienie
 * „spróbuj jeszcze raz" od „ten wiersz już nigdy nie wejdzie" wymagałoby
 * dopasowywania napisów.
 *
 * Teraz jedzie **kod**, a zdanie powstaje po stronie, która je pokazuje.
 * `detail` niesie tę część, której nie da się zapisać w kodzie — listę
 * identyfikatorów, nazwę, typ logowania — i jest jedynym miejscem, w którym
 * do komunikatu trafia cokolwiek zmiennego.
 *
 * Zdania mieszkają tutaj, a nie w aplikacji, bo ta sama reguła ma dwa wyjścia:
 * odrzucenie w pushu i błąd `409`/`403` w REST. Jedna reguła, jeden kod, jedno
 * zdanie — niezależnie od tego, którym wejściem ktoś w nią trafił.
 */

import { z } from 'zod';

export const SYNC_REJECTIONS = [
  /** Wiersz należy do innego konta — dotyczy serii i cykli. */
  'not_owner',
  /** Ćwiczenie może zmieniać wyłącznie autor albo administrator. */
  'not_author',
  /** Tagi zmienia wyłącznie administrator. */
  'admin_only',
  /** Ćwiczenie ma zapisane serie albo cele cyklu. */
  'exercise_in_use',
  /** Tag jest przypięty do ćwiczeń albo do celów cyklu. */
  'tag_in_use',
  /** Typ logowania ustala się raz, przy tworzeniu ćwiczenia. */
  'logging_type_frozen',
  /** Tag główny powtarza się wśród dodatkowych. */
  'duplicate_tag',
  /** `detail`: identyfikatory tagów, których serwer nie zna. */
  'missing_tags',
  /** `detail`: identyfikatory bytów, na które wskazują cele cyklu. */
  'missing_goal_targets',
  /** Seria wskazuje na ćwiczenie, którego serwer nie ma. */
  'missing_exercise',
  /** `detail`: typ logowania, do którego pomiary nie pasują. */
  'measurements_mismatch',
  /** Identyfikator nie wynika z nazwy — klient wyliczył go inaczej. */
  'id_not_from_name',
  /** Ten autor ma już ćwiczenie o tej nazwie. */
  'name_taken',
  /** `detail`: nazwa tagu, który istnieje pod innym identyfikatorem. */
  'slug_taken',
  /** Wiersz zniknął między odczytem a zapisem — jedyny powód wart ponowienia. */
  'vanished',
] as const;

export const syncRejectionSchema = z.enum(SYNC_REJECTIONS);

export type SyncRejection = (typeof SYNC_REJECTIONS)[number];

/**
 * Kody, po których ponowienie ma sens.
 *
 * Wszystkie pozostałe są rozstrzygnięciem reguły: ten sam wiersz wysłany
 * ponownie odbije się tak samo, więc kolejka wysyłki nie ma czego czekać.
 */
const RETRYABLE = new Set<SyncRejection>(['vanished']);

export function isRetryableRejection(code: SyncRejection): boolean {
  return RETRYABLE.has(code);
}

const MESSAGES: Record<SyncRejection, (detail: string | null) => string> = {
  not_owner: () => 'This row belongs to a different account',
  not_author: () => 'Only the author or an administrator can change this exercise',
  admin_only: () => 'Only an administrator can change tags',
  exercise_in_use: () =>
    'This exercise has logged sets or cycle goals and cannot be deleted. Merge it into ' +
    'another exercise (admin panel) or first remove what points at it',
  tag_in_use: () =>
    'This tag is used by exercises or cycle goals and cannot be deleted. Merge it into ' +
    'another tag (admin panel) or remove it where it is used',
  logging_type_frozen: () => 'The logging type of an exercise cannot be changed',
  duplicate_tag: () => 'The primary tag cannot repeat among the additional tags',
  missing_tags: (detail) => `No such tags: ${detail ?? '?'}`,
  missing_goal_targets: (detail) => `Cycle goals point at unknown rows: ${detail ?? '?'}`,
  missing_exercise: () => 'The exercise this set points at does not exist',
  measurements_mismatch: (detail) => `Measurements do not match the ${detail ?? '?'} logging type`,
  id_not_from_name: () => 'The identifier does not follow from the name',
  name_taken: () => 'This author already has an exercise with that name',
  slug_taken: (detail) => `Tag „${detail ?? '?'}" already exists under a different identifier`,
  vanished: () => 'The row disappeared mid-write — try again',
};

/** Zdanie dla człowieka. Jedyne miejsce, w którym kod zamienia się w tekst. */
export function describeRejection(code: SyncRejection, detail: string | null = null): string {
  return MESSAGES[code](detail);
}
