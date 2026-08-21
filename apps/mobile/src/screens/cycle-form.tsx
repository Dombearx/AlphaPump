/**
 * Definiowanie i edycja cyklu.
 *
 * Cykl to nazwa, zakres dat i **co najmniej jedna** pozycja celu. Pozycje
 * dodaje się pojedynczo, bo każda ma inny kształt: metrykę (serie, czas,
 * dystans), zakres (ćwiczenie albo tag) i wartość w jednostce wynikającej
 * z metryki. Formularz, który próbowałby pokazać to wszystko naraz dla kilku
 * pozycji, byłby nie do obsłużenia jedną ręką.
 *
 * Daty wpisuje się jako `YYYY-MM-DD`, z przyciskami skrótu na najczęstsze
 * przypadki. Natywny wybierak dat wygląda inaczej na każdej platformie
 * i wymagałby kolejnej zależności — przy dwóch polach w całej aplikacji nie
 * zarabia na siebie.
 */

import {
  addDays,
  differenceInDays,
  isIsoDate,
  type CycleGoalInput,
  type GoalMetric,
  type IsoDate,
} from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { createCycle, updateCycle } from '../db/cycles';
import { cycleGoalList, cycleList, exerciseLibrary, tagLibrary } from '../db/queries';
import { today as currentDay } from '../day-labels';
import { filterExercises } from '../exercise-search';
import { useLocalAuthor } from '../hooks';
import {
  GOAL_METRIC_LABELS,
  formatMetric,
  metricPlaceholder,
  metricUnit,
  parseMetricTarget,
} from '../measurements';
import { useRequestSync } from '../sync/provider';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  Field,
  IconButton,
  Loading,
  Row,
  SectionTitle,
  TagDot,
} from '../ui/primitives';

const METRICS: GoalMetric[] = ['sets', 'duration', 'distance'];

/** Pozycja celu w formularzu — wejście dla bazy plus nazwa do pokazania. */
interface GoalDraft extends CycleGoalInput {
  label: string;
  color: string | null;
}

export type CycleFormMode = { kind: 'create' } | { kind: 'edit'; id: string };

export function CycleFormScreen({ mode }: { mode: CycleFormMode }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const requestSync = useRequestSync();
  const today = currentDay();
  const userId = author?.userId ?? '';

  const tags = useLiveQuery(tagLibrary(db), []);
  const library = useLiveQuery(exerciseLibrary(db, userId), [userId]);
  const active = useLiveQuery(cycleList(db, userId, false), [userId]);
  const archived = useLiveQuery(cycleList(db, userId, true), [userId]);
  const goalRows = useLiveQuery(cycleGoalList(db, userId), [userId]);

  const scrollRef = useRef<ScrollView>(null);
  const scrollToEnd = () => scrollRef.current?.scrollToEnd({ animated: true });

  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState<string>(today);
  const [durationDays, setDurationDays] = useState<string>('30');
  const [openEnded, setOpenEnded] = useState(false);
  const [goals, setGoals] = useState<GoalDraft[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(mode.kind === 'create');

  const edited = useMemo(
    () =>
      mode.kind === 'edit'
        ? [...(active.data ?? []), ...(archived.data ?? [])].find((row) => row.id === mode.id)
        : undefined,
    [mode, active.data, archived.data],
  );

  // Stan edytowanego cyklu wchodzi do formularza raz — przerysowanie zapytania
  // po pullu nie może zabrać użytkownikowi tego, co właśnie wpisał.
  useEffect(() => {
    if (mode.kind !== 'edit' || loaded || edited === undefined) return;

    setName(edited.name);
    setStartsOn(edited.startsOn);
    setOpenEnded(edited.endsOn === null);
    if (edited.endsOn !== null) {
      setDurationDays(String(differenceInDays(edited.startsOn, edited.endsOn) + 1));
    }
    setGoals(
      (goalRows.data ?? [])
        .filter((goal) => goal.cycleId === edited.id)
        .map((goal) => ({
          metric: goal.metric,
          target: goal.target,
          exerciseId: goal.exerciseId,
          tagId: goal.tagId,
          label: goal.exerciseName ?? goal.tagName ?? 'Goal item',
          color: goal.tagColor,
        })),
    );
    setLoaded(true);
  }, [mode, loaded, edited, goalRows.data]);

  if (author === null || !loaded) return <Loading />;

  const duration = Number.parseInt(durationDays, 10);
  const validDuration = Number.isInteger(duration) && duration >= 1;
  const endsOn = validDuration && isIsoDate(startsOn) ? addDays(startsOn, duration - 1) : null;
  const range = { startsOn, endsOn: openEnded ? null : endsOn };

  const save = () => {
    setProblem(null);

    if (!isIsoDate(startsOn)) {
      setProblem('Start must be in the form YYYY-MM-DD.');
      return;
    }
    if (!openEnded && !validDuration) {
      setProblem('Duration must be a number of days greater than zero.');
      return;
    }
    if (goals.length === 0) {
      setProblem('A cycle with no goal items has nothing to track — add at least one.');
      return;
    }

    setBusy(true);
    void (async () => {
      try {
        const values = {
          name,
          startsOn: startsOn as IsoDate,
          endsOn: (openEnded ? null : endsOn) as IsoDate | null,
          goals: goals.map(({ label: _label, color: _color, ...goal }) => goal),
        };

        if (mode.kind === 'create') {
          const id = await createCycle(db, { ...author, ...values });
          requestSync();
          router.replace(`/cycles/${id}`);
        } else {
          await updateCycle(db, { ...author, cycleId: mode.id, ...values });
          requestSync();
          router.back();
        }
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Failed to save the cycle');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: mode.kind === 'create' ? 'New cycle' : 'Edit cycle' }} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerClassName="gap-4 p-4 pb-32"
          keyboardShouldPersistTaps="handled"
        >
          <Field
            label="Name"
            value={name}
            onChangeText={setName}
            placeholder="e.g. August biceps push"
            autoFocus={mode.kind === 'create'}
          />

          <Card className="gap-3">
            <View className="flex-row gap-3">
              <Field
                grow
                label="Start"
                value={startsOn}
                onChangeText={setStartsOn}
                placeholder="YYYY-MM-DD"
                autoCapitalize="none"
              />
              {!openEnded && (
                <Field
                  grow
                  label="Days"
                  value={durationDays}
                  onChangeText={setDurationDays}
                  placeholder="30"
                  keyboardType="number-pad"
                  unit="days"
                />
              )}
            </View>

            <ChipRow wrap>
              <Chip
                label="From today"
                onPress={() => {
                  Keyboard.dismiss();
                  setStartsOn(today);
                }}
              />
              <Chip
                label="One week"
                selected={!openEnded && duration === 7}
                onPress={() => {
                  Keyboard.dismiss();
                  setOpenEnded(false);
                  setDurationDays('7');
                }}
              />
              <Chip
                label="Two weeks"
                selected={!openEnded && duration === 14}
                onPress={() => {
                  Keyboard.dismiss();
                  setOpenEnded(false);
                  setDurationDays('14');
                }}
              />
              <Chip
                label="30 days"
                selected={!openEnded && duration === 30}
                onPress={() => {
                  Keyboard.dismiss();
                  setOpenEnded(false);
                  setDurationDays('30');
                }}
              />
              <Chip
                label="No end"
                selected={openEnded}
                onPress={() => {
                  Keyboard.dismiss();
                  setOpenEnded(!openEnded);
                }}
              />
            </ChipRow>

            {openEnded && (
              <Text className="text-xs text-muted">
                An open-ended cycle runs until you archive it. There are no previous periods then —
                they can't be worked out without a cycle length.
              </Text>
            )}
          </Card>

          <View className="gap-2">
            <SectionTitle>Goal items</SectionTitle>

            {goals.length === 0 ? (
              <Text className="text-muted">
                For example: 12 biceps sets, 6 pull-up sets, 10 km of running.
              </Text>
            ) : (
              goals.map((goal, index) => (
                <Row key={`${goal.label}-${String(index)}`}>
                  {goal.color !== null && <TagDot color={goal.color} />}
                  <View className="flex-1">
                    <Text className="text-text">{goal.label}</Text>
                    <Text className="text-xs text-muted">
                      {GOAL_METRIC_LABELS[goal.metric]} · {formatMetric(goal.metric, goal.target)}
                    </Text>
                  </View>
                  <IconButton
                    label="Remove item"
                    glyph="×"
                    onPress={() =>
                      setGoals((current) => current.filter((_, position) => position !== index))
                    }
                  />
                </Row>
              ))
            )}
          </View>

          <GoalComposer
            tags={tags.data ?? []}
            exercises={library.data ?? []}
            onAdd={(goal) => setGoals((current) => [...current, goal])}
            onFocusTarget={scrollToEnd}
          />

          {problem !== null && <Text className="text-danger">{problem}</Text>}

          <Button
            label={mode.kind === 'create' ? 'Save cycle' : 'Save changes'}
            busy={busy}
            disabled={name.trim().length === 0}
            onPress={save}
          />

          <Text className="text-xs text-muted">
            Range: {range.startsOn} – {range.endsOn ?? 'no end'}. Sets count toward every matching
            cycle automatically — there's nowhere to assign them.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

/**
 * Dodawanie jednej pozycji celu.
 *
 * Zakres jest **albo** ćwiczeniem, **albo** tagiem — nigdy jednym i drugim. Ten
 * warunek pilnuje schemat, baza i serwer; tutaj po prostu nie da się wybrać
 * obu naraz, bo wybór jednego czyści drugi.
 */
function GoalComposer({
  tags,
  exercises,
  onAdd,
  onFocusTarget,
}: {
  tags: { id: string; name: string; color: string }[];
  exercises: { id: string; name: string; tagName: string; tagColor: string }[];
  onAdd: (goal: GoalDraft) => void;
  /** Klawiatura zasłania przyciski pod polem „Cel" — przewiń je w widok przy fokusie. */
  onFocusTarget: () => void;
}) {
  const [metric, setMetric] = useState<GoalMetric>('sets');
  const [scope, setScope] = useState<'tag' | 'exercise'>('tag');
  const [tagId, setTagId] = useState<string | null>(null);
  const [exerciseId, setExerciseId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [target, setTarget] = useState('');

  const matches = useMemo(() => filterExercises(exercises, query).slice(0, 6), [exercises, query]);

  const add = () => {
    const value = parseMetricTarget(metric, target);
    if (value === null) return;

    if (scope === 'tag') {
      const tag = tags.find((candidate) => candidate.id === tagId);
      if (tag === undefined) return;
      onAdd({
        metric,
        target: value,
        exerciseId: null,
        tagId: tag.id,
        label: tag.name,
        color: tag.color,
      });
    } else {
      const exercise = exercises.find((candidate) => candidate.id === exerciseId);
      if (exercise === undefined) return;
      onAdd({
        metric,
        target: value,
        exerciseId: exercise.id,
        tagId: null,
        label: exercise.name,
        color: exercise.tagColor,
      });
    }

    setTarget('');
    setQuery('');
    setTagId(null);
    setExerciseId(null);
  };

  const ready =
    parseMetricTarget(metric, target) !== null &&
    (scope === 'tag' ? tagId !== null : exerciseId !== null);

  return (
    <Card className="gap-3">
      <SectionTitle>Add item</SectionTitle>

      <ChipRow>
        {METRICS.map((option) => (
          <Chip
            key={option}
            label={GOAL_METRIC_LABELS[option]}
            selected={metric === option}
            onPress={() => setMetric(option)}
          />
        ))}
      </ChipRow>

      <ChipRow>
        <Chip
          label="Tag"
          selected={scope === 'tag'}
          onPress={() => {
            setScope('tag');
            setExerciseId(null);
          }}
        />
        <Chip
          label="Exercise"
          selected={scope === 'exercise'}
          onPress={() => {
            setScope('exercise');
            setTagId(null);
          }}
        />
      </ChipRow>

      {scope === 'tag' ? (
        <ChipRow wrap>
          {tags.map((tag) => (
            <Chip
              key={tag.id}
              label={tag.name}
              color={tag.color}
              selected={tagId === tag.id}
              onPress={() => setTagId(tag.id)}
            />
          ))}
        </ChipRow>
      ) : (
        <View className="gap-2">
          <Field
            label="Exercise"
            value={query}
            onChangeText={setQuery}
            placeholder="search the library"
            autoCapitalize="none"
          />
          {matches.map((exercise) => (
            <Row
              key={exercise.id}
              selected={exerciseId === exercise.id}
              onPress={() => setExerciseId(exercise.id)}
            >
              <TagDot color={exercise.tagColor} />
              <Text className="flex-1 text-text">{exercise.name}</Text>
            </Row>
          ))}
        </View>
      )}

      <Field
        label="Target"
        value={target}
        onChangeText={setTarget}
        unit={metricUnit(metric)}
        placeholder={metricPlaceholder(metric)}
        keyboardType={metric === 'duration' ? 'numbers-and-punctuation' : 'numeric'}
        onFocus={onFocusTarget}
      />

      <Button variant="secondary" label="Add item" disabled={!ready} onPress={add} />

      {scope === 'tag' && (
        <Text className="text-xs text-muted">
          A tag goal only counts an exercise's primary tag. Additional tags are labels for browsing
          the library and don't count sets.
        </Text>
      )}
    </Card>
  );
}
