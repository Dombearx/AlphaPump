/**
 * Historia poprawiania jednego rekordu — co zbił obecny wynik, co zbił tamten.
 *
 * Ekran odpowiada na pytanie zadawane zaraz po komunikacie o rekordzie: „dobra,
 * a ile było przedtem?". Sam rekord widać na ekranie zapisywania serii, ale bez
 * poprzedniego wyniku nie wiadomo, o ile to jest lepiej — a to jest cała treść
 * rekordu dla tego, kto go właśnie ustanowił.
 *
 * Łańcuch liczy `recordProgression` z `@alphapump/core`, czyli ten sam front
 * Pareto, który w ogóle rozstrzyga, co jest rekordem. Nie ma tu drugiej
 * definicji poprawy: wpis niżej to dokładnie ten wynik, który wpis wyżej zbił.
 *
 * Wszystko jedzie z bazy lokalnej, więc historia działa bez sieci.
 */

import { recordProgression } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { exerciseDetails, exerciseHistory } from '../db/queries';
import { formatDayTitle, today as currentDay } from '../day-labels';
import { useLocalAuthor } from '../hooks';
import { useLocalizedName } from '../language/provider';
import { formatSet } from '../measurements';
import { Button, EmptyState, Loading, Row, SectionTitle } from '../ui/primitives';

export function RecordProgressionScreen({
  exerciseId,
  setId,
}: {
  exerciseId: string;
  setId: string;
}) {
  const router = useRouter();
  const author = useLocalAuthor();
  const named = useLocalizedName();
  const today = currentDay();

  const details = useLiveQuery(exerciseDetails(db, exerciseId), [exerciseId]);
  const history = useLiveQuery(exerciseHistory(db, author?.userId ?? '', exerciseId), [
    author?.userId,
    exerciseId,
  ]);

  const exercise = details.data[0];
  const loggingType = exercise?.loggingType;

  const lineage = useMemo(
    () =>
      loggingType === undefined ? [] : recordProgression(loggingType, history.data ?? [], setId),
    [loggingType, history.data, setId],
  );

  if (author === null) return <Loading />;

  if (exercise === undefined) {
    return details.updatedAt === undefined ? (
      <Loading label="Loading exercise…" />
    ) : (
      <SafeAreaView className="flex-1 justify-center gap-4 p-6">
        <EmptyState
          title="This exercise no longer exists"
          hint="It was removed from the library."
        />
        <Button label="Back to library" onPress={() => router.replace('/library')} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: named(exercise) }} />

      <ScrollView contentContainerClassName="gap-3 p-4 pb-10">
        <SectionTitle>Record history</SectionTitle>

        {lineage.length === 0 ? (
          // Rekord da się stracić, nie ruszając tego ekranu: wystarczy, że seria
          // zostanie poprawiona albo przyjedzie z innego urządzenia lepsza.
          <EmptyState
            title="This set is no longer a record"
            hint="Another set has beaten it — open the records list again to see the current one."
          />
        ) : (
          <>
            {lineage.map((record, index) => (
              <View key={record.id} className="gap-2">
                {/* Napis między wierszami mówi wprost, co z czego wynika —
                    sama lista dat wyglądałaby jak historia serii, a to jest
                    łańcuch: ten wynik zbił ten niżej. */}
                {index > 0 && <Text className="pl-2 text-xs text-muted">beat</Text>}
                <Row>
                  <View className="flex-1">
                    <Text className="text-base text-text">
                      {formatSet(exercise.loggingType, record)}
                    </Text>
                    <Text className="text-xs text-muted">
                      {formatDayTitle(record.performedOn, today)}
                    </Text>
                  </View>
                  {index === 0 && (
                    <Text className="text-xs uppercase tracking-wide text-accent">Current</Text>
                  )}
                </Row>
              </View>
            ))}

            {lineage.length === 1 && (
              <Text className="text-muted">
                This is your first record here — there's no earlier result it has beaten yet.
              </Text>
            )}
          </>
        )}

        {/* Powrót, a nie przejście na ekran ćwiczenia: historię rekordu otwiera
            się z listy rekordów w środku zapisywania serii i wracać ma się
            dokładnie tam, razem z tym, co jest już wpisane w formularzu. */}
        <Button variant="secondary" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
