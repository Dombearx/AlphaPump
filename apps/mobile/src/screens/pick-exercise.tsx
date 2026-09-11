/**
 * Wybór ćwiczenia do zapisania serii.
 *
 * Ekran jest pomiędzy dniem a formularzem, więc każdy jego dodatkowy element to
 * dodatkowy krok w najczęstszej czynności w aplikacji. Dlatego jest tu wyłącznie
 * szukajka, filtr tagów i lista, a wybór ćwiczenia **podmienia** ten ekran
 * w stosie: cofnięcie z formularza wraca do dnia, a nie do listy, z której przed
 * chwilą się wyszło.
 *
 * Kolejność listy rozstrzyga ustawienie „Suggest what to do next" (konto,
 * domyślnie włączone). Z nim na górze stoją ćwiczenia, które domykają aktywne
 * cykle i odciążają partie z ostatnich serii dnia — patrz `rotation.ts`
 * w rdzeniu i `exercise-rotation.ts` obok. Bez niego zostaje kolejność po
 * liczbie własnych serii malejąco: ćwiczenia, które użytkownik faktycznie
 * wykonuje, u góry bez żadnego ustawiania. Ta druga kolejność nie znika także
 * przy włączonym ustawieniu — sortowanie jest stabilne, więc rozstrzyga remisy,
 * czyli całą listę poza kilkoma pozycjami wyciągniętymi na górę.
 *
 * Podpowiadanie jest wyłączone, gdy wybrany jest chips tagu: filtr jest
 * **wskazaniem użytkownika**, co ma robić, i przestawianie mu wtedy kolejności
 * byłoby kłóceniem się z nim o rzecz, którą już rozstrzygnął. Zapytanie układa
 * wtedy listę po trafieniu w tag główny (patrz `exerciseLibrary`), a to jest
 * kolejność, której ta lista właśnie potrzebuje.
 *
 * Na liście nie ma po tym żadnego śladu — ani znacznika przy podpowiedzianym
 * wierszu, ani sekcji z nagłówkiem. Ekran jest pomiędzy dniem a formularzem
 * i każdy jego element to koszt w najczęstszej czynności w aplikacji; skoro
 * odpowiedzią na „co teraz wykonać" jest **pierwszy wiersz listy**, to lista
 * w zupełności wystarczy za komunikat.
 *
 * Filtrowanie idzie po slugu, tym samym, który wylicza identyfikator ćwiczenia.
 * Dzięki temu „lawka" znajduje „Ławkę", a użytkownik nie musi trafiać w ogonki.
 *
 * ## Podpowiedź z cyklu
 *
 * Tag objęty celem aktywnego cyklu ma znak **wewnątrz** swojego chipsa —
 * w miejscu kropki koloru — a jego tło jest wypełnione od lewej w proporcji
 * zrobionej roboty: cztery serie z ośmiu zaplanowanych to połowa chipsa. Dopóki
 * coś zostało, znakiem jest gwiazdka; po dokończeniu roboty ptaszek, a chips
 * zostaje wypełniony do końca — postęp ma się domykać, a nie znikać przy
 * ostatniej serii. Osobnej sekcji z listą pozostałych pozycji tu nie ma
 * świadomie: ekran jest pomiędzy dniem a formularzem i każdy jego element to
 * koszt w najczęstszej czynności w aplikacji, a rząd tagów i tak stoi na górze.
 * Znak i wypełnienie mieszczą się w tym, co już zajmował filtr.
 *
 * To **wyłącznie podpowiedź, gdzie szukać**, a nie ręczne przypisanie serii do
 * cyklu — przypisania nie ma w ogóle, bo każda zapisana seria zalicza się sama
 * do wszystkich pasujących cykli. Cel wskazujący ćwiczenie oznacza jego tag
 * główny: „12 serii na biceps" i tak nie mówi, którym ćwiczeniem je
 * zrobić, a od tagu do ćwiczenia jest jedno naciśnięcie.
 */

import type { IsoDate, Translatable } from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Keyboard, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import {
  cycleNeeds,
  cycleSummaries,
  earliestRelevantDay,
  tagCycleProgress,
  withGoals,
} from '../cycle-progress';
import { db } from '../db/client';
import {
  allAdditionalTags,
  cycleGoalList,
  cycleList,
  daySets,
  exerciseLibrary,
  groupAdditionalTags,
  setsForCycles,
  tagLibrary,
  type LibraryRow,
} from '../db/queries';
import { formatDate, today as currentDay } from '../day-labels';
import type { ExerciseOrderStore } from '../exercise-order/state';
import { useExerciseOrder } from '../exercise-order/use-exercise-order';
import { orderLibrary } from '../exercise-rotation';
import { filterExercises } from '../exercise-search';
import { useLocalizedName } from '../language/provider';
import { Button, Chip, ChipRow, EmptyState, Field, Loading, Row, TagDot } from '../ui/primitives';

export function PickExerciseScreen({
  day,
  orderStore,
}: {
  day: IsoDate;
  /** Magazyn ustawienia kolejności; wstrzykuje go trasa, patrz `state.ts`. */
  orderStore: ExerciseOrderStore;
}) {
  // Nazwa do pokazania zależy od wyboru języka, więc powstaje przy renderowaniu
  // — patrz `language/provider.tsx`.
  const named = useLocalizedName();
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const userId = session?.user.id ?? '';

  const [query, setQuery] = useState('');
  const [tagId, setTagId] = useState<string | null>(null);

  const tags = useLiveQuery(tagLibrary(db), []);
  const library = useLiveQuery(exerciseLibrary(db, userId, { tagId }), [userId, tagId]);
  const extraTags = useLiveQuery(allAdditionalTags(db), []);
  const extraTagsByExercise = useMemo(
    () => groupAdditionalTags(extraTags.data ?? []),
    [extraTags.data],
  );

  const cycleRows = useLiveQuery(cycleList(db, userId, false), [userId]);
  const goalRows = useLiveQuery(cycleGoalList(db, userId), [userId]);
  const cycles = useMemo(
    () => withGoals(cycleRows.data ?? [], goalRows.data ?? [], day),
    [cycleRows.data, goalRows.data, day],
  );
  const from = useMemo(() => earliestRelevantDay(cycles, day), [cycles, day]);
  const sets = useLiveQuery(setsForCycles(db, userId, from), [userId, from]);

  const summaries = useMemo(() => cycleSummaries(cycles, sets.data ?? []), [cycles, sets.data]);
  const cycleProgress = useMemo(() => tagCycleProgress(summaries, day), [summaries, day]);

  // Serie samego wskazanego dnia, w kolejności zapisu — z nich bierze się
  // rozdzielność partii przy podpowiadaniu. `setsForCycles` obok sięga wstecz
  // po okresy cykli i nie zna kolejności w obrębie dnia.
  const { order } = useExerciseOrder(orderStore);
  const todaySets = useLiveQuery(daySets(db, userId, day), [userId, day]);

  const ordered = useMemo(() => {
    const rows = library.data ?? [];
    // Przy wybranym tagu kolejność zostawia zapytanie — patrz nagłówek pliku.
    if (order !== 'rotation' || tagId !== null) return rows;

    return orderLibrary(rows, {
      sets: todaySets.data ?? [],
      additional: extraTagsByExercise,
      needs: cycleNeeds(summaries, day),
      tags: tags.data ?? [],
    });
  }, [order, tagId, library.data, todaySets.data, extraTagsByExercise, summaries, day, tags.data]);

  const matches = useMemo(() => filterExercises(ordered, query), [ordered, query]);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const pickTag = (id: string | null) => {
    Keyboard.dismiss();
    setTagId(id);
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Pick an exercise' }} />

      <View className="p-4 pb-2">
        <Field
          label="Search"
          value={query}
          onChangeText={setQuery}
          placeholder="exercise name or tag"
          autoCapitalize="none"
          autoCorrect={false}
        />
      </View>

      <ScrollView contentContainerClassName="gap-2 px-4 pb-8" keyboardShouldPersistTaps="handled">
        <ChipRow wrap>
          <Chip label="All" selected={tagId === null} onPress={() => pickTag(null)} />
          {(tags.data ?? []).map((tag) => (
            <Chip
              key={tag.id}
              label={named(tag)}
              color={tag.color}
              progress={cycleProgress.get(tag.id)}
              selected={tagId === tag.id}
              onPress={() => pickTag(tagId === tag.id ? null : tag.id)}
            />
          ))}
        </ChipRow>

        {matches.length === 0 ? (
          <View className="gap-4">
            <EmptyState
              title="No such exercise"
              hint="Try a shorter phrase, or add it to the library — that works offline too."
            />
            <Button
              label="Add exercise"
              onPress={() =>
                router.push(
                  tagId === null
                    ? `/library/new?day=${day}`
                    : `/library/new?day=${day}&tagId=${tagId}`,
                )
              }
            />
          </View>
        ) : (
          matches.map((exercise) => {
            const extra = extraTagsByExercise.get(exercise.id) ?? [];
            return (
              <Row
                key={exercise.id}
                onPress={() => router.replace(`/day/${day}/log/${exercise.id}`)}
              >
                <TagDot color={exercise.tagColor} />
                <View className="flex-1">
                  <Text className="text-base text-text">{named(exercise)}</Text>
                  <Text className="text-xs text-muted">{describeUsage(exercise, named)}</Text>
                  {/* Filtr po tagu obejmuje też tagi dodatkowe (patrz
                      `exerciseLibrary`), więc np. dipy wyskakują pod „Triceps",
                      choć ich tagiem głównym — tym, co liczy się do cyklu —
                      jest „Chest". Bez tej linii nie było widać, dlaczego wiersz
                      w ogóle trafił na przefiltrowaną listę. */}
                  {extra.length > 0 && (
                    <Text className="text-xs text-muted">
                      Also: {extra.map((tag) => named(tag)).join(', ')}
                    </Text>
                  )}
                </View>
              </Row>
            );
          })
        )}

        {matches.length > 0 && (
          <Button
            variant="secondary"
            label="New exercise"
            onPress={() =>
              router.push(
                tagId === null
                  ? `/library/new?day=${day}`
                  : `/library/new?day=${day}&tagId=${tagId}`,
              )
            }
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function describeUsage(exercise: LibraryRow, named: (entity: Translatable) => string): string {
  const gym = exercise.gym === null ? '' : ` · ${exercise.gym}`;
  const tag = named({ name: exercise.tagName, translations: exercise.tagTranslations });
  if (exercise.setCount === 0) return `${tag}${gym}`;
  const last = exercise.lastPerformedOn;
  const when = last === null ? '' : ` · last ${formatDate(last, currentDay())}`;
  const sets = exercise.setCount === 1 ? 'set' : 'sets';
  return `${tag} · ${String(exercise.setCount)} ${sets}${when}${gym}`;
}
