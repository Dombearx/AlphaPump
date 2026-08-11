/**
 * Wybór ćwiczenia do zapisania serii.
 *
 * Ekran jest pomiędzy dniem a formularzem, więc każdy jego dodatkowy element to
 * dodatkowy krok w najczęstszej czynności w aplikacji. Dlatego jest tu wyłącznie
 * szukajka i lista, a wybór ćwiczenia **podmienia** ten ekran w stosie: cofnięcie
 * z formularza wraca do dnia, a nie do listy, z której przed chwilą się wyszło.
 *
 * Kolejność listy jest po liczbie własnych serii malejąco — ćwiczenia, które
 * użytkownik faktycznie wykonuje, są u góry bez żadnego ustawiania.
 *
 * Filtrowanie idzie po slugu, tym samym, który wylicza identyfikator ćwiczenia.
 * Dzięki temu „lawka" znajduje „Ławkę", a użytkownik nie musi trafiać w ogonki.
 */

import type { IsoDate } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import { exerciseLibrary, type LibraryRow } from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import { filterExercises } from '../exercise-search';
import { EmptyState, Field, Loading, Row, TagDot } from '../ui/primitives';

export function PickExerciseScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const [query, setQuery] = useState('');

  const library = useLiveQuery(exerciseLibrary(db, session?.user.id ?? ''));

  const matches = useMemo(() => filterExercises(library.data ?? [], query), [library.data, query]);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Wybierz ćwiczenie' }} />

      <View className="p-4">
        <Field
          label="Szukaj"
          value={query}
          onChangeText={setQuery}
          placeholder="nazwa ćwiczenia albo tag"
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus
        />
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8">
        {matches.length === 0 ? (
          <EmptyState
            title="Nie ma takiego ćwiczenia"
            hint="Spróbuj krótszej frazy — szukamy po nazwie ćwiczenia i po tagu."
          />
        ) : (
          matches.map((exercise) => (
            <Row key={exercise.id} onPress={() => router.replace(`/day/${day}/log/${exercise.id}`)}>
              <TagDot color={exercise.tagColor} />
              <View className="flex-1">
                <Text className="text-base text-text">{exercise.name}</Text>
                <Text className="text-xs text-muted">{describeUsage(exercise)}</Text>
              </View>
            </Row>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function describeUsage(exercise: LibraryRow): string {
  if (exercise.setCount === 0) return exercise.tagName;
  const last = exercise.lastPerformedOn;
  const when = last === null ? '' : ` · ostatnio ${formatDate(last, currentDay())}`;
  return `${exercise.tagName} · ${String(exercise.setCount)} serii${when}`;
}
