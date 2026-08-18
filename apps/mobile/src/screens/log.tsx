/**
 * Zapisywanie serii jednego ćwiczenia w jednym dniu.
 *
 * Ekran jest zbudowany wokół jednego wymagania: **możliwie najmniejsza liczba
 * kroków do zapisania serii.** Formularz jest już wypełniony podpowiedzią, więc
 * najkrótsza droga to jedno naciśnięcie „Dodaj serię". Reszta ekranu — lista
 * serii dnia, rekordy, zmiana kolejności — jest dookoła tego przycisku.
 *
 * Wejście w istniejącą serię wrzuca jej wartości do tego samego formularza, tak
 * jak w FitNotes — osobny tryb edycji wymagałby wybrania trybu, zanim wiadomo,
 * o co chodzi. Z edycji wychodzi się tapnięciem w tło, poza kartą formularza,
 * i wpisane zmiany wtedy przepadają; przyciski pod formularzem opisuje
 * `src/set-form.ts`.
 *
 * Informacja o rekordzie pojawia się natychmiast po zapisie i **bez sieci** —
 * liczy ją `@alphapump/core` z serii leżących w bazie lokalnej.
 */

import {
  computeRecords,
  type IsoDate,
  type LoggingType,
  type RecordOutcome,
} from '@alphapump/core';
import type { WorkoutSetRow } from '@alphapump/db/sqlite';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  View,
  type PanResponderGestureState,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import { additionalTagsOf, exerciseDetails, exerciseHistory, exerciseTagList } from '../db/queries';
import { createSet, deleteSet, moveSet, updateSet, type SetAuthor } from '../db/sets';
import { useDeviceId } from '../hooks';
import {
  fieldsFor,
  formatSet,
  keyboardFor,
  stepValue,
  type MeasurementField,
} from '../measurements';
import { draftOf, readDraft, suggestedDraft, type SetDraft } from '../set-draft';
import { setFormActions, type SetFormAction } from '../set-form';
import { useRequestSync } from '../sync/provider';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Row,
  SectionTitle,
} from '../ui/primitives';

/** Ile rekordów pokazujemy — front Pareto bywa długi, a ekran ma być spokojny. */
const RECORDS_SHOWN = 4;

/**
 * Wyłącznik funkcji: przeciąganie serii działa, ale na razie jest uznane za
 * niepotrzebne. Kod zostaje cały (łącznie z `PanResponder`, refami i stanem
 * niżej) na wypadek, gdyby ktoś jednak chciał to z powrotem włączyć — flaga
 * tylko odcina go od renderu, żeby serie na razie po prostu stały w kolejności
 * zapisu, bez uchwytu i bez możliwości zmiany.
 */
const REORDER_ENABLED: boolean = false;

/**
 * Bok przycisków +/− przy ciężarze i powtórzeniach — tyle, ile wysokości ma
 * obramowane pole `Field` (padding `py-4` plus wysokość wiersza tekstu `text-lg`).
 * Duże i kwadratowe, żeby łatwo było trafić zmęczoną, trzęsącą się ręką.
 */
const STEP_BUTTON_SIZE = 58;

const RECORD_MESSAGE: Partial<Record<RecordOutcome, string>> = {
  new: 'New record!',
  improved: 'Record improved!',
};

const SUGGESTION_MESSAGE = {
  'same-day': 'Suggested from the previous set today.',
  'previous-day': 'Suggested from the last day with this exercise.',
} as const;

export function LogScreen({ day, exerciseId }: { day: IsoDate; exerciseId: string }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const deviceId = useDeviceId();
  const requestSync = useRequestSync();
  const userId = session?.user.id ?? '';

  const details = useLiveQuery(exerciseDetails(db, exerciseId));
  const extraTags = useLiveQuery(additionalTagsOf(db, exerciseId), [exerciseId]);
  const history = useLiveQuery(exerciseHistory(db, userId, exerciseId));

  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);

  const exercise = details.data[0];
  const sets = useMemo(() => history.data ?? [], [history.data]);
  const daySets = useMemo(() => sets.filter((set) => set.performedOn === day), [sets, day]);

  /**
   * Drag-and-drop zmiany kolejności serii — na gołym `PanResponder`/`Animated`
   * z jądra React Native, celowo z pominięciem Reanimated/gesture-handler.
   * Poprzednia próba (`react-native-draggable-flatlist`, oparte na worklecie
   * Reanimated 4) kończyła się czarnym ekranem bez żadnego śladu w logu Metro —
   * a więc najpewniej awarią po stronie natywnej, której bez `adb logcat` nie da
   * się tu zdiagnozować. `PanResponder` liczy gesty na wątku JS, nie dotyka
   * wątku UI ani workletów, więc błąd — gdyby wystąpił — byłby widoczny zwykłym
   * `console.error`, zamiast cichej awarii.
   */
  const [rowHeight, setRowHeight] = useState(64);
  const [dragging, setDragging] = useState<{ id: string; from: number } | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  // `ScrollView` wyłączony na czas przeciągania — inaczej i tak potrafi
  // przechwycić gest dla siebie w trakcie, mimo `onPanResponderTerminationRequest`.
  const [dragScrollLocked, setDragScrollLocked] = useState(false);
  const dragY = useRef(new Animated.Value(0)).current;
  const dragScale = useRef(new Animated.Value(1)).current;
  const rowGap = 8; // musi się zgadzać z `gap-2` na liście serii poniżej

  /**
   * Świeże wartości do wnętrza `PanResponder`ów bez ich przebudowy — patrz
   * komentarz przy `getPanResponder` niżej, dlaczego przebudowa w trakcie
   * gestu jest tym, co faktycznie psuło przeciąganie.
   */
  const rowIndexRef = useRef(new Map<string, number>());
  const rowHeightRef = useRef(rowHeight);
  const daySetsLengthRef = useRef(daySets.length);
  const dropIndexRef = useRef<number | null>(null);
  const panResponders = useRef(new Map<string, ReturnType<typeof PanResponder.create>>());

  rowIndexRef.current = new Map(daySets.map((set, index) => [set.id, index]));
  rowHeightRef.current = rowHeight;
  daySetsLengthRef.current = daySets.length;

  const suggestion = useMemo(
    () => (exercise === undefined ? null : suggestedDraft(exercise.loggingType, sets, day)),
    [exercise, sets, day],
  );

  const records = useMemo(
    () => (exercise === undefined ? [] : computeRecords(exercise.loggingType, sets)),
    [exercise, sets],
  );

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;
  if (exercise === undefined) {
    // `updatedAt` jest puste do pierwszego wykonania zapytania — dopiero potem
    // brak wiersza znaczy „nie ma takiego ćwiczenia", a nie „jeszcze się czyta".
    return details.updatedAt === undefined ? (
      <Loading label="Loading exercise…" />
    ) : (
      <MissingExercise onBack={() => router.replace(`/day/${day}`)} />
    );
  }

  const loggingType: LoggingType = exercise.loggingType;
  const tagList = exerciseTagList(
    { id: exercise.tagId, name: exercise.tagName, color: exercise.tagColor },
    extraTags.data,
  );
  const current: SetDraft = draft ?? suggestion ?? { values: {}, note: '' };
  const author = deviceId === null ? null : { userId, deviceId };

  const change = (key: MeasurementField['key'], value: string) => {
    setDraft({ ...current, values: { ...current.values, [key]: value } });
  };

  const step = (field: MeasurementField, direction: 1 | -1) => {
    if (field.kind !== 'weight' && field.kind !== 'reps') return;
    change(field.key, stepValue(field.kind, current.values[field.key] ?? '', direction));
  };

  /** Po każdej udanej zmianie formularz wraca do podpowiedzi, a nie do pustki. */
  const finish = (record: RecordOutcome | null) => {
    setDraft(null);
    setEditing(null);
    setProblem(null);
    setOutcome(record);
    requestSync();
  };

  /**
   * Zapis nie może ruszyć bez identyfikatora urządzenia — to on rozstrzyga
   * remisy przy synchronizacji. Warunek jest tu, a nie w każdej akcji z osobna.
   */
  const run = (action: (author: SetAuthor) => Promise<void>) => {
    // Bez tej straży dwa nakładające się wywołania próbowałyby otworzyć dwie
    // transakcje naraz na tym samym połączeniu SQLite — stąd „failed to run
    // the query BEGIN" przy szarpanym geście (kilka szybkich prób z rzędu).
    if (author === null || busy) return;
    setBusy(true);

    void (async () => {
      try {
        await action(author);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Failed to save the set');
      } finally {
        setBusy(false);
      }
    })();
  };

  const save = (mode: 'create' | 'update') =>
    run(async (who) => {
      const parsed = readDraft(loggingType, current);
      if (!parsed.ok) {
        setProblem(
          `Fill in: ${parsed.missing.map((field) => field.label.toLowerCase()).join(', ')}`,
        );
        return;
      }

      const saved =
        mode === 'update' && editing !== null
          ? await updateSet(db, { setId: editing, values: parsed.values, ...who })
          : await createSet(db, {
              exerciseId,
              performedOn: day,
              values: parsed.values,
              ...who,
            });

      finish(saved.record.outcome);
    });

  const remove = (setId: string) => {
    Alert.alert('Delete this set?', 'It will also disappear from records and cycles.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () =>
          run(async (who) => {
            await deleteSet(db, setId, who);
            finish(null);
          }),
      },
    ]);
  };

  /**
   * `moveSet` przesuwa o jedno miejsce naraz i sam przenumerowuje resztę —
   * przeciągnięcie o kilka pozycji to po prostu kilka takich kroków pod rząd
   * na tym samym id.
   */
  const commitReorder = (setId: string, from: number, to: number) => {
    if (from === to) return;
    const direction: 'up' | 'down' = to < from ? 'up' : 'down';
    const steps = Math.abs(to - from);

    run(async (who) => {
      for (let step = 0; step < steps; step += 1) {
        await moveSet(db, setId, direction, who);
      }
      requestSync();
    });
  };

  const releaseDrag = () => {
    Animated.parallel([
      Animated.timing(dragY, { toValue: 0, duration: 150, useNativeDriver: false }),
      Animated.spring(dragScale, { toValue: 1, useNativeDriver: false }),
    ]).start();
    setDragging(null);
    setDropIndex(null);
    dropIndexRef.current = null;
  };

  /**
   * Jeden `PanResponder` na serię, utworzony **raz** i trzymany w `useRef`.
   *
   * To jest poprawka błędu, nie tylko cache dla wydajności: wcześniej
   * `PanResponder.create(...)` wołało się na nowo przy **każdym** renderze
   * (a `setDropIndex` w trakcie przeciągania wywołuje render za każdym razem,
   * gdy palec przekroczy granicę kolejnego wiersza). Podmiana `panHandlers`
   * na widoku, który w danej chwili **jest** aktywnym responderem, zrywała
   * gest w połowie — widać to było jako serię „spadającą" z powrotem na
   * miejsce dokładnie przy przekraczaniu progu wysokości sąsiedniego wiersza.
   * Wewnątrz responder nie zamyka się nad `index`/`rowHeight`/`dropIndex`
   * z chwili utworzenia (byłyby przestarzałe), tylko czyta je z refów, które
   * odświeżamy przy każdym renderze bez dotykania samego respondera.
   */
  const getPanResponder = (setId: string) => {
    const existing = panResponders.current.get(setId);
    if (existing) return existing;

    const responder = PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        const index = rowIndexRef.current.get(setId) ?? 0;
        dragY.setValue(0);
        setDragging({ id: setId, from: index });
        setDropIndex(index);
        dropIndexRef.current = index;
        setDragScrollLocked(true);
        Animated.spring(dragScale, { toValue: 1.04, useNativeDriver: false }).start();
      },
      onPanResponderMove: (_event, gesture: PanResponderGestureState) => {
        dragY.setValue(gesture.dy);
        const index = rowIndexRef.current.get(setId) ?? 0;
        const rowStep = rowHeightRef.current + rowGap;
        const target = Math.max(
          0,
          Math.min(daySetsLengthRef.current - 1, index + Math.round(gesture.dy / rowStep)),
        );
        dropIndexRef.current = target;
        setDropIndex(target);
      },
      onPanResponderRelease: () => {
        setDragScrollLocked(false);
        const index = rowIndexRef.current.get(setId) ?? 0;
        if (dropIndexRef.current !== null) commitReorder(setId, index, dropIndexRef.current);
        releaseDrag();
      },
      onPanResponderTerminate: () => {
        setDragScrollLocked(false);
        releaseDrag();
      },
    });

    panResponders.current.set(setId, responder);
    return responder;
  };

  const select = (set: WorkoutSetRow) => {
    setEditing(set.id);
    setOutcome(null);
    setProblem(null);
    setDraft(draftOf(loggingType, set));
  };

  const cancel = () => {
    setEditing(null);
    setDraft(null);
  };

  const renderAction = (action: SetFormAction) => {
    switch (action) {
      case 'create':
        return (
          <Button
            key={action}
            grow
            label="Add set"
            busy={busy}
            disabled={author === null}
            onPress={() => save('create')}
          />
        );
      case 'update':
        return (
          <Button
            key={action}
            grow
            label="Save changes"
            busy={busy}
            onPress={() => save('update')}
          />
        );
      case 'delete':
        return (
          <Button
            key={action}
            grow
            variant="danger"
            label="Delete"
            onPress={() => {
              if (editing !== null) remove(editing);
            }}
          />
        );
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen
        options={{
          title: exercise.name,
          headerRight: () => (
            <Pressable
              accessibilityRole="button"
              className="px-2 py-1 active:opacity-70"
              onPress={() => router.push(`/library/${exerciseId}`)}
            >
              <Text className="text-accent">Records</Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {/* Tapnięcie poza kartą edycji, listą i przyciskami anuluje edycję —
            `Pressable` łapie tylko dotknięcia, których nie skonsumował żaden
            zagnieżdżony `Row`/`Button`/`Field`, więc to naprawdę „tło". */}
        <Pressable
          className="flex-1"
          disabled={editing === null}
          onPress={cancel}
          accessibilityElementsHidden={false}
        >
          <ScrollView
            contentContainerClassName="gap-4 p-4"
            keyboardShouldPersistTaps="handled"
            scrollEnabled={!dragScrollLocked}
          >
            {/* Tagi ćwiczenia — te same chipsy co w bibliotece, tylko bez
                `onPress`: tutaj mówią wyłącznie, czego ćwiczenie dotyczy, i nie
                mają dokąd prowadzić w środku zapisywania serii. Tag główny stoi
                pierwszy i jest wyróżniony, bo jako jedyny liczy się do celów
                cyklu. Jego nazwa zniknęła z linijki niżej, żeby nie stać na
                ekranie dwa razy. */}
            <View className="gap-2">
              <ChipRow wrap>
                {tagList.map((tag) => (
                  <Chip key={tag.id} label={tag.name} color={tag.color} selected={tag.primary} />
                ))}
              </ChipRow>

              <Text className="text-muted">
                {exercise.authorNickname}
                {exercise.gym === null ? '' : ` · ${exercise.gym}`}
              </Text>
            </View>

            {/* Karta formularza łyka tapnięcia, których nie wziął żaden `Field`
                ani `Button` — inaczej trafienie w jej margines albo w odstęp
                między polami spłynęłoby do tła i odrzuciło edycję razem
                z wpisanymi zmianami. Odpowiedź w fazie bąbelkowania, więc pola
                i przyciski w środku pytane są pierwsze i nadal dostają swój
                dotyk, a przewijanie przechodzi do `ScrollView` przy ruchu. */}
            <View onStartShouldSetResponder={() => true}>
              <Card className="gap-3">
                <View className="gap-3">
                  {fieldsFor(loggingType).map((field) => {
                    const steppable = field.kind === 'weight' || field.kind === 'reps';

                    return (
                      <View key={field.key} className="flex-row items-end gap-2">
                        {steppable && (
                          <IconButton
                            size={STEP_BUTTON_SIZE}
                            label={`${field.label} minus one`}
                            glyph="−"
                            onPress={() => step(field, -1)}
                          />
                        )}
                        <Field
                          grow
                          label={field.label}
                          unit={field.unit}
                          value={current.values[field.key] ?? ''}
                          onChangeText={(value) => change(field.key, value)}
                          placeholder={field.placeholder}
                          keyboardType={keyboardFor(field.kind)}
                        />
                        {steppable && (
                          <IconButton
                            size={STEP_BUTTON_SIZE}
                            label={`${field.label} plus one`}
                            glyph="+"
                            onPress={() => step(field, 1)}
                          />
                        )}
                      </View>
                    );
                  })}
                </View>

                <Field
                  label="Note"
                  value={current.note}
                  onChangeText={(value) => setDraft({ ...current, note: value })}
                  placeholder="optional"
                />

                {problem !== null && <Text className="text-danger">{problem}</Text>}

                {outcome !== null && RECORD_MESSAGE[outcome] !== undefined && (
                  <Text className="text-lg font-semibold text-success">
                    {RECORD_MESSAGE[outcome]}
                  </Text>
                )}

                {editing === null && draft === null && suggestion?.reason != null && (
                  <Text className="text-xs text-muted">
                    {SUGGESTION_MESSAGE[suggestion.reason]}
                  </Text>
                )}

                <View className="flex-row gap-2">{setFormActions(editing).map(renderAction)}</View>
              </Card>
            </View>

            <View className="gap-2">
              <SectionTitle>Today's sets</SectionTitle>
              {daySets.length === 0 ? (
                <Text className="text-muted">
                  None yet — the first one goes to the top of the list.
                </Text>
              ) : (
                daySets.map((set, index) => {
                  if (!REORDER_ENABLED) {
                    return (
                      <Row key={set.id} selected={set.id === editing} onPress={() => select(set)}>
                        <Text className="w-6 text-right text-muted">{index + 1}.</Text>
                        <View className="flex-1">
                          <Text className="text-base text-text">{formatSet(loggingType, set)}</Text>
                          {set.note !== null && set.note.length > 0 && (
                            <Text className="text-xs text-muted">{set.note}</Text>
                          )}
                        </View>
                      </Row>
                    );
                  }

                  const isDragging = dragging?.id === set.id;
                  const showDropLineAbove =
                    dragging !== null && dropIndex === index && dragging.from !== index;

                  return (
                    <View key={set.id}>
                      {showDropLineAbove && <View className="mb-2 h-0.5 rounded-full bg-accent" />}
                      <Animated.View
                        onLayout={
                          index === 0
                            ? (event) => setRowHeight(event.nativeEvent.layout.height)
                            : undefined
                        }
                        style={
                          isDragging
                            ? {
                                transform: [{ translateY: dragY }, { scale: dragScale }],
                                zIndex: 10,
                                elevation: 10,
                                opacity: 0.95,
                              }
                            : undefined
                        }
                      >
                        {/* Uchwyt musi być RODZEŃSTWEM `Pressable`, nie jego dzieckiem —
                            zagnieżdżony wewnątrz `Row` nigdy by nie dostał gestu: sam
                            `Pressable` przejmuje dotyk na starcie, zanim `PanResponder`
                            zdąży go rozpoznać jako przeciągnięcie przy ruchu. */}
                        <View
                          className={`flex-row items-center gap-3 rounded-2xl border px-4 py-3 ${
                            set.id === editing
                              ? 'border-accent bg-surface'
                              : 'border-border bg-surface'
                          }`}
                        >
                          <Pressable
                            accessibilityRole="button"
                            className="flex-1 flex-row items-center gap-3 active:opacity-70"
                            onPress={() => select(set)}
                          >
                            <Text className="w-6 text-right text-muted">{index + 1}.</Text>
                            <View className="flex-1">
                              <Text className="text-base text-text">
                                {formatSet(loggingType, set)}
                              </Text>
                              {set.note !== null && set.note.length > 0 && (
                                <Text className="text-xs text-muted">{set.note}</Text>
                              )}
                            </View>
                          </Pressable>
                          <View
                            {...getPanResponder(set.id).panHandlers}
                            accessibilityLabel="Drag to reorder"
                            className="h-10 w-10 items-center justify-center"
                          >
                            <Text className="text-lg text-muted">⠿</Text>
                          </View>
                        </View>
                      </Animated.View>
                    </View>
                  );
                })
              )}
            </View>

            <View className="gap-2">
              <SectionTitle>Records</SectionTitle>
              {records.length === 0 ? (
                <Text className="text-muted">
                  The first complete set will become a record right away.
                </Text>
              ) : (
                records.slice(0, RECORDS_SHOWN).map((record) => (
                  <Row key={record.id}>
                    <Text className="flex-1 text-text">{formatSet(loggingType, record)}</Text>
                    <Text className="text-xs text-muted">{record.performedOn}</Text>
                  </Row>
                ))
              )}
            </View>
          </ScrollView>
        </Pressable>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Ćwiczenie potrafi zniknąć spod ekranu — usunął je autor na innym urządzeniu,
 * a pull przywiózł tombstone. Lepszy jawny komunikat niż formularz, który
 * odmawia zapisu bez powodu.
 */
function MissingExercise({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView className="flex-1 justify-center gap-4 bg-base p-6">
      <EmptyState
        title="This exercise no longer exists"
        hint="It was removed from the library — pick another one."
      />
      <Button label="Back to the day" onPress={onBack} />
    </SafeAreaView>
  );
}
