/**
 * Rankingi globalne.
 *
 * Jedyny ekran w aplikacji, który czeka na sieć — i jedyny, który może.
 * Ranking liczy się z serii wszystkich użytkowników, a te są prywatne i nigdy
 * nie zjadą na telefon, więc nie ma z czego policzyć go lokalnie. Brak
 * łączności nie jest tu awarią: ekran mówi „offline" i daje przycisk ponowienia,
 * dokładnie tak jak odznaka synchronizacji.
 *
 * Trzy zestawienia wprost ze specyfikacji: suma objętości (kg × powtórzenia),
 * suma dystansu i liczba posiadanych rekordów globalnych. Ranking jest globalny,
 * bez przedziału czasu.
 */

import { RANKING_METRICS, type RankingEntry, type RankingMetric } from '@alphapump/core';
import { Redirect, Stack } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { formatDistance, formatWeight } from '../measurements';
import { remoteReader } from '../remote/reader';
import { useRemote } from '../remote/use-remote';
import { COLORS } from '../theme';
import { Button, Chip, ChipRow, EmptyState, Loading, Row } from '../ui/primitives';

const METRIC_LABELS: Readonly<Record<RankingMetric, string>> = {
  volume: 'Volume',
  distance: 'Distance',
  records: 'Records',
};

const METRIC_HINTS: Readonly<Record<RankingMetric, string>> = {
  volume: 'Sum of weight times reps across every set.',
  distance: 'Sum of distance across every running set.',
  records: 'Number of global records nobody has beaten yet.',
};

/** Wartość w jednostkach metryki — ta sama skala co przy pojedynczej serii. */
function formatRankingValue(metric: RankingMetric, value: number): string {
  switch (metric) {
    case 'volume':
      return `${formatWeight(value)} kg`;
    case 'distance':
      return formatDistance(value);
    case 'records':
      return String(value);
  }
}

export function RankingsScreen() {
  const { data: session, isPending } = useSession();
  const [metric, setMetric] = useState<RankingMetric>('volume');

  const { state, reload } = useRemote(() => remoteReader.ranking(metric), [metric]);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Rankings' }} />

      <View className="gap-3 p-4 pb-2">
        <ChipRow>
          {RANKING_METRICS.map((option) => (
            <Chip
              key={option}
              label={METRIC_LABELS[option]}
              selected={metric === option}
              onPress={() => setMetric(option)}
            />
          ))}
        </ChipRow>
        <Text className="text-xs text-muted">{METRIC_HINTS[metric]}</Text>
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8">
        {state.status === 'loading' && <Loading label="Loading ranking…" />}

        {state.status === 'offline' && (
          <View className="gap-4">
            <EmptyState
              title="Offline"
              hint="The ranking is computed from every user's sets, so it needs a connection to the server."
            />
            <Button variant="secondary" label="Try again" onPress={reload} />
          </View>
        )}

        {state.status === 'error' && (
          <View className="gap-4">
            <EmptyState title="Failed to fetch the ranking" hint={state.message} />
            <Button variant="secondary" label="Try again" onPress={reload} />
          </View>
        )}

        {state.status === 'ready' &&
          (state.data.length === 0 ? (
            <EmptyState
              title="Nobody has a result yet"
              hint="The ranking fills up once the first sets are synced."
            />
          ) : (
            state.data.map((entry) => (
              <RankingRow
                key={entry.userId}
                entry={entry}
                metric={metric}
                isMe={entry.userId === session.user.id}
              />
            ))
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}

function RankingRow({
  entry,
  metric,
  isMe,
}: {
  entry: RankingEntry;
  metric: RankingMetric;
  isMe: boolean;
}) {
  return (
    <Row selected={isMe}>
      <Text className="w-8 text-right text-muted">{entry.position}.</Text>
      <Text
        className={`flex-1 text-base ${isMe ? 'font-semibold' : ''}`}
        style={{ color: isMe ? COLORS.accent : COLORS.text }}
      >
        {entry.nickname}
      </Text>
      <Text className="text-text">{formatRankingValue(metric, entry.value)}</Text>
    </Row>
  );
}
