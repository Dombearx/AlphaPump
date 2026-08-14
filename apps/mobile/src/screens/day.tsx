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
import { daySets, groupDaySets, localUser, type DayExerciseGroup } from '../db/queries';
import { formatDaySubtitle, formatDayTitle, setsPlural, today as currentDay } from '../day-labels';
import { formatSet } from '../measurements';
import { Avatar, Button, Card, EmptyState, IconButton, Loading, Row, TagDot } from '../ui/primitives';
import { SyncBadge } from '../ui/sync-badge';

export function DayScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const today = currentDay();
  const userId = session?.user.id ?? '';

  const rows = useLiveQuery(daySets(db, userId, day));
  const groups = useMemo(() => groupDaySets(rows.data ?? []), [rows.data]);
  const total = rows.data?.length ?? 0;

  const account = useLiveQuery(localUser(db, userId));
  const nickname = account.data[0]?.nickname ?? session?.user.email ?? '';

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
          // Kalendarz i rankingi to przeglądanie, nie zapisywanie — w nagłówku
          // jako małe ikonki, a nie duże przyciski na środku, którymi i tak
          // sięga się rzadziej niż po dodanie serii.
          headerRight: () => (
            <View className="flex-row items-center gap-1">
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Calendar"
                className="px-2 py-1 active:opacity-70"
                onPress={() => router.push('/calendar')}
              >
                <Text className="text-lg">📅</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Rankings"
                className="px-2 py-1 active:opacity-70"
                onPress={() => router.push('/rankings')}
              >
                <Text className="text-lg">🏆</Text>
              </Pressable>
              <SyncBadge />
            </View>
          ),
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
                    <Avatar uri={session.user.image} label={nickname} size={28} />
                  </Pressable>
                )
              : undefined,
        }}
      />

      <ScrollView contentContainerClassName="gap-3 p-4 pb-24">
        <View className="flex-row items-center justify-between">
          <IconButton label="Previous day" glyph="‹" onPress={() => goToDay(addDays(day, -1))} />

          <View className="items-center">
            <Text className="text-text">{formatDaySubtitle(day, today)}</Text>
            <Text className="text-xs text-muted">
              {total === 0 ? 'no sets' : `${String(total)} ${setsPlural(total)}`}
            </Text>
          </View>

          <IconButton
            label="Next day"
            glyph="›"
            onPress={() => goToDay(addDays(day, 1))}
            // Dopisywanie serii w przyszłość nie ma sensu — dzień się jeszcze
            // nie wydarzył, a data z przyszłości psułaby podpowiedzi.
            disabled={day >= today}
          />
        </View>

        {day !== today && (
          <Button variant="secondary" label="Back to today" onPress={() => goToDay(today)} />
        )}

        {/* Biblioteka i cykle są jedno naciśnięcie od dnia, ale poniżej nawigacji
            dnia — to dzień jest ekranem, po który sięga się w trakcie treningu. */}
        <View className="flex-row gap-2">
          <Button
            grow
            variant="secondary"
            label="Exercises"
            onPress={() => router.push('/library')}
          />
          <Button grow variant="secondary" label="Cycles" onPress={() => router.push('/cycles')} />
        </View>

        {groups.length === 0 ? (
          <EmptyState
            title="Nothing here yet"
            hint="Pick an exercise and log the first set of the day."
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
          <Button label="Add set" onPress={() => router.push(`/day/${day}/pick`)} />
        </SafeAreaView>
      </View>
    </SafeAreaView>
  );
}

function ExerciseGroup({ group, onPress }: { group: DayExerciseGroup; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} className="active:opacity-70">
      <Card className="gap-2">
        <Row>
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
    </Pressable>
  );
}
