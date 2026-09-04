/**
 * Kontekst, który dostaje model: czym ten człowiek ćwiczy i co ostatnio zapisał.
 *
 * ## Dlaczego lista powstaje na serwerze, a nie jedzie z telefonu
 *
 * Bo telefon i tak musi mieć łączność, żeby cokolwiek podyktować — a serwer ma
 * te dane u siebie po synchronizacji, która chodzi w tle i domyka się w sekundy
 * po zapisie serii. Wysyłanie całej biblioteki przy każdym nagraniu byłoby
 * kilkudziesięcioma kilobajtami na jedno zdanie, i to w tym momencie,
 * w którym użytkownik czeka z telefonem przy ustach.
 *
 * Kosztem jest jedno okno: ćwiczenie utworzone offline i jeszcze niewypchnięte
 * nie zna go serwer, więc nie da się na nie podyktować serii. Wynik jest wtedy
 * ten sam co przy niezrozumianym nagraniu — „nie wiem, o które chodzi" i zwykły
 * wybór z listy — czyli sytuacja bez straty względem stanu sprzed tej funkcji.
 *
 * ## Co jest „listą ćwiczeń użytkownika"
 *
 * Biblioteka jest wspólna: każdy widzi wszystkie ćwiczenia i może zapisać serię
 * na dowolne. Listą jest więc **cała żywa biblioteka**, a nie sama jej część
 * należąca do dyktującego.
 *
 * Wcześniej było odwrotnie: brały się z niej wyłącznie ćwiczenia, na które
 * użytkownik ma zapisane serie, i te, które sam założył. Kosztowało to zgłoszenie
 * „nie znalazłem ćwiczenia Push up na twojej liście, dyktując »Push up twenty
 * four reps«" — ćwiczenie stało w bibliotece i telefon je pokazywał, ale model
 * go nie dostawał, bo zgłaszający nie miał na nie jeszcze ani jednej serii.
 * Ćwiczenie widoczne w aplikacji i niewidoczne dla dyktowania jest dla
 * użytkownika po prostu zepsute, a „zapisz je raz ręcznie, wtedy zacznie
 * działać" nie jest regułą, którą da się komukolwiek powiedzieć.
 *
 * Kontekst jednego wywołania ma jednak limit (`VOICE_EXERCISE_LIMIT`), więc
 * o tym, co wypadnie przy obcięciu, rozstrzyga kolejność — a ta jest trzema
 * kubełkami:
 *
 * 1. **jego ćwiczenia** — te, na które ma zapisane serie, i te, które sam
 *    założył; wewnątrz kubełka od najczęściej wykonywanego,
 * 2. **ćwiczenia, których nazwa pada w tym, co powiedział** — czyli dokładnie
 *    te, o które w tym jednym nagraniu może chodzić,
 * 3. reszta biblioteki, alfabetycznie.
 *
 * Kubełek drugi jest po to, żeby limit nie przywrócił tego samego błędu przy
 * większej bibliotece: „push up twenty four reps" wciąga „Push up" na listę
 * niezależnie od tego, ile pozycji stoi przed nim alfabetycznie.
 */

import {
  VOICE_EXERCISE_LIMIT,
  VOICE_RECENT_SET_LIMIT,
  gramsToKilograms,
  type VoiceExercise,
  type VoiceRecentSet,
} from '@alphapump/core';
import { and, asc, count, desc, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exercises, workoutSets } from '../schema.js';

/**
 * Czy nazwa ćwiczenia — kanoniczna albo któraś z nazw w pozostałych językach —
 * pada w zdaniu, które użytkownik podyktował.
 *
 * Kierunek jest odwrotny niż w wyszukiwarce biblioteki: **nazwa jest
 * zapytaniem, a transkrypcja dokumentem**. Nazwa jest krótka i ma się w całości
 * znaleźć w zdaniu („push up" w „push up twenty four reps"); szukanie nazwy
 * zawierającej całe zdanie nie trafiłoby nigdy w nic.
 *
 * Porównanie idzie po surowym tekście, a nie po slugu, mimo że slug jest
 * w bibliotece znormalizowany. Slug zdejmuje ogonki, transkrypcja ich nie
 * zdejmuje — a normalizacja tylko jednej strony rozjeżdża dokładnie te nazwy,
 * dla których w ogóle powstała („leżąc" kontra „lezac").
 */
function spokenIn(transcript: string): SQL<boolean> {
  const spoken = sql`to_tsvector('simple', ${transcript})`;

  return sql<boolean>`(
    ${spoken} @@ plainto_tsquery('simple', ${exercises.name})
    or exists (
      select 1
      from jsonb_each_text(coalesce(${exercises.translations}, '{}'::jsonb)) as alias(lang, name)
      where ${spoken} @@ plainto_tsquery('simple', alias.name)
    )
  )`;
}

/**
 * Ćwiczenia do wyboru dla modelu — jego własne przodem, reszta biblioteki za
 * nimi (patrz nagłówek modułu).
 *
 * `count` po złączeniu z seriami użytkownika odpowiada tu na dwa pytania naraz:
 * „czy to ćwiczenie jest jego" (liczba większa od zera) i „jak często je robi"
 * (sama liczba, do kolejności wewnątrz pierwszego kubełka).
 */
export async function voiceExercises(
  db: Database,
  userId: string,
  transcript: string,
  limit: number = VOICE_EXERCISE_LIMIT,
): Promise<VoiceExercise[]> {
  const setCount = count(workoutSets.id);

  const bucket = sql`case
    when ${eq(exercises.authorId, userId)} or ${setCount} > 0 then 0
    when ${spokenIn(transcript)} then 1
    else 2
  end`;

  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      loggingType: exercises.loggingType,
      translations: exercises.translations,
      setCount,
    })
    .from(exercises)
    .leftJoin(
      workoutSets,
      and(
        eq(workoutSets.exerciseId, exercises.id),
        eq(workoutSets.userId, userId),
        isNull(workoutSets.deletedAt),
      ),
    )
    .where(isNull(exercises.deletedAt))
    .groupBy(exercises.id)
    .orderBy(asc(bucket), desc(setCount), asc(exercises.name))
    .limit(limit);

  return rows.map((row) => ({
    exerciseId: row.id,
    name: row.name,
    loggingType: row.loggingType,
    // Nazwy w pozostałych językach jadą jako aliasy: dyktuje się w języku,
    // w którym się myśli, a nazwa kanoniczna bywa w innym.
    aliases: Object.values(row.translations ?? {}).filter((alias) => alias !== row.name),
  }));
}

/** Ostatnio zapisane serie użytkownika, od najnowszej. */
export async function voiceRecentSets(
  db: Database,
  userId: string,
  limit: number = VOICE_RECENT_SET_LIMIT,
): Promise<VoiceRecentSet[]> {
  const rows = await db
    .select({
      exerciseId: exercises.id,
      name: exercises.name,
      performedOn: workoutSets.performedOn,
      weightG: workoutSets.weightG,
      reps: workoutSets.reps,
      durationS: workoutSets.durationS,
      distanceM: workoutSets.distanceM,
    })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(and(eq(workoutSets.userId, userId), isNull(workoutSets.deletedAt)))
    // Data, a nie `createdAt`: seria dopisana dziś do zeszłego tygodnia jest
    // kontekstem gorszym niż ta, którą zapisano przed chwilą na dzisiaj.
    .orderBy(desc(workoutSets.performedOn), desc(workoutSets.position))
    .limit(limit);

  return rows.map((row) => ({
    exerciseId: row.exerciseId,
    exerciseName: row.name,
    performedOn: row.performedOn,
    measurements: {
      weightG: row.weightG,
      reps: row.reps,
      durationS: row.durationS,
      distanceM: row.distanceM,
    },
  }));
}

/**
 * Jedna seria w postaci, w jakiej wchodzi do promptu.
 *
 * Jednostki są wypisane wprost i po ludzku — kilogramy, a nie gramy. Model ma
 * odpowiadać kilogramami, więc historia podana w gramach kazałaby mu przeliczać
 * w obie strony bez powodu, a każde takie przeliczenie jest okazją do pomyłki
 * o trzy rzędy wielkości.
 */
export function formatRecentSet(set: VoiceRecentSet): string {
  const { weightG, reps, durationS, distanceM } = set.measurements;

  const parts = [
    weightG === null ? null : `${String(gramsToKilograms(weightG))} kg`,
    reps === null ? null : `${String(reps)} powt.`,
    durationS === null ? null : `${String(durationS)} s`,
    distanceM === null ? null : `${String(distanceM)} m`,
  ].filter((part) => part !== null);

  return `${set.performedOn} · ${set.exerciseName}: ${parts.join(', ')}`;
}
