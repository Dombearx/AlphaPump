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
      <Loading label="Wczytywanie ćwiczenia…" />
    ) : (
      <SafeAreaView className="flex-1 justify-center gap-4 bg-base p-6">
        <EmptyState title="Nie ma już takiego ćwiczenia" hint="Zostało usunięte z biblioteki." />
        <Button label="Wróć do biblioteki" onPress={() => router.replace('/library')} />
      </SafeAreaView>
    );
  }

  const mayModify = author.role === 'admin' || exercise.authorId === author.userId;
  const sets = history.data ?? [];
  const lastPerformedOn = sets.at(-1)?.performedOn ?? null;

  const remove = () => {
    Alert.alert(
      'Usunąć ćwiczenie?',
      'Zapisane serie zostaną, ale ćwiczenie zniknie z biblioteki na wszystkich urządzeniach.',
      [
        { text: 'Anuluj', style: 'cancel' },
        {
          text: 'Usuń',
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
          <Text className="text-xs text-muted">Dodał: {exercise.authorNickname}</Text>

          {exercise.note !== null && exercise.note.length > 0 && (
            <Text className="text-text">{exercise.note}</Text>
          )}
        </Card>

        {extraTags.data.length > 0 && (
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
        )}

        <Text className="text-muted">
          {sets.length === 0
            ? 'Nie masz jeszcze żadnej serii tego ćwiczenia.'
            : `Twoje serie: ${String(sets.length)}${
                lastPerformedOn === null ? '' : ` · ostatnio ${lastPerformedOn}`
              }`}
        </Text>

        <Button
          label="Zapisz serię dziś"
          onPress={() => router.push(`/day/${currentDay()}/log/${exerciseId}`)}
        />

        {mayModify && (
          <View className="gap-2">
            <Button
              variant="secondary"
              label="Edytuj"
              onPress={() => router.push(`/library/${exerciseId}/edit`)}
            />
            <Button variant="danger" label="Usuń z biblioteki" onPress={remove} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
