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
 * na dowolne. Jako kontekst dla modelu to za dużo — kilkaset pozycji, z których
 * użytkownik wykonuje kilkanaście. Bierzemy więc te, które **są jego**
 * w praktyce: ćwiczenia, na które ma zapisane serie, oraz te, które sam założył.
 * Kolejność po liczbie własnych serii malejąco, więc obcięcie listy do limitu
 * odcina ćwiczenia, których nie robi.
 */

import {
  VOICE_EXERCISE_LIMIT,
  VOICE_RECENT_SET_LIMIT,
  gramsToKilograms,
  type VoiceExercise,
  type VoiceRecentSet,
} from '@alphapump/core';
import { and, count, desc, eq, exists, isNull, or, sql } from 'drizzle-orm';
import type { Database } from '../db.js';
import { exercises, workoutSets } from '../schema.js';

/**
 * Ćwiczenia użytkownika, od najczęściej wykonywanego.
 *
 * `exists` zamiast złączenia z filtrem: interesuje nas „czy ma na to serie",
 * a nie „ile ich ma w sumie" — a złączenie liczące serie i tak jest niżej,
 * w `ORDER BY`, gdzie odpowiada na inne pytanie.
 */
export async function voiceExercises(
  db: Database,
  userId: string,
  limit: number = VOICE_EXERCISE_LIMIT,
): Promise<VoiceExercise[]> {
  const mine = db
    .select({ one: sql`1` })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.exerciseId, exercises.id),
        eq(workoutSets.userId, userId),
        isNull(workoutSets.deletedAt),
      ),
    );

  const setCount = count(workoutSets.id);

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
    .where(and(isNull(exercises.deletedAt), or(eq(exercises.authorId, userId), exists(mine))))
    .groupBy(exercises.id)
    .orderBy(desc(setCount), exercises.name)
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
