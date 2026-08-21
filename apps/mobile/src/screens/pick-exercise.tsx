/**
 * Wybór ćwiczenia do zapisania serii.
 *
 * Ekran jest pomiędzy dniem a formularzem, więc każdy jego dodatkowy element to
 * dodatkowy krok w najczęstszej czynności w aplikacji. Dlatego jest tu wyłącznie
 * szukajka, filtr tagów i lista, a wybór ćwiczenia **podmienia** ten ekran
 * w stosie: cofnięcie z formularza wraca do dnia, a nie do listy, z której przed
 * chwilą się wyszło.
 *
 * Kolejność listy jest po liczbie własnych serii malejąco — ćwiczenia, które
 * użytkownik faktycznie wykonuje, są u góry bez żadnego ustawiania.
 *
 * Filtrowanie idzie po slugu, tym samym, który wylicza identyfikator ćwiczenia.
 * Dzięki temu „lawka" znajduje „Ławkę", a użytkownik nie musi trafiać w ogonki.
 *
 * ## Skrót z cyklu
 *
 * Na górze stoją pozycje pozostałe do wykonania w aktywnych cyklach. To jest
 * **wyłącznie skrót do wskazania ćwiczenia albo obszaru**, a nie ręczne
 * przypisanie serii do cyklu — przypisania nie ma w ogóle, bo każda zapisana
 * seria zalicza się sama do wszystkich pasujących cykli. Pozycja wskazująca
 * ćwiczenie prowadzi wprost do formularza; pozycja tagowa zawęża listę poniżej,
 * bo „12 serii na biceps" nie mówi, którym ćwiczeniem je zrobić.
 */

import type { IsoDate } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import {
  cycleSummaries,
  earliestRelevantDay,
  remainingTargets,
  withGoals,
  type RemainingTarget,
} from '../cycle-progress';
import { db } from '../db/client';
import {
  allAdditionalTags,
  cycleGoalList,
  cycleList,
  exerciseLibrary,
  groupAdditionalTags,
  setsForCycles,
  tagLibrary,
  type LibraryRow,
} from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import { filterExercises } from '../exercise-search';
import { formatMetric, GOAL_METRIC_LABELS } from '../measurements';
import {
  Button,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  Loading,
  Row,
  SectionTitle,
  TagDot,
} from '../ui/primitives';

export function PickExerciseScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const userId = session?.user.id ?? '';

  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);

  const tags = useLiveQuery(tagLibrary(db), []);
  const library = useLiveQuery(exerciseLibrary(db, userId, { tagId }), [userId, tagId]);
  const extraTags = useLiveQuery(allAdditionalTags(db), []);
  const extraTagsByExercise = useMemo(
    () => groupAdditionalTags(extraTags.data ?? []),
    [extraTags.data],
  );

  const cycleRows = useLiveQuery(cycleList(db, userId, false), [userId]);
  const goalRows = useLiveQuery(cycleGoalList(db, userId), [userId]);
  const cycles = useMemo(
    () => withGoals(cycleRows.data ?? [], goalRows.data ?? []),
    [cycleRows.data, goalRows.data],
  );
  const from = useMemo(() => earliestRelevantDay(cycles, day), [cycles, day]);
  const sets = useLiveQuery(setsForCycles(db, userId, from), [userId, from]);

  const targets = useMemo(
    () => remainingTargets(cycleSummaries(cycles, sets.data ?? []), day),
    [cycles, sets.data, day],
  );

  const matches = useMemo(() => filterExercises(library.data ?? [], query), [library.data, query]);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const pick = (target: RemainingTarget) => {
    if (target.exerciseId !== null) {
      router.replace(`/day/${day}/log/${target.exerciseId}`);
      return;
    }
    Keyboard.dismiss();
    setTagId(target.tagId);
  };

  const pickTag = (id: string | null) => {
    Keyboard.dismiss();
    setTagId(id);
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Pick an exercise' }} />

      <View className="p-4 pb-2">
        <Field
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="exercise name or tag"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <ChipRow wrap>
          <Chip label="All" selected={tagId === null} onPress={() => pickTag(null)} />
          {(tags.data ?? []).map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              color={tag.color}
              selected={tagId === tag.id}
              onPress={() => pickTag(tagId === tag.id ? null : tag.id)}
            />
          ))}
        </ChipRow>

        {targets.length > 0 && (
          <View className="gap-2 pb-2">
            <SectionTitle>Left in cycles</SectionTitle>
            {targets.map((target) => (
              <Row key={target.goalId} onPress={() => pick(target)}>
                {target.color !== null && <TagDot color={target.color} />}
                <View className="flex-1">
                  <Text className="text-base text-text">{target.label}</Text>
                  <Text className="text-xs text-muted">
                    {target.cycleName} · {formatMetric(target.metric, target.remaining)}{' '}
                    {GOAL_METRIC_LABELS[target.metric].toLowerCase()} left
                  </Text>
                </View>
              </Row>
            ))}
          </View>
        )}

        {matches.length === 0 ? (
          <View className="gap-4">
            <EmptyState
              title="No such exercise"
              hint="Try a shorter phrase, or add it to the library — that works offline too."
            />
            <Button
              label="Add exercise"
              onPress={() =>
                router.push(
                  tagId === null
                    ? `/library/new?day=${day}`
                    : `/library/new?day=${day}&tagId=${tagId}`,
                )
              }
            />
          </View>
        ) : (
          matches.map((exercise) => {
            const extra = extraTagsByExercise.get(exercise.id) ?? [];
            return (
              <Row
                key={exercise.id}
                onPress={() => router.replace(`/day/${day}/log/${exercise.id}`)}
              >
                <TagDot color={exercise.tagColor} />
                <View className="flex-1">
                  <Text className="text-base text-text">{exercise.name}</Text>
                  <Text className="text-xs text-muted">{describeUsage(exercise)}</Text>
                  {/* Filtr po tagu obejmuje też tagi dodatkowe (patrz
                      `exerciseLibrary`), więc np. dipy wyskakują pod „Triceps",
                      choć ich tagiem głównym — tym, co liczy się do cyklu —
                      jest „Chest". Bez tej linii nie było widać, dlaczego wiersz
                      w ogóle trafił na przefiltrowaną listę. */}
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

        {matches.length > 0 && (
          <Button
            variant="secondary"
            label="New exercise"
            onPress={() =>
              router.push(
                tagId === null
                  ? `/library/new?day=${day}`
                  : `/library/new?day=${day}&tagId=${tagId}`,
              )
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function describeUsage(exercise: LibraryRow): string {
  const gym = exercise.gym === null ? '' : ` · ${exercise.gym}`;
  if (exercise.setCount === 0) return `${exercise.tagName}${gym}`;
  const last = exercise.lastPerformedOn;
  const when = last === null ? '' : ` · last ${formatDate(last, currentDay())}`;
  const sets = exercise.setCount === 1 ? 'set' : 'sets';
  return `${exercise.tagName} · ${String(exercise.setCount)} ${sets}${when}${gym}`;
}
