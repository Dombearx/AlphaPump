/**
 * Ćwiczenie w bibliotece — co to jest, kto je dodał i co można z nim zrobić.
 *
 * Ekran jest krótki celowo: biblioteka to słownik, a nie miejsce, w którym
 * spędza się czas. Najważniejszy przycisk prowadzi do zapisania serii, reszta
 * to zarządzanie wpisem — widoczne wyłącznie dla tych, którzy mają do niego
 * prawo, czyli autora i administratora.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { Alert, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { deleteExercise } from '../db/library';
import { additionalTagsOf, exerciseDetails, exerciseHistory } from '../db/queries';
import { today as currentDay } from '../day-labels';
import { useLocalAuthor } from '../hooks';
import { LOGGING_TYPE_LABELS } from '../measurements';
import { useRequestSync } from '../sync/provider';
import { GlobalRecordsCard } from '../ui/global-records';
import { Button, Card, Chip, ChipRow, EmptyState, Loading, TagDot } from '../ui/primitives';

export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const requestSync = useRequestSync();

  const details = useLiveQuery(exerciseDetails(db, exerciseId), [exerciseId]);
  const extraTags = useLiveQuery(additionalTagsOf(db, exerciseId), [exerciseId]);
  const history = useLiveQuery(exerciseHistory(db, author?.userId ?? '', exerciseId), [
    author?.userId,
    exerciseId,
  ]);

  const exercise = details.data[0];

  if (author === null) return <Loading />;
  if (exercise === undefined) {
    return details.updatedAt === undefined ? (
      <Loading label="Loading exercise…" />
    ) : (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-base p-6">
        <EmptyState
          title="This exercise no longer exists"
          hint="It was removed from the library."
        />
        <Button label="Back to library" onPress={() => router.replace('/library')} />
      </SafeAreaView>
    );
  }

  const mayModify = author.role === 'admin' || exercise.authorId === author.userId;
  const sets = history.data ?? [];
  const lastPerformedOn = sets.at(-1)?.performedOn ?? null;

  const remove = () => {
    Alert.alert(
      'Delete this exercise?',
      'Logged sets stay, but the exercise disappears from the library on every device.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              await deleteExercise(db, exerciseId, author);
              requestSync();
              router.replace('/library');
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: exercise.name }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <TagDot color={exercise.tagColor} />
            <Text className="flex-1 text-xl font-semibold text-text">{exercise.name}</Text>
          </View>

          <Text className="text-muted">
            {exercise.tagName} · {LOGGING_TYPE_LABELS[exercise.loggingType]}
          </Text>
          <Text className="text-xs text-muted">Added by: {exercise.authorNickname}</Text>

          {exercise.note !== null && exercise.note.length > 0 && (
            <Text className="text-text">{exercise.note}</Text>
          )}
        </Card>

        {extraTags.data.length > 0 && (
          <View className="gap-2">
            {/* Sam tag główny (wyżej, w opisie ćwiczenia) liczy się do celów
                cyklu — te dodatkowe tylko mówią, jakich innych partii dotyka
                to ćwiczenie, i dlatego też trafia na ich przefiltrowane listy. */}
            <Text className="text-xs text-muted">Also works: (doesn't count toward cycles)</Text>
            <ChipRow>
              {extraTags.data.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  color={tag.color}
                  onPress={() => router.push('/library')}
                />
              ))}
            </ChipRow>
          </View>
        )}

        <Text className="text-muted">
          {sets.length === 0
            ? "You don't have any sets of this exercise yet."
            : `Your sets: ${String(sets.length)}${
                lastPerformedOn === null ? '' : ` · last ${lastPerformedOn}`
              }`}
        </Text>

        {/* Rekordy globalne są jedyną rzeczą na tym ekranie, która wymaga sieci
            — dlatego stoją w osobnej karcie, która sama radzi sobie z jej
            brakiem. Reszta ekranu ma działać w trybie samolotowym. */}
        <GlobalRecordsCard exerciseId={exerciseId} loggingType={exercise.loggingType} />

        <Button
          label="Log a set today"
          onPress={() => router.push(`/day/${currentDay()}/log/${exerciseId}`)}
        />

        <Button
          variant="secondary"
          label="Progress charts"
          onPress={() => router.push(`/library/${exerciseId}/chart`)}
        />

        {mayModify && (
          <View className="gap-2">
            <Button
              variant="secondary"
              label="Edit"
              onPress={() => router.push(`/library/${exerciseId}/edit`)}
            />
            <Button variant="danger" label="Remove from library" onPress={remove} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
