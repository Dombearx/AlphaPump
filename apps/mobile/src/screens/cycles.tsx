/**
 * Lista cykli — aktywne i archiwalne.
 *
 * Każdy cykl pokazuje postęp policzony **z serii**, a nie odczytany z licznika.
 * Dzięki temu lista jest zawsze zgodna z tym, co użytkownik ma zapisane:
 * usunięcie serii zmniejsza słupek przy następnym renderze, bez żadnej korekty.
 *
 * Archiwum jest osobnym widokiem, a nie doklejką pod listą aktywnych. Cykl
 * zamknięty ogląda się rzadko i nie ma powodu, żeby zajmował miejsce na ekranie,
 * na który wchodzi się w trakcie treningu.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import {
  cycleSummaries,
  earliestRelevantDay,
  withGoals,
  type CycleSummary,
} from '../cycle-progress';
import { db } from '../db/client';
import { cycleGoalList, cycleList, setsForCycles } from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import { formatMetric } from '../measurements';
import { Button, Card, Chip, ChipRow, EmptyState, Loading, ProgressBar } from '../ui/primitives';

export function CyclesScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const today = currentDay();
  const userId = session?.user.id ?? '';

  const [archived, setArchived] = useState(false);

  const rows = useLiveQuery(cycleList(db, userId, archived), [userId, archived]);
  const goals = useLiveQuery(cycleGoalList(db, userId), [userId]);

  const cycles = useMemo(
    () => withGoals(rows.data ?? [], goals.data ?? []),
    [rows.data, goals.data],
  );

  // Serie czytamy od najwcześniejszego dnia, który może wpłynąć na wynik —
  // czyli od początku poprzedniego okresu najstarszego cyklu. Czytanie całej
  // historii dawałoby ten sam wynik i rosło z każdym miesiącem używania.
  const from = useMemo(() => earliestRelevantDay(cycles, today), [cycles, today]);
  const sets = useLiveQuery(setsForCycles(db, userId, from), [userId, from]);

  const summaries = useMemo(() => cycleSummaries(cycles, sets.data ?? []), [cycles, sets.data]);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen
        options={{
          title: 'Cykle',
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              className="px-2 py-1 active:opacity-70"
              onPress={() => router.push('/cycles/new')}
            >
              <Text className="text-accent">Nowy</Text>
            </Pressable>
          ),
        }}
      />

      <View className="p-4 pb-2">
        <ChipRow>
          <Chip label="Aktywne" selected={!archived} onPress={() => setArchived(false)} />
          <Chip label="Archiwum" selected={archived} onPress={() => setArchived(true)} />
        </ChipRow>
      </View>

      <ScrollView contentContainerClassName="gap-3 px-4 pb-8">
        {summaries.length === 0 ? (
          <View className="gap-4">
            <EmptyState
              title={archived ? 'Archiwum jest puste' : 'Nie masz aktywnych cykli'}
              hint={
                archived
                  ? 'Zarchiwizowany cykl trafi tutaj razem ze swoim dorobkiem.'
                  : 'Cykl to cel na czas: „12 serii na biceps", „10 km biegu".'
              }
            />
            {!archived && <Button label="Nowy cykl" onPress={() => router.push('/cycles/new')} />}
          </View>
        ) : (
          summaries.map((summary) => (
            <CycleCard
              key={summary.cycle.id}
              summary={summary}
              today={today}
              onPress={() => router.push(`/cycles/${summary.cycle.id}`)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function CycleCard({
  summary,
  today,
  onPress,
}: {
  summary: CycleSummary;
  today: string;
  onPress: () => void;
}) {
  const { cycle, progress } = summary;

  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-70">
      <Card className="gap-3">
        <View className="flex-row items-baseline justify-between">
          <Text className="flex-1 text-lg font-semibold text-text">{cycle.name}</Text>
          <Text className={progress.completed ? 'text-success' : 'text-muted'}>
            {formatRatio(progress.ratio)}
          </Text>
        </View>

        <Text className="text-xs text-muted">{formatRange(cycle, today)}</Text>
        <ProgressBar ratio={progress.ratio} done={progress.completed} />

        <View className="gap-1">
          {progress.goals.map((goal) => {
            const row = cycle.goals.find((candidate) => candidate.id === goal.goalId);
            return (
              <View key={goal.goalId} className="flex-row items-baseline justify-between">
                <Text className="flex-1 text-sm text-text">
                  {row?.exerciseName ?? row?.tagName ?? 'Pozycja celu'}
                </Text>
                <Text className={goal.completed ? 'text-sm text-success' : 'text-sm text-muted'}>
                  {formatMetric(goal.metric, goal.current)} /{' '}
                  {formatMetric(goal.metric, goal.target)}
                </Text>
              </View>
            );
          })}
        </View>
      </Card>
    </Pressable>
  );
}

export function formatRatio(ratio: number): string {
  return `${String(Math.round(ratio * 100))}%`;
}

export function formatRange(
  cycle: { startsOn: string; endsOn: string | null },
  today: string,
): string {
  const start = formatDate(cycle.startsOn, today);
  return cycle.endsOn === null
    ? `od ${start}, bez końca`
    : `${start} – ${formatDate(cycle.endsOn, today)}`;
}
