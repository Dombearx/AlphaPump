/**
 * Reguły tagów.
 *
 * Każda reguła tutaj ma **dwa** wejścia: REST (`/tags`, `/exercises`) i paczkę
 * `POST /sync/push`. Reguła zapisana tylko przy jednym z nich nie jest regułą,
 * tylko zachowaniem jednego endpointu — a push jest wtedy tylnym wejściem, przez
 * które nie obowiązuje. Dlatego mieszkają w warstwie osobnej od obu: predykat
 * i zdanie do pokazania człowiekowi są tu jedne, a każde wejście samo decyduje,
 * czy zamienia je w `409`, czy w odrzucenie wiersza w odpowiedzi pushu.
 *
 * ## „Tagu, na którym coś wisi, nie można usunąć"
 *
 * Liczą się dwie rzeczy. Po pierwsze ćwiczenia **żywe**: ćwiczenie z tombstonem
 * jest dla użytkownika nieistniejące, więc nie ma czego trzymać przy życiu jego
 * tagom. Po drugie cele cykli — cel tagowy zlicza serie po tagu głównym
 * ćwiczenia, więc tag zdjęty pod nim zamienia cel w pozycję, która nigdy nic nie
 * naliczy, i to bez żadnego komunikatu.
 *
 * Właściwą operacją dla tagu, który jest pomyłką, jest **scalenie**
 * (`POST /admin/library/tags/:id/merge`): ćwiczenia i cele przechodzą na tag
 * docelowy, a dopiero pusty źródłowy znika.
 */

import { assignTagColors, type SyncRejection } from '@alphapump/core';
import { and, asc, eq, inArray, isNull, ne } from 'drizzle-orm';
import type { Database } from '../db.js';
import { cycleGoals, cycles, exerciseTags, exercises, tags } from '../schema.js';
import { stampWrite } from '../sync-columns.js';

/** Czy jakiekolwiek nieusunięte ćwiczenie używa tagu — jako główny albo dodatkowy. */
export async function isTagOnExercise(db: Database, tagId: string): Promise<boolean> {
  const [usedAsPrimary] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.primaryTagId, tagId), isNull(exercises.deletedAt)))
    .limit(1);
  if (usedAsPrimary) return true;

  const [usedAsAdditional] = await db
    .select({ exerciseId: exerciseTags.exerciseId })
    .from(exerciseTags)
    .innerJoin(
      exercises,
      and(eq(exercises.id, exerciseTags.exerciseId), isNull(exercises.deletedAt)),
    )
    .where(eq(exerciseTags.tagId, tagId))
    .limit(1);

  return Boolean(usedAsAdditional);
}

/** Czy jakikolwiek żywy cykl ma cel wskazujący na ten tag. */
export async function isTagOnGoal(db: Database, tagId: string): Promise<boolean> {
  const [goal] = await db
    .select({ id: cycleGoals.id })
    .from(cycleGoals)
    .innerJoin(cycles, and(eq(cycles.id, cycleGoals.cycleId), isNull(cycles.deletedAt)))
    .where(eq(cycleGoals.tagId, tagId))
    .limit(1);

  return Boolean(goal);
}

export async function isTagInUse(db: Database, tagId: string): Promise<boolean> {
  return (await isTagOnExercise(db, tagId)) || (await isTagOnGoal(db, tagId));
}

/** Kod wspólny dla obu wejść — jedna reguła, jeden kod, jedno zdanie. */
export const TAG_IN_USE: SyncRejection = 'tag_in_use';

/**
 * Kody, którymi obie drogi zapisu tłumaczą odmowę.
 *
 * Kody, nie zdania — zdanie stoi raz, w `describeRejection` w rdzeniu.
 * `slugTaken` i `missing` niosą jeszcze `detail`: nazwę tagu i listę
 * identyfikatorów, czyli tę część komunikatu, której w kodzie zapisać się nie da.
 */
export const TAG_RULES = {
  adminOnly: 'admin_only',
  slugTaken: 'slug_taken',
  idNotFromName: 'id_not_from_name',
  missing: 'missing_tags',
} as const satisfies Record<string, SyncRejection>;

/**
 * Tag o tym samym slugu, ale innym identyfikatorze — albo `null`.
 *
 * Tag jest bytem globalnym i jego id wynika ze sluga nazwy, więc taki wiersz
 * oznacza klienta, który zbudował identyfikator inaczej. Przyjęcie go rozbiłoby
 * globalną deduplikację, dlatego obie drogi zapisu pytają o to samo.
 */
export async function findTagBySlug(
  db: Database,
  slug: string,
  exceptId: string,
): Promise<typeof tags.$inferSelect | null> {
  const [collision] = await db
    .select()
    .from(tags)
    .where(and(eq(tags.slug, slug), ne(tags.id, exceptId)))
    .limit(1);

  return collision ?? null;
}

/* --------------------------------------------------------------------- kolory */

/**
 * Kolory zajęte przez żywe tagi — wejście dla przydziału koloru nowemu tagowi.
 *
 * Żywe, bo tag z tombstonem jest dla użytkownika nieistniejący i blokowanie
 * przez niego slotu w dwudziestoelementowej palecie byłoby marnotrawstwem.
 * `exceptId` pomija tag, dla którego akurat liczymy kolor — inaczej wskrzeszenie
 * albo ponowny zapis tego samego wiersza zderzałby się sam ze sobą.
 */
export async function takenTagColors(db: Database, exceptId?: string): Promise<string[]> {
  const rows = await db
    .select({ id: tags.id, color: tags.color })
    .from(tags)
    .where(isNull(tags.deletedAt));

  return rows.filter((row) => row.id !== exceptId).map((row) => row.color);
}

/**
 * Sprowadza kolory żywych tagów do palety — raz, przy starcie serwera.
 *
 * Bez tego kroku zmiana formuły koloru dotyczyłaby wyłącznie tagów tworzonych
 * od tej chwili, a użytkownik dalej patrzyłby na bibliotekę, w której dwa tagi
 * mają ten sam kolor: kolor jest **zapisany** w wierszu, więc stare tagi noszą
 * to, co policzyła stara formuła.
 *
 * Przydział jest zachowawczy i idempotentny (patrz `assignTagColors`), więc
 * drugi start nie rusza już niczego. Zapis idzie przez `stampWrite`, bo inaczej
 * nowy kolor nie dojechałby do telefonów: pull chodzi po `server_seq`, a decyzję
 * o nadpisaniu lokalnego wiersza podejmuje LWW po `updated_at`.
 */
export async function normalizeTagColors(db: Database): Promise<number> {
  const rows = await db
    .select({ id: tags.id, slug: tags.slug, color: tags.color })
    .from(tags)
    .where(isNull(tags.deletedAt))
    // Kolejność musi być stabilna, inaczej ten sam zbiór tagów dostawałby przy
    // każdym starcie inny przydział.
    .orderBy(asc(tags.createdAt), asc(tags.id));

  const colors = assignTagColors(rows);
  let recolored = 0;

  for (const [index, row] of rows.entries()) {
    const color = colors[index]!;
    if (color === row.color) continue;

    await db
      .update(tags)
      .set({ color, ...stampWrite() })
      .where(eq(tags.id, row.id));
    recolored += 1;
  }

  return recolored;
}

/**
 * Identyfikatory tagów, których w bazie nie ma. Pusta lista nie pyta bazy.
 *
 * `aliveOnly` rozdziela dwa wejścia i robi to świadomie. REST wymaga tagu
 * żywego: użytkownik wybiera go z listy, na której tombstone'ów nie widać.
 * Push nie może być tak surowy, bo tag i ćwiczenie jadą w jednej paczce, a tag
 * mógł właśnie przegrać LWW z tombstonem serwera — odrzucenie ćwiczenia
 * zablokowałoby wtedy kolejkę wysyłki telefonu na wiersz, którego użytkownik
 * nawet nie widzi.
 */
export async function missingTagIds(
  db: Database,
  ids: readonly string[],
  { aliveOnly }: { aliveOnly: boolean },
): Promise<string[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];

  const rows = await db
    .select({ id: tags.id })
    .from(tags)
    .where(
      aliveOnly ? and(isNull(tags.deletedAt), inArray(tags.id, unique)) : inArray(tags.id, unique),
    );

  const known = new Set(rows.map((row) => row.id));
  return unique.filter((id) => !known.has(id));
}
