/**
 * Pojedynczy cykl: postęp, historia poprzednich okresów, reset i archiwum.
 *
 * ## Reset bez utraty historii
 *
 * Reset to przesunięcie **początku liczenia**, a nie skasowanie dorobku. Serie
 * zostają nietknięte, więc realizacja minionych okresów jest dalej do
 * policzenia — i właśnie ją pokazuje sekcja „Previous periods". Nie ma żadnej
 * tabeli realizacji do utrzymania: skoro postęp jest liczony z serii, wystarczy
 * policzyć go dla okna sprzed resetu.
 *
 * Okna minionych okresów są wyprowadzane z długości cyklu — to okresy tej samej
 * długości, doklejane do bieżącego od dołu. Dla celu miesięcznego resetowanego
 * co miesiąc pierwszy z nich jest dokładnie miesiąc wcześniej, czyli ten
 * przypadek, o który chodzi w specyfikacji. Lista sięga wstecz do dnia, przed
 * którym cyklu jeszcze nie było (patrz `cycleHistoryPeriods`), a nie do
 * ostatniego okresu: „na jakim poziomie zrealizował cykl w poprzednich
 * okresach" to pytanie o całą historię, nie o jej jeden wpis.
 *
 * Cykl bez daty końca nie ma długości, więc nie ma też okresów — i wtedy tej
 * sekcji po prostu nie ma.
 *
 * Okresów pokazujemy stronę naraz. Cykl tygodniowy liczony od roku ma ich
 * pięćdziesiąt, a każdy kolejny cofa dolną granicę odczytu serii — jedna lista
 * wszystkiego naraz kazałaby przeczytać całą historię treningową, żeby pokazać
 * ekran, na który wchodzi się po procent z tego miesiąca.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  cycleHistory,
  cycleHistoryPeriods,
  cycleSummaries,
  earliestRelevantDay,
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
import {
  Button,
  Card,
  EmptyState,
  Loading,
  ProgressBar,
  Row,
  SectionTitle,
} from '../ui/primitives';
import { formatRange, formatRatio } from './cycles';

/** Ile minionych okresów dokłada jedno naciśnięcie „Show earlier periods". */
const HISTORY_PAGE = 12;

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
    () => withGoals([...(active.data ?? []), ...(archived.data ?? [])], goals.data ?? [], today),
    [active.data, archived.data, goals.data, today],
  );

  const [periodLimit, setPeriodLimit] = useState(HISTORY_PAGE);

  // Okresy wyznaczamy z samych dat cyklu, **przed** odczytem serii: to one mówią,
  // od którego dnia trzeba te serie przeczytać.
  const opened = useMemo(() => cycles.find((item) => item.id === cycleId), [cycles, cycleId]);

  // O jeden okres więcej, niż pokazujemy — wyłącznie po to, żeby wiedzieć, czy
  // jest co doczytać.
  const periods = useMemo(
    () => (opened === undefined ? [] : cycleHistoryPeriods(opened, periodLimit + 1)),
    [opened, periodLimit],
  );
  const shownPeriods = useMemo(() => periods.slice(0, periodLimit), [periods, periodLimit]);

  const from = useMemo(() => {
    const base = earliestRelevantDay(cycles, today);
    const oldest = shownPeriods.at(-1)?.startsOn;
    return oldest !== undefined && oldest < base ? oldest : base;
  }, [cycles, shownPeriods, today]);

  const sets = useLiveQuery(setsForCycles(db, userId, from), [userId, from]);

  const summary = useMemo(
    () => cycleSummaries(cycles, sets.data ?? []).find((item) => item.cycle.id === cycleId),
    [cycles, sets.data, cycleId],
  );

  const history = useMemo(
    () => (opened === undefined ? [] : cycleHistory(opened, shownPeriods, sets.data ?? [])),
    [opened, shownPeriods, sets.data],
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
          {/* Drugi poziom pokazujemy dopiero wtedy, gdy cykl w ogóle go ma —
              inaczej każdy zwykły cel dostawałby wiersz o niczym. */}
          {progress.hasStretch && (
            <Text
              className={progress.stretchCompleted ? 'text-xs text-success' : 'text-xs text-muted'}
            >
              Higher level: {formatRatio(progress.stretchRatio)}
              {progress.level === 'higher'
                ? ' · reached'
                : progress.level === 'minimal'
                  ? ' · minimum reached'
                  : ''}
            </Text>
          )}
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
                {goal.stretchTarget !== null && (
                  <Text
                    className={
                      goal.stretchCompleted ? 'text-xs text-success' : 'text-xs text-muted'
                    }
                  >
                    Higher target {formatMetric(goal.metric, goal.stretchTarget)}
                    {goal.stretchCompleted ? ' · reached' : ''}
                  </Text>
                )}
              </Card>
            );
          })}
        </View>

        {history.length > 0 && (
          <View className="gap-2">
            <SectionTitle>Previous periods</SectionTitle>
            {history.map((entry) => (
              <Row key={entry.period.startsOn}>
                <View className="flex-1">
                  <Text className="text-text">
                    {formatDate(entry.period.startsOn, today)} –{' '}
                    {formatDate(entry.period.endsOn, today)}
                  </Text>
                </View>
                <Text className={entry.progress.completed ? 'text-success' : 'text-muted'}>
                  {formatRatio(entry.progress.ratio)}
                </Text>
              </Row>
            ))}
            {periods.length > shownPeriods.length && (
              <Button
                variant="secondary"
                label="Show earlier periods"
                onPress={() => setPeriodLimit((limit) => limit + HISTORY_PAGE)}
              />
            )}
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
