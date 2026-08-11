/**
 * Widok dnia — najważniejszy ekran produktu.
 *
 * Ten sam komponent obsługuje dzień bieżący i dowolny dzień z przeszłości.
 * To nie jest oszczędność kodu, tylko wymaganie ze specyfikacji: „ten sam widok
 * dodawania dla dnia bieżącego i historycznego". Dwa podobne ekrany rozjechałyby
 * się przy pierwszej zmianie, a użytkownik musiałby uczyć się dwóch układów.
 *
 * Wszystko na ekranie pochodzi z bazy lokalnej przez `useLiveQuery`. Zapis serii
 * przerysowuje listę sam — nie ma tu odświeżania, nie ma cache'a do
 * unieważniania i nie ma miejsca, w którym ekran czekałby na sieć.
 */

import { addDays, type IsoDate } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import { daySets, groupDaySets, type DayExerciseGroup } from '../db/queries';
import { formatDaySubtitle, formatDayTitle, setsPlural, today as currentDay } from '../day-labels';
import { formatSet } from '../measurements';
import { Button, Card, EmptyState, IconButton, Loading, Row, TagDot } from '../ui/primitives';
import { SyncBadge } from '../ui/sync-badge';

export function DayScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const today = currentDay();
  const userId = session?.user.id ?? '';

  const rows = useLiveQuery(daySets(db, userId, day));
  const groups = useMemo(() => groupDaySets(rows.data ?? []), [rows.data]);
  const total = rows.data?.length ?? 0;

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const goToDay = (target: IsoDate) => {
    router.push(target === today ? '/' : `/day/${target}`);
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen
        options={{
          title: formatDayTitle(day, today),
          headerRight: () => <SyncBadge />,
          // Wejście w konto tylko z dnia bieżącego: na dniu historycznym po
          // lewej stoi strzałka powrotu i to ona ma tam zostać.
          headerLeft:
            day === today
              ? () => (
                  <Pressable
                    accessibilityRole="button"
                    className="px-2 py-1 active:opacity-70"
                    onPress={() => router.push('/account')}
                  >
                    <Text className="text-muted">Konto</Text>
                  </Pressable>
                )
              : undefined,
        }}
      />

      <ScrollView contentContainerClassName="gap-3 p-4 pb-24">
        <View className="flex-row items-center justify-between">
          <IconButton label="Poprzedni dzień" glyph="‹" onPress={() => goToDay(addDays(day, -1))} />

          <View className="items-center">
            <Text className="text-text">{formatDaySubtitle(day, today)}</Text>
            <Text className="text-xs text-muted">
              {total === 0 ? 'brak serii' : `${String(total)} ${setsPlural(total)}`}
            </Text>
          </View>

          <IconButton
            label="Następny dzień"
            glyph="›"
            onPress={() => goToDay(addDays(day, 1))}
            // Dopisywanie serii w przyszłość nie ma sensu — dzień się jeszcze
            // nie wydarzył, a data z przyszłości psułaby podpowiedzi.
            disabled={day >= today}
          />
        </View>

        {day !== today && (
          <Button variant="secondary" label="Wróć do dziś" onPress={() => goToDay(today)} />
        )}

        {/* Biblioteka i cykle są jedno naciśnięcie od dnia, ale poniżej nawigacji
            dnia — to dzień jest ekranem, po który sięga się w trakcie treningu. */}
        <View className="flex-row gap-2">
          <Button
            grow
            variant="secondary"
            label="Biblioteka"
            onPress={() => router.push('/library')}
          />
          <Button grow variant="secondary" label="Cykle" onPress={() => router.push('/cycles')} />
        </View>

        {/* Kalendarz i rankingi to przeglądanie, nie zapisywanie — stoją niżej
            i węziej niż to, po co sięga się w trakcie treningu. */}
        <View className="flex-row gap-2">
          <Button
            grow
            variant="secondary"
            label="Kalendarz"
            onPress={() => router.push('/calendar')}
          />
          <Button
            grow
            variant="secondary"
            label="Rankingi"
            onPress={() => router.push('/rankings')}
          />
        </View>

        {groups.length === 0 ? (
          <EmptyState
            title="Nic tu jeszcze nie ma"
            hint="Wybierz ćwiczenie i zapisz pierwszą serię tego dnia."
          />
        ) : (
          groups.map((group) => (
            <ExerciseGroup
              key={group.exerciseId}
              group={group}
              onPress={() => router.push(`/day/${day}/log/${group.exerciseId}`)}
            />
          ))
        )}
      </ScrollView>

      <View className="absolute inset-x-0 bottom-0 border-t border-border bg-base p-4">
        <SafeAreaView edges={['bottom']}>
          <Button label="Dodaj serię" onPress={() => router.push(`/day/${day}/pick`)} />
        </SafeAreaView>
      </View>
    </SafeAreaView>
  );
}

function ExerciseGroup({ group, onPress }: { group: DayExerciseGroup; onPress: () => void }) {
  return (
    <Card className="gap-2">
      <Row onPress={onPress}>
        <TagDot color={group.tagColor} />
        <Text className="flex-1 text-lg font-semibold text-text">{group.exerciseName}</Text>
        <Text className="text-muted">{group.sets.length}</Text>
      </Row>

      <View className="gap-1 pl-2">
        {group.sets.map((set, index) => (
          <View key={set.id} className="flex-row items-baseline gap-3">
            <Text className="w-6 text-right text-muted">{index + 1}.</Text>
            <Text className="text-text">{formatSet(group.loggingType, set)}</Text>
            {set.note !== null && set.note.length > 0 && (
              <Text className="flex-1 text-xs text-muted" numberOfLines={1}>
                {set.note}
              </Text>
            )}
          </View>
        ))}
      </View>
    </Card>
  );
}
