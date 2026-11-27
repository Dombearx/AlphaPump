/**
 * Biblioteka ćwiczeń.
 *
 * Ekran realizuje przepływ ze specyfikacji wprost: „wybierz tag »biceps«,
 * zobacz ćwiczenia na biceps, wybierz istniejące albo dodaj nowe". Filtr jest
 * oparty **na tagach** i na pochodzeniu ćwiczenia — nic poza tym, bo dodatkowe
 * kryteria (sprzęt, poziom) nie są potrzebne, a każdy filtr to kolejny element
 * między użytkownikiem a listą.
 *
 * Rząd tagów pokazuje domyślnie te, z których użytkownik ma **własne** serie,
 * od tych z największą ich liczbą; tagi bez ani jednej serii schodzą pod chips
 * „+N more" (patrz `tag-usage.ts`). Słownik tagów jest wspólny dla wszystkich,
 * więc rośnie niezależnie od tego, co kto robi, a filtr ma być skrótem do
 * ćwiczeń, które użytkownika dotyczą — nie spisem całego słownika.
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
import type { Translatable } from '@alphapump/core';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import {
  allAdditionalTags,
  exerciseLibrary,
  groupAdditionalTags,
  tagLibrary,
  tagSetCounts,
  type LibraryRow,
  type LibrarySource,
  type TagLibraryRow,
} from '../db/queries';
import { filterExercises } from '../exercise-search';
import { useLocalizedName } from '../language/provider';
import { splitTagsByUsage, tagSetCountMap } from '../tag-usage';
import { Button, Chip, ChipRow, EmptyState, Field, Loading, Row, TagDot } from '../ui/primitives';

const SOURCES: { value: LibrarySource; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'built-in', label: 'Built-in' },
  { value: 'community', label: 'Added' },
];

export function LibraryScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  // Nazwa do pokazania powstaje tutaj, a nie w zapytaniu: zależy od wyboru
  // języka, a `useLiveQuery` subskrybuje tabele, nie ustawienia.
  const named = useLocalizedName();

  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);
  const [source, setSource] = useState<LibrarySource>('all');
  /** Czy rząd tagów pokazuje też te, z których nie ma ani jednej serii. */
  const [allTags, setAllTags] = useState(false);

  const userId = session?.user.id ?? '';

  const tags = useLiveQuery(tagLibrary(db));
  const tagUsage = useLiveQuery(tagSetCounts(db, userId), [userId]);
  const library = useLiveQuery(exerciseLibrary(db, userId, { tagId, source }), [
    userId,
    tagId,
    source,
  ]);
  const extraTags = useLiveQuery(allAdditionalTags(db));

  const matches = useMemo(() => filterExercises(library.data ?? [], query), [library.data, query]);
  const extraTagsByExercise = useMemo(
    () => groupAdditionalTags(extraTags.data ?? []),
    [extraTags.data],
  );

  // Rząd tagów układa się po liczbie własnych serii, a tagi bez ani jednej
  // schodzą pod „+N more" — patrz `tag-usage.ts`. Wybrany tag zostaje na
  // wierzchu, bo filtr bez widocznego chipsa byłby filtrem, którego nie da się
  // zdjąć.
  const tagCounts = useMemo(() => tagSetCountMap(tagUsage.data ?? []), [tagUsage.data]);
  const tagRow = useMemo(
    () =>
      splitTagsByUsage(tags.data ?? [], tagCounts, tagId === null ? undefined : new Set([tagId])),
    [tags.data, tagCounts, tagId],
  );

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const tagChip = (tag: TagLibraryRow) => (
    <Chip
      key={tag.id}
      label={`${named(tag)} · ${String(tag.exerciseCount)}`}
      color={tag.color}
      selected={tagId === tag.id}
      onPress={() => setTagId(tagId === tag.id ? null : tag.id)}
    />
  );

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
          {tagRow.shown.map(tagChip)}
          {/* Przełącznik stoi **za** używanymi tagami, a nie na końcu rzędu:
              inaczej skakałby o całą rozwiniętą resztę przy każdym naciśnięciu. */}
          {tagRow.hidden.length > 0 && (
            <Chip
              label={allTags ? 'Fewer tags' : `+${String(tagRow.hidden.length)} more`}
              selected={allTags}
              onPress={() => setAllTags(!allTags)}
            />
          )}
          {allTags && tagRow.hidden.map(tagChip)}
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
                  <Text className="text-base text-text">{named(exercise)}</Text>
                  <Text className="text-xs text-muted">{describe(exercise, named)}</Text>
                  {/* Tag główny liczy się do cykli, dodatkowe są tylko etykietą —
                      bez tej linii dopasowanie po tagu dodatkowym (np. „Triceps"
                      dla dipów, których głównym tagiem jest „Chest") było
                      niewytłumaczalne: wiersz pokazywał wyłącznie „Chest". */}
                  {extra.length > 0 && (
                    <Text className="text-xs text-muted">
                      Also: {extra.map((tag) => named(tag)).join(', ')}
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

function describe(exercise: LibraryRow, named: (entity: Translatable) => string): string {
  const gym = exercise.gym === null ? '' : ` · ${exercise.gym}`;
  // Tag główny w wybranym języku, tak samo jak nazwa ćwiczenia wyżej — wiersz
  // z jedną nazwą po polsku i drugą po angielsku wyglądałby jak błąd danych.
  const tag = named({ name: exercise.tagName, translations: exercise.tagTranslations });
  if (exercise.setCount === 0) return `${tag}${gym}`;
  const sets = exercise.setCount === 1 ? 'set' : 'sets';
  return `${tag} · ${String(exercise.setCount)} ${sets}${gym}`;
}
