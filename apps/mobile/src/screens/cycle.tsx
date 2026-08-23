/**
 * Pojedynczy cykl: postęp, poprzedni okres, reset i archiwum.
 *
 * ## Reset bez utraty historii
 *
 * Reset to przesunięcie **początku liczenia**, a nie skasowanie dorobku. Serie
 * zostają nietknięte, więc realizacja poprzedniego okresu jest dalej do
 * policzenia — i właśnie ją pokazuje sekcja „Poprzedni okres". Nie ma żadnej
 * tabeli realizacji do utrzymania: skoro postęp jest liczony z serii, wystarczy
 * policzyć go dla okna sprzed resetu.
 *
 * Okno poprzedniego okresu jest wyprowadzane z długości cyklu — to okres tej
 * samej długości, przyklejony do bieżącego od dołu. Dla celu miesięcznego
 * resetowanego co miesiąc jest to dokładnie miesiąc wcześniej, czyli ten
 * przypadek, o który chodzi w specyfikacji. Cykl bez daty końca nie ma długości,
 * więc nie ma też poprzedniego okresu — i wtedy tej sekcji po prostu nie ma.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  cycleSummaries,
  earliestRelevantDay,
  previousPeriodProgress,
  withGoals,
} from '../cycle-progress';
import { db } from '../db/client';
import { deleteCycle, resetCycle, setCycleArchived } from '../db/cycles';
import { cycleGoalList, cycleList, setsForCycles } from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import { goalName } from '../goal-labels';
import { useLocalAuthor } from '../hooks';
import { useLocalizedName } from '../language/provider';
import { formatMetric } from '../measurements';
import { useRequestSync } from '../sync/provider';
import { Button, Card, EmptyState, Loading, ProgressBar, Row } from '../ui/primitives';
import { formatRange, formatRatio } from './cycles';

export function CycleScreen({ cycleId }: { cycleId: string }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const requestSync = useRequestSync();
  const named = useLocalizedName();
  const today = currentDay();
  const userId = author?.userId ?? '';

  // Cykl bywa aktywny albo archiwalny, a ten ekran obsługuje oba — stąd dwa
  // zapytania zamiast jednego z parametrem.
  const active = useLiveQuery(cycleList(db, userId, false), [userId]);
  const archived = useLiveQuery(cycleList(db, userId, true), [userId]);
  const goals = useLiveQuery(cycleGoalList(db, userId), [userId]);

  const cycles = useMemo(
    () => withGoals([...(active.data ?? []), ...(archived.data ?? [])], goals.data ?? []),
    [active.data, archived.data, goals.data],
  );

  const from = useMemo(() => earliestRelevantDay(cycles, today), [cycles, today]);
  const sets = useLiveQuery(setsForCycles(db, userId, from), [userId, from]);

  const summary = useMemo(
    () => cycleSummaries(cycles, sets.data ?? []).find((item) => item.cycle.id === cycleId),
    [cycles, sets.data, cycleId],
  );

  const previous = useMemo(
    () => (summary === undefined ? null : previousPeriodProgress(summary.cycle, sets.data ?? [])),
    [summary, sets.data],
  );

  if (author === null) return <Loading />;
  if (summary === undefined) {
    return goals.updatedAt === undefined ? (
      <Loading label="Loading cycle…" />
    ) : (
      <SafeAreaView className="flex-1 justify-center gap-4 p-6">
        <EmptyState title="This cycle no longer exists" />
        <Button label="Back to cycles" onPress={() => router.replace('/cycles')} />
      </SafeAreaView>
    );
  }

  const { cycle, progress } = summary;
  const isArchived = cycle.archivedAt !== null;

  const act = (action: () => Promise<void>) => {
    void (async () => {
      await action();
      requestSync();
    })();
  };

  const reset = () => {
    Alert.alert(
      'Reset this cycle?',
      'Counting starts over from today. Sets stay — the previous period will still be visible.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          onPress: () => act(() => resetCycle(db, cycleId, today, author)),
        },
      ],
    );
  };

  const remove = () => {
    Alert.alert('Delete this cycle?', 'Sets stay untouched — only the goal disappears.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          act(async () => {
            await deleteCycle(db, cycleId, author);
            router.replace('/cycles');
          }),
      },
    ]);
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: cycle.name }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <Card className="gap-3">
          <View className="flex-row items-baseline justify-between">
            <Text className="flex-1 text-xl font-semibold text-text">{cycle.name}</Text>
            <Text className={progress.completed ? 'text-success' : 'text-muted'}>
              {formatRatio(progress.ratio)}
            </Text>
          </View>
          <Text className="text-xs text-muted">
            {formatRange(cycle, today)}
            {isArchived ? ' · archived' : ''}
          </Text>
          <ProgressBar ratio={progress.ratio} done={progress.completed} />
        </Card>

        <View className="gap-2">
          {progress.goals.map((goal) => {
            const row = cycle.goals.find((candidate) => candidate.id === goal.goalId);

            return (
              <Card key={goal.goalId} className="gap-2">
                <View className="flex-row items-baseline justify-between">
                  <Text className="flex-1 text-base text-text">{goalName(row ?? null, named)}</Text>
                  <Text className={goal.completed ? 'text-success' : 'text-muted'}>
                    {formatMetric(goal.metric, goal.current)} /{' '}
                    {formatMetric(goal.metric, goal.target)}
                  </Text>
                </View>
                <ProgressBar ratio={goal.ratio} done={goal.completed} />
                {!goal.completed && (
                  <Text className="text-xs text-muted">
                    {formatMetric(goal.metric, goal.remaining)} left
                  </Text>
                )}
              </Card>
            );
          })}
        </View>

        {previous !== null && (
          <View className="gap-2">
            <Row>
              <View className="flex-1">
                <Text className="text-text">Previous period</Text>
                <Text className="text-xs text-muted">
                  {formatDate(previous.period.startsOn, today)} –{' '}
                  {formatDate(previous.period.endsOn, today)}
                </Text>
              </View>
              <Text className="text-muted">{formatRatio(previous.progress.ratio)}</Text>
            </Row>
          </View>
        )}

        <View className="gap-2">
          <Button
            variant="secondary"
            label="Edit"
            onPress={() => router.push(`/cycles/${cycleId}/edit`)}
          />
          <Button variant="secondary" label="Reset from today" onPress={reset} />
          <Button
            variant="secondary"
            label={isArchived ? 'Restore from archive' : 'Move to archive'}
            onPress={() => act(() => setCycleArchived(db, cycleId, !isArchived, author))}
          />
          <Button variant="danger" label="Delete cycle" onPress={remove} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
