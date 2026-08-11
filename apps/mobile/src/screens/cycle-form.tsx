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
  isIsoDate,
  type CycleGoalInput,
  type GoalMetric,
  type IsoDate,
} from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
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

  const [name, setName] = useState('');
  const [startsOn, setStartsOn] = useState<string>(today);
  const [endsOn, setEndsOn] = useState<string>(addDays(today, 29));
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
    if (edited.endsOn !== null) setEndsOn(edited.endsOn);
    setGoals(
      (goalRows.data ?? [])
        .filter((goal) => goal.cycleId === edited.id)
        .map((goal) => ({
          metric: goal.metric,
          target: goal.target,
          exerciseId: goal.exerciseId,
          tagId: goal.tagId,
          label: goal.exerciseName ?? goal.tagName ?? 'Pozycja celu',
          color: goal.tagColor,
        })),
    );
    setLoaded(true);
  }, [mode, loaded, edited, goalRows.data]);

  if (author === null || !loaded) return <Loading />;

  const range = { startsOn, endsOn: openEnded ? null : endsOn };

  const save = () => {
    setProblem(null);

    if (!isIsoDate(startsOn) || (!openEnded && !isIsoDate(endsOn))) {
      setProblem('Daty muszą mieć postać RRRR-MM-DD.');
      return;
    }
    if (goals.length === 0) {
      setProblem('Cykl bez pozycji celu nie ma czego zliczać — dodaj przynajmniej jedną.');
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
        setProblem(error instanceof Error ? error.message : 'Nie udało się zapisać cyklu');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: mode.kind === 'create' ? 'Nowy cykl' : 'Edycja cyklu' }} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
          <Field
            label="Nazwa"
            value={name}
            onChangeText={setName}
            placeholder="np. Sierpień na biceps"
            autoFocus={mode.kind === 'create'}
          />

          <Card className="gap-3">
            <View className="flex-row gap-3">
              <Field
                label="Początek"
                value={startsOn}
                onChangeText={setStartsOn}
                placeholder="RRRR-MM-DD"
                autoCapitalize="none"
              />
              {!openEnded && (
                <Field
                  label="Koniec"
                  value={endsOn}
                  onChangeText={setEndsOn}
                  placeholder="RRRR-MM-DD"
                  autoCapitalize="none"
                />
              )}
            </View>

            <ChipRow>
              <Chip label="Od dziś" onPress={() => setStartsOn(today)} />
              <Chip
                label="Tydzień"
                selected={!openEnded && endsOn === addDays(startsOn, 6)}
                onPress={() => {
                  setOpenEnded(false);
                  setEndsOn(addDays(startsOn, 6));
                }}
              />
              <Chip
                label="30 dni"
                selected={!openEnded && endsOn === addDays(startsOn, 29)}
                onPress={() => {
                  setOpenEnded(false);
                  setEndsOn(addDays(startsOn, 29));
                }}
              />
              <Chip
                label="Bez końca"
                selected={openEnded}
                onPress={() => setOpenEnded(!openEnded)}
              />
            </ChipRow>

            {openEnded && (
              <Text className="text-xs text-muted">
                Cykl bez końca trwa, dopóki go nie zarchiwizujesz. Nie ma wtedy poprzednich okresów
                — nie da się ich wyznaczyć bez długości cyklu.
              </Text>
            )}
          </Card>

          <View className="gap-2">
            <SectionTitle>Pozycje celu</SectionTitle>

            {goals.length === 0 ? (
              <Text className="text-muted">
                Na przykład: 12 serii na biceps, 6 serii podciągnięć, 10 km biegu.
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
                    label="Usuń pozycję"
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
          />

          {problem !== null && <Text className="text-danger">{problem}</Text>}

          <Button
            label={mode.kind === 'create' ? 'Zapisz cykl' : 'Zapisz zmiany'}
            busy={busy}
            disabled={name.trim().length === 0}
            onPress={save}
          />

          <Text className="text-xs text-muted">
            Zakres: {range.startsOn} – {range.endsOn ?? 'bez końca'}. Serie zaliczają się do
            wszystkich pasujących cykli automatycznie — nie trzeba ich nigdzie przypisywać.
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
}: {
  tags: { id: string; name: string; color: string }[];
  exercises: { id: string; name: string; tagName: string; tagColor: string }[];
  onAdd: (goal: GoalDraft) => void;
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
      <SectionTitle>Dodaj pozycję</SectionTitle>

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
          label="Ćwiczenie"
          selected={scope === 'exercise'}
          onPress={() => {
            setScope('exercise');
            setTagId(null);
          }}
        />
      </ChipRow>

      {scope === 'tag' ? (
        <ChipRow>
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
            label="Ćwiczenie"
            value={query}
            onChangeText={setQuery}
            placeholder="szukaj w bibliotece"
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
        label="Cel"
        value={target}
        onChangeText={setTarget}
        unit={metricUnit(metric)}
        placeholder={metricPlaceholder(metric)}
        keyboardType={metric === 'duration' ? 'numbers-and-punctuation' : 'numeric'}
      />

      <Button variant="secondary" label="Dodaj pozycję" disabled={!ready} onPress={add} />

      {scope === 'tag' && (
        <Text className="text-xs text-muted">
          Cel tagowy liczy wyłącznie tag główny ćwiczenia. Tagi dodatkowe są etykietami do
          przeglądania biblioteki i serii nie zaliczają.
        </Text>
      )}
    </Card>
  );
}
