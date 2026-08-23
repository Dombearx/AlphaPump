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
import { useLocalizedName } from '../language/provider';
import { LOGGING_TYPE_LABELS } from '../measurements';
import { useRequestSync } from '../sync/provider';
import { GlobalRecordsCard } from '../ui/global-records';
import { Button, Card, Chip, ChipRow, EmptyState, Loading, TagDot } from '../ui/primitives';

export function ExerciseScreen({ exerciseId }: { exerciseId: string }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const requestSync = useRequestSync();
  const named = useLocalizedName();

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
      <SafeAreaView className="flex-1 justify-center gap-4 p-6">
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
      'It disappears from the library on every device. Exercises with logged sets can’t be deleted.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await deleteExercise(db, exerciseId, author);
              } catch (error) {
                // Reguła „ćwiczenia z seriami się nie usuwa" mieszka w warstwie
                // zapisu, bo obowiązuje też zapis przychodzący skądinąd. Ekran
                // ma ją tylko pokazać — przycisk niżej i tak jest wtedy nieaktywny,
                // więc tu ląduje wyłącznie przypadek serii dopisanej w międzyczasie.
                Alert.alert('Can’t delete', (error as Error).message);
                return;
              }
              requestSync();
              router.replace('/library');
            })();
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: named(exercise) }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <Card className="gap-3">
          <View className="flex-row items-center gap-3">
            <TagDot color={exercise.tagColor} />
            <Text className="flex-1 text-xl font-semibold text-text">{named(exercise)}</Text>
          </View>

          <Text className="text-muted">
            {named({ name: exercise.tagName, translations: exercise.tagTranslations })} ·{' '}
            {LOGGING_TYPE_LABELS[exercise.loggingType]}
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
                  label={named(tag)}
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
            {/* Serie widoczne tu są wyłącznie własne, więc ćwiczenie, na którym
                trenuje ktoś inny z grupy, dalej wygląda na usuwalne — odmówi
                dopiero serwer. To jest ta sama granica, co przy każdej regule
                sprawdzanej lokalnie: telefon nie ma cudzych danych. */}
            <Button
              variant="danger"
              label="Remove from library"
              disabled={sets.length > 0}
              onPress={remove}
            />
            {sets.length > 0 && (
              <Text className="text-xs text-muted">
                Can’t be deleted — you have sets logged here. An admin can merge it into another
                exercise, keeping every set.
              </Text>
            )}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
