/**
 * Widok dnia bieżącego — docelowo najważniejszy ekran produktu.
 *
 * W etapie 5 jest szkieletem: pokazuje, że baza lokalna żyje i że zapis do niej
 * przerysowuje ekran sam. Logowanie serii, wybór ćwiczenia i podpowiadanie
 * wartości wchodzą w etapie 6 — ten plik jest miejscem, w które wejdą.
 *
 * Wszystkie liczby na ekranie pochodzą z `useLiveQuery`, czyli **wprost z bazy
 * lokalnej**. Nie ma tu żadnej warstwy zarządzania stanem serwerowym i nie ma
 * cache'a do unieważniania: zapis idzie do SQLite, a każdy ekran czytający te
 * dane odświeża się sam.
 */

import { toIsoDate } from '@alphapump/core';
import { exercises, users, workoutSets } from '@alphapump/db/sqlite';
import { and, count, eq, isNull } from 'drizzle-orm';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect } from 'expo-router';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut, useSession } from '../src/auth/client';
import { db } from '../src/db/client';

export default function TodayScreen() {
  const { data: session, isPending } = useSession();
  const today = toIsoDate(new Date());

  const account = useLiveQuery(
    db
      .select({ nickname: users.nickname, role: users.role })
      .from(users)
      .where(eq(users.id, session?.user.id ?? '')),
  );

  const todaysSets = useLiveQuery(
    db
      .select({ total: count() })
      .from(workoutSets)
      .where(
        and(
          eq(workoutSets.userId, session?.user.id ?? ''),
          eq(workoutSets.performedOn, today),
          isNull(workoutSets.deletedAt),
        ),
      ),
  );

  const library = useLiveQuery(
    db.select({ total: count() }).from(exercises).where(isNull(exercises.deletedAt)),
  );

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-base">
        <ActivityIndicator size="large" color="#f97316" />
      </View>
    );
  }

  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <ScrollView contentContainerClassName="gap-4 p-4">
        <View className="rounded-2xl border border-border bg-surface p-4">
          <Text className="text-sm uppercase tracking-wide text-muted">Zalogowano jako</Text>
          {/* Nick czytany z bazy lokalnej, a nie z sesji — to on dowodzi, że zapis
              wykonany przy logowaniu przerysował ekran bez odświeżania. */}
          <Text className="mt-1 text-2xl font-semibold text-text">
            {account.data[0]?.nickname ?? '—'}
          </Text>
          <Text className="mt-1 text-muted">{session.user.email}</Text>
        </View>

        <View className="flex-row gap-4">
          <Tile label="Serie dziś" value={todaysSets.data[0]?.total ?? 0} />
          <Tile label="Ćwiczenia w bibliotece" value={library.data[0]?.total ?? 0} />
        </View>

        <View className="rounded-2xl border border-border bg-surface p-4">
          <Text className="text-lg font-semibold text-text">{today}</Text>
          <Text className="mt-2 text-muted">
            Zapisywanie serii wchodzi w etapie 6. Baza lokalna jest gotowa: dane czytane są
            wyłącznie z niej, a każdy zapis przerysowuje ten ekran sam.
          </Text>
        </View>

        <Pressable
          className="rounded-2xl border border-border bg-surface p-4 active:opacity-70"
          onPress={() => void signOut()}
        >
          <Text className="text-center font-semibold text-danger">Wyloguj</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Tile({ label, value }: { label: string; value: number }) {
  return (
    <View className="flex-1 rounded-2xl border border-border bg-surface p-4">
      <Text className="text-3xl font-semibold text-accent">{value}</Text>
      <Text className="mt-1 text-muted">{label}</Text>
    </View>
  );
}
