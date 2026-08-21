/**
 * Biblioteka ćwiczeń.
 *
 * Ekran realizuje przepływ ze specyfikacji wprost: „wybierz tag »biceps«,
 * zobacz ćwiczenia na biceps, wybierz istniejące albo dodaj nowe". Filtr jest
 * oparty **na tagach** i na pochodzeniu ćwiczenia — nic poza tym, bo dodatkowe
 * kryteria (sprzęt, poziom) nie są potrzebne, a każdy filtr to kolejny element
 * między użytkownikiem a listą.
 *
 * Wszystko jedzie z bazy lokalnej, więc filtrowanie, szukanie i dodawanie
 * działają bez sieci. Ekran nie ma stanu ładowania poza pierwszym renderem
 * zapytania — nie ma tu na co czekać.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import {
  allAdditionalTags,
  exerciseLibrary,
  groupAdditionalTags,
  tagLibrary,
  type LibraryRow,
  type LibrarySource,
} from '../db/queries';
import { filterExercises } from '../exercise-search';
import { Button, Chip, ChipRow, EmptyState, Field, Loading, Row, TagDot } from '../ui/primitives';

const SOURCES: { value: LibrarySource; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'built-in', label: 'Built-in' },
  { value: 'community', label: 'Added' },
];

export function LibraryScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);
  const [source, setSource] = useState<LibrarySource>('all');

  const tags = useLiveQuery(tagLibrary(db));
  const library = useLiveQuery(exerciseLibrary(db, session?.user.id ?? '', { tagId, source }), [
    tagId,
    source,
  ]);
  const extraTags = useLiveQuery(allAdditionalTags(db));

  const matches = useMemo(() => filterExercises(library.data ?? [], query), [library.data, query]);
  const extraTagsByExercise = useMemo(
    () => groupAdditionalTags(extraTags.data ?? []),
    [extraTags.data],
  );

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Exercises',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              className="px-2 py-1 active:opacity-70"
              onPress={() => router.push('/library/new')}
            >
              <Text className="text-accent">New</Text>
            </Pressable>
          ),
        }}
      />

      <View className="gap-3 p-4 pb-2">
        <Field
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="exercise name or tag"
          autoCapitalize="none"
          autoCorrect={false}
        />

        <ChipRow>
          {SOURCES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={source === option.value}
              onPress={() => setSource(option.value)}
            />
          ))}
        </ChipRow>
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <ChipRow wrap>
          <Chip label="All tags" selected={tagId === null} onPress={() => setTagId(null)} />
          {(tags.data ?? []).map((tag) => (
            <Chip
              key={tag.id}
              label={`${tag.name} · ${String(tag.exerciseCount)}`}
              color={tag.color}
              selected={tagId === tag.id}
              onPress={() => setTagId(tagId === tag.id ? null : tag.id)}
            />
          ))}
        </ChipRow>

        {matches.length === 0 ? (
          <View className="gap-4">
            <EmptyState
              title="Nothing matches"
              hint="Change the filter, or add an exercise for this area — also works offline."
            />
            <Button
              label="Add exercise"
              onPress={() =>
                router.push(tagId === null ? '/library/new' : `/library/new?tagId=${tagId}`)
              }
            />
          </View>
        ) : (
          matches.map((exercise) => {
            const extra = extraTagsByExercise.get(exercise.id) ?? [];
            return (
              <Row key={exercise.id} onPress={() => router.push(`/library/${exercise.id}`)}>
                <TagDot color={exercise.tagColor} />
                <View className="flex-1">
                  <Text className="text-base text-text">{exercise.name}</Text>
                  <Text className="text-xs text-muted">{describe(exercise)}</Text>
                  {/* Tag główny liczy się do cykli, dodatkowe są tylko etykietą —
                      bez tej linii dopasowanie po tagu dodatkowym (np. „Triceps"
                      dla dipów, których głównym tagiem jest „Chest") było
                      niewytłumaczalne: wiersz pokazywał wyłącznie „Chest". */}
                  {extra.length > 0 && (
                    <Text className="text-xs text-muted">
                      Also: {extra.map((tag) => tag.name).join(', ')}
                    </Text>
                  )}
                </View>
              </Row>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function describe(exercise: LibraryRow): string {
  const gym = exercise.gym === null ? '' : ` · ${exercise.gym}`;
  if (exercise.setCount === 0) return `${exercise.tagName}${gym}`;
  const sets = exercise.setCount === 1 ? 'set' : 'sets';
  return `${exercise.tagName} · ${String(exercise.setCount)} ${sets}${gym}`;
}
