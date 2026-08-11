/**
 * Ekran analityczny ćwiczenia — wykresy postępu.
 *
 * „Wykresy są prezentowane per ćwiczenie, bez rozbudowanych dashboardów
 * przekrojowych" — dlatego ekran jest jeden, wchodzi się na niego z ćwiczenia
 * i pokazuje jedną metrykę naraz. Przełącznik metryk jest rzędem chipsów, czyli
 * tym samym klockiem, co filtr biblioteki i wybór metryki celu.
 *
 * Zestaw metryk zależy od typu logowania: przy biegu nie ma czego pokazywać na
 * osi ciężaru. Liczy to `chart-data.ts`, ekran jedynie rysuje.
 *
 * Wszystko pochodzi z bazy lokalnej — wykres jest odczytem, który zgodnie ze
 * specyfikacją musi działać bez internetu.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { chartSummary, metricsFor, recentPoints, type ChartMetric } from '../chart-data';
import { db } from '../db/client';
import { exerciseDetails, exerciseHistory } from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import { useLocalAuthor } from '../hooks';
import { formatDistance, formatDuration, formatWeight, LOGGING_TYPE_LABELS } from '../measurements';
import { BarChart } from '../ui/chart';
import { Button, Card, Chip, ChipRow, EmptyState, Loading, SectionTitle } from '../ui/primitives';

/** Ile dni treningowych mieści się na wykresie, żeby słupki zostały czytelne. */
const POINTS_SHOWN = 14;

export function ExerciseChartScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const today = currentDay();

  const details = useLiveQuery(exerciseDetails(db, exerciseId), [exerciseId]);
  const history = useLiveQuery(exerciseHistory(db, author?.userId ?? '', exerciseId), [
    author?.userId,
    exerciseId,
  ]);

  const [metricKey, setMetricKey] = useState<string | null>(null);

  const exercise = details.data[0];
  const sets = useMemo(() => history.data ?? [], [history.data]);

  const metrics = useMemo(
    () => (exercise === undefined ? [] : metricsFor(exercise.loggingType)),
    [exercise],
  );
  const metric = metrics.find((candidate) => candidate.key === metricKey) ?? metrics[0];

  const summary = useMemo(
    () => (metric === undefined ? null : chartSummary(metric, sets)),
    [metric, sets],
  );

  if (author === null) return <Loading />;
  if (exercise === undefined || metric === undefined || summary === null) {
    return details.updatedAt === undefined ? (
      <Loading label="Wczytywanie ćwiczenia…" />
    ) : (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-base p-6">
        <EmptyState title="Nie ma już takiego ćwiczenia" hint="Zostało usunięte z biblioteki." />
        <Button label="Wróć do biblioteki" onPress={() => router.replace('/library')} />
      </SafeAreaView>
    );
  }

  const format = (value: number) => formatMetricValue(metric, value);
  const points = recentPoints(summary.points, POINTS_SHOWN);

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: exercise.name }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <Text className="text-muted">{LOGGING_TYPE_LABELS[exercise.loggingType]}</Text>

        <ChipRow>
          {metrics.map((option) => (
            <Chip
              key={option.key}
              label={option.label}
              selected={option.key === metric.key}
              onPress={() => setMetricKey(option.key)}
            />
          ))}
        </ChipRow>

        {points.length === 0 ? (
          <EmptyState
            title="Nie ma jeszcze czego pokazać"
            hint="Wykres pojawi się po zapisaniu pierwszej serii tego ćwiczenia."
          />
        ) : (
          <Card className="gap-3">
            <SectionTitle>{metric.label}</SectionTitle>
            <BarChart
              points={points}
              max={summary.max}
              format={format}
              labelOf={(point) => point.day.slice(8, 10)}
            />
            <Text className="text-xs text-muted">
              {summary.points.length > points.length
                ? `Ostatnie dni treningowe: ${String(points.length)} z ${String(summary.points.length)}`
                : `Dni treningowe: ${String(points.length)}`}
            </Text>
          </Card>
        )}

        {summary.best !== null && summary.latest !== null && (
          <View className="gap-2">
            <Highlight
              label="Najlepszy dzień"
              value={format(summary.best.value)}
              day={formatDate(summary.best.day, today)}
            />
            <Highlight
              label="Ostatni trening"
              value={format(summary.latest.value)}
              day={formatDate(summary.latest.day, today)}
            />
          </View>
        )}

        <Button
          variant="secondary"
          label="Wróć do ćwiczenia"
          onPress={() => router.push(`/library/${exerciseId}`)}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function Highlight({ label, value, day }: { label: string; value: string; day: string }) {
  return (
    <Card className="flex-row items-baseline justify-between">
      <Text className="text-muted">{label}</Text>
      <View className="items-end">
        <Text className="text-lg text-text">{value}</Text>
        <Text className="text-xs text-muted">{day}</Text>
      </View>
    </Card>
  );
}

/**
 * Wartość metryki po ludzku — tą samą skalą, co pojedyncza seria, żeby „80 kg"
 * na liście serii i „80 kg" na wykresie znaczyły to samo. Objętość jest sumą
 * gramoreps, więc też schodzi do kilogramów: „12 400 kg" mówi o włożonej pracy,
 * a „12 400 000" o niczym.
 */
function formatMetricValue(metric: ChartMetric, value: number): string {
  switch (metric.kind) {
    case 'count':
    case 'reps':
      return String(value);
    case 'weight':
      return `${formatWeight(value)} kg`;
    case 'duration':
      return formatDuration(value);
    case 'distance':
      return formatDistance(value);
  }
}
