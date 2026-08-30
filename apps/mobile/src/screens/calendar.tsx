/**
 * Kalendarz — przeglądanie historii.
 *
 * Ekran robi dokładnie to, czego wymaga specyfikacja i nic ponadto: pokazuje
 * miesiąc albo tydzień z **liczbą serii w kafelku dnia**, a wejście w dzień
 * prowadzi do tego samego widoku, co dzień bieżący. Osobnej osi czasu nie ma,
 * bo nie jest wymagana — a kalendarz i lista historii pokazywałyby to samo
 * dwa razy.
 *
 * Wszystko jedzie z bazy lokalnej przez `useLiveQuery`, więc kalendarz działa
 * bez sieci i przerysowuje się sam po zapisaniu serii.
 */

import { addDays, type IsoDate } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import {
  addMonths,
  calendarRange,
  calendarWeeks,
  heatLevel,
  heatPeak,
  monthLabel,
  startOfWeek,
  totalSets,
  WEEKDAY_LABELS,
  type CalendarDay,
  type CalendarScale,
} from '../calendar';
import { db } from '../db/client';
import { daySetCounts } from '../db/queries';
import { capitalize, formatDate, setsPlural, today as currentDay } from '../day-labels';
import { Button, Chip, EmptyState, IconButton, Loading } from '../ui/primitives';

const SCALES: { value: CalendarScale; label: string }[] = [
  { value: 'month', label: 'Month' },
  { value: 'week', label: 'Week' },
];

/**
 * Tła kafelków po stopniach heatmapy — indeks to poziom z `heatLevel`.
 * Klasy stoją tu w całości, bo NativeWind wyciąga je z kodu jako napisy
 * i nazwa sklejona w locie nie zostałaby zauważona.
 */
const HEAT_BACKGROUNDS = [
  'bg-surface',
  'bg-heat-1',
  'bg-heat-2',
  'bg-heat-3',
  'bg-heat-4',
] as const;

export function CalendarScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const today = currentDay();

  const [scale, setScale] = useState<CalendarScale>('month');
  const [anchor, setAnchor] = useState<IsoDate>(today);

  const range = useMemo(() => calendarRange(anchor, scale), [anchor, scale]);
  const counts = useLiveQuery(daySetCounts(db, session?.user.id ?? '', range.from, range.to), [
    session?.user.id,
    range.from,
    range.to,
  ]);

  const weeks = useMemo(
    () => calendarWeeks(anchor, scale, counts.data ?? [], today),
    [anchor, scale, counts.data, today],
  );

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  /** Krok wstecz i naprzód zależy od skali — miesiąc o miesiąc, tydzień o tydzień. */
  const shift = (direction: -1 | 1) => {
    setAnchor(scale === 'month' ? addMonths(anchor, direction) : addDays(anchor, direction * 7));
  };

  const total = totalSets(weeks);
  const peak = heatPeak(weeks);

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Calendar' }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <View className="flex-row gap-2">
          {SCALES.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              selected={scale === option.value}
              onPress={() => setScale(option.value)}
            />
          ))}
        </View>

        <View className="flex-row items-center justify-between">
          <IconButton label="Back" glyph="‹" onPress={() => shift(-1)} />
          <View className="items-center">
            <Text className="text-lg text-text">{headline(anchor, scale, today)}</Text>
            <Text className="text-xs text-muted">
              {total === 0 ? 'no sets' : `${String(total)} ${setsPlural(total)}`}
            </Text>
          </View>
          <IconButton label="Forward" glyph="›" onPress={() => shift(1)} />
        </View>

        <View className="flex-row">
          {WEEKDAY_LABELS.map((label) => (
            <Text key={label} className="flex-1 text-center text-xs uppercase text-muted">
              {label}
            </Text>
          ))}
        </View>

        <View className="gap-1">
          {weeks.map((week) => (
            <View key={week[0]?.day} className="flex-row gap-1">
              {week.map((day) => (
                <DayTile
                  key={day.day}
                  day={day}
                  level={heatLevel(day.sets, peak)}
                  onPress={() => router.push(day.day === today ? '/' : `/day/${day.day}`)}
                />
              ))}
            </View>
          ))}
        </View>

        {total > 0 && <HeatLegend />}

        {total === 0 && (
          <EmptyState
            title="Nothing in this period"
            hint="Open any day to log sets retroactively."
          />
        )}

        {anchor !== today && (
          <Button variant="secondary" label="Back to today" onPress={() => setAnchor(today)} />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/**
 * Kafelek dnia: numer i liczba serii, na tle w odcieniu zależnym od tego, ile
 * tych serii było. Dzień z przyszłości jest przygaszony — zapisywać w nim nie ma
 * czego, ale kalendarz i tak go pokazuje, bo dziura w siatce wyglądałaby na błąd.
 */
function DayTile({
  day,
  level,
  onPress,
}: {
  day: CalendarDay;
  level: number;
  onPress: () => void;
}) {
  const number = Number(day.day.slice(8, 10));
  const border = day.isToday ? 'border-accent' : 'border-border';
  const dim = day.inMonth && !day.isFuture ? '' : 'opacity-40';
  // Dwa najmocniejsze odcienie są już na tyle jasne, że jasny napis się na nich
  // rozpływa — od nich tekst przechodzi na kolor tła ekranu.
  const dark = level >= 3;
  const numberInk = dark ? 'text-base' : day.isToday ? 'text-accent' : 'text-text';
  const setsInk = dark ? 'text-base' : level === 0 ? 'text-border' : 'text-muted';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${day.day}, sets: ${String(day.sets)}`}
      onPress={onPress}
      className={`flex-1 items-center gap-1 rounded-xl border ${border} ${HEAT_BACKGROUNDS[level] ?? 'bg-surface'} py-2 active:opacity-70 ${dim}`}
    >
      <Text className={`text-sm ${day.isToday ? 'font-semibold' : ''} ${numberInk}`}>{number}</Text>
      <Text className={`text-xs ${setsInk}`}>{day.sets === 0 ? '·' : day.sets}</Text>
    </Pressable>
  );
}

/** Legenda skali — bez niej odcienie kafelków są zagadką, a nie informacją. */
function HeatLegend() {
  return (
    <View className="flex-row items-center justify-end gap-1">
      <Text className="text-xs text-muted">less</Text>
      {HEAT_BACKGROUNDS.map((background) => (
        <View key={background} className={`h-3 w-3 rounded border border-border ${background}`} />
      ))}
      <Text className="text-xs text-muted">more</Text>
    </View>
  );
}

function headline(anchor: IsoDate, scale: CalendarScale, today: IsoDate): string {
  if (scale === 'month') return capitalize(monthLabel(anchor));
  const from = startOfWeek(anchor);
  return `${formatDate(from, today)} – ${formatDate(addDays(from, 6), today)}`;
}
