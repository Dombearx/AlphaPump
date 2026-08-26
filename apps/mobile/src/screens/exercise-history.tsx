/**
 * Historia serii jednego ćwiczenia — wszystkie treningi, od ostatniego.
 *
 * Ekran powstał dla jednego pytania zadawanego w połowie serii: „ile brałem
 * ostatnim razem?". Odpowiedź stała dotąd na wykresie albo w kalendarzu, czyli
 * o kilka naciśnięć dalej i w innej postaci niż lista serii — dlatego wchodzi
 * się tu **wprost z formularza serii**, z filtrem już ustawionym na ćwiczenie,
 * które właśnie się zapisuje.
 *
 * To nie jest oś czasu niezależna od kalendarza, której specyfikacja nie
 * wymaga: ekran pokazuje jedno ćwiczenie i nic poza nim. Układ jest ten sam,
 * co na liście dnia — karta na dzień, w środku ponumerowane serie — bo to samo
 * czyta się tu i tam, a dwa układy tej samej rzeczy rozjeżdżają się przy
 * pierwszej zmianie.
 *
 * Wszystko jedzie z bazy lokalnej, więc historia działa bez sieci.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { exerciseDetails, exerciseHistory, groupHistoryByDay } from '../db/queries';
import { formatDayTitle, setsPlural, today as currentDay } from '../day-labels';
import { useLocalAuthor } from '../hooks';
import { useLocalizedName } from '../language/provider';
import { formatSet } from '../measurements';
import { Button, Card, EmptyState, Loading, Row } from '../ui/primitives';

export function ExerciseHistoryScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const named = useLocalizedName();
  const today = currentDay();

  const details = useLiveQuery(exerciseDetails(db, exerciseId), [exerciseId]);
  const history = useLiveQuery(exerciseHistory(db, author?.userId ?? '', exerciseId), [
    author?.userId,
    exerciseId,
  ]);

  const days = useMemo(() => groupHistoryByDay(history.data ?? []), [history.data]);

  if (author === null) return <Loading />;

  const exercise = details.data[0];
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
        {days.length === 0 ? (
          <EmptyState
            title="No sets yet"
            hint="The first set of this exercise will show up here."
          />
        ) : (
          days.map((entry) => (
            <Card key={entry.day} className="gap-2">
              <Row>
                <Text className="flex-1 text-base font-semibold text-text">
                  {formatDayTitle(entry.day, today)}
                </Text>
                <Text className="text-muted">
                  {entry.sets.length} {setsPlural(entry.sets.length)}
                </Text>
              </Row>

              <View className="gap-1 pl-2">
                {entry.sets.map((set, index) => (
                  <View key={set.id} className="flex-row items-baseline gap-3">
                    <Text className="w-6 text-right text-muted">{index + 1}.</Text>
                    <Text className="text-text">{formatSet(exercise.loggingType, set)}</Text>
                    {set.note !== null && set.note.length > 0 && (
                      <Text className="flex-1 text-xs text-muted" numberOfLines={1}>
                        {set.note}
                      </Text>
                    )}
                  </View>
                ))}
              </View>
            </Card>
          ))
        )}

        {/* Powrót, a nie przejście na ekran ćwiczenia: historię otwiera się
            w środku zapisywania serii, a wracać ma się dokładnie do formularza
            — razem z tym, co jest już w nim wpisane. */}
        <Button variant="secondary" label="Back" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
