/**
 * Zapisywanie serii jednego ćwiczenia w jednym dniu.
 *
 * Ekran jest zbudowany wokół jednego wymagania: **możliwie najmniejsza liczba
 * kroków do zapisania serii.** Formularz jest już wypełniony podpowiedzią, więc
 * najkrótsza droga to jedno naciśnięcie „Dodaj serię". Reszta ekranu — lista
 * serii dnia, rekordy, zmiana kolejności — jest dookoła tego przycisku.
 *
 * Wejście w istniejącą serię robi obie rzeczy naraz, tak jak w FitNotes: jej
 * wartości lądują w formularzu, a użytkownik decyduje, czy zapisać zmianę
 * („Zapisz zmiany"), czy potraktować ją jako punkt startowy następnej
 * („Dodaj jako nową"). Dwa osobne tryby wymagałyby wybrania trybu, zanim wiadomo,
 * o co chodzi.
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
import { useMemo, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import { exerciseDetails, exerciseHistory } from '../db/queries';
import { createSet, deleteSet, moveSet, updateSet, type SetAuthor } from '../db/sets';
import { useDeviceId } from '../hooks';
import { fieldsFor, formatSet, keyboardFor, type MeasurementField } from '../measurements';
import { draftOf, readDraft, suggestedDraft, type SetDraft } from '../set-draft';
import { useRequestSync } from '../sync/provider';
import {
  Button,
  Card,
  EmptyState,
  Field,
  IconButton,
  Loading,
  Row,
  SectionTitle,
} from '../ui/primitives';

/** Ile rekordów pokazujemy — front Pareto bywa długi, a ekran ma być spokojny. */
const RECORDS_SHOWN = 4;

const RECORD_MESSAGE: Partial<Record<RecordOutcome, string>> = {
  new: 'Nowy rekord!',
  improved: 'Rekord poprawiony!',
};

const SUGGESTION_MESSAGE = {
  'same-day': 'Podpowiedź z poprzedniej serii tego dnia.',
  'previous-day': 'Podpowiedź z ostatniego dnia z tym ćwiczeniem.',
} as const;

export function LogScreen({ day, exerciseId }: { day: IsoDate; exerciseId: string }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const deviceId = useDeviceId();
  const requestSync = useRequestSync();
  const userId = session?.user.id ?? '';

  const details = useLiveQuery(exerciseDetails(db, exerciseId));
  const history = useLiveQuery(exerciseHistory(db, userId, exerciseId));

  const [draft, setDraft] = useState<SetDraft | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<RecordOutcome | null>(null);

  const exercise = details.data[0];
  const sets = useMemo(() => history.data ?? [], [history.data]);
  const daySets = useMemo(() => sets.filter((set) => set.performedOn === day), [sets, day]);

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
      <Loading label="Wczytywanie ćwiczenia…" />
    ) : (
      <MissingExercise onBack={() => router.replace(`/day/${day}`)} />
    );
  }

  const loggingType: LoggingType = exercise.loggingType;
  const current: SetDraft = draft ?? suggestion ?? { values: {}, note: '' };
  const author = deviceId === null ? null : { userId, deviceId };

  const change = (key: MeasurementField['key'], value: string) => {
    setDraft({ ...current, values: { ...current.values, [key]: value } });
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
    if (author === null) return;
    setBusy(true);

    void (async () => {
      try {
        await action(author);
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Nie udało się zapisać serii');
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
          `Uzupełnij: ${parsed.missing.map((field) => field.label.toLowerCase()).join(', ')}`,
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
    Alert.alert('Usunąć serię?', 'Wpis zniknie także z rekordów i cykli.', [
      { text: 'Anuluj', style: 'cancel' },
      {
        text: 'Usuń',
        style: 'destructive',
        onPress: () =>
          run(async (who) => {
            await deleteSet(db, setId, who);
            finish(null);
          }),
      },
    ]);
  };

  const move = (setId: string, direction: 'up' | 'down') =>
    run(async (who) => {
      await moveSet(db, setId, direction, who);
      requestSync();
    });

  const select = (set: WorkoutSetRow) => {
    setEditing(set.id);
    setOutcome(null);
    setProblem(null);
    setDraft(draftOf(loggingType, set));
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: exercise.name }} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
          <Text className="text-muted">
            {exercise.tagName} · {exercise.authorNickname}
          </Text>

          <Card className="gap-3">
            <View className="flex-row gap-3">
              {fieldsFor(loggingType).map((field) => (
                <Field
                  key={field.key}
                  label={field.label}
                  unit={field.unit}
                  value={current.values[field.key] ?? ''}
                  onChangeText={(value) => change(field.key, value)}
                  placeholder={field.placeholder}
                  keyboardType={keyboardFor(field.kind)}
                />
              ))}
            </View>

            <Field
              label="Notatka"
              value={current.note}
              onChangeText={(value) => setDraft({ ...current, note: value })}
              placeholder="opcjonalna"
            />

            {problem !== null && <Text className="text-danger">{problem}</Text>}

            {outcome !== null && RECORD_MESSAGE[outcome] !== undefined && (
              <Text className="text-lg font-semibold text-success">{RECORD_MESSAGE[outcome]}</Text>
            )}

            {editing === null && draft === null && suggestion?.reason != null && (
              <Text className="text-xs text-muted">{SUGGESTION_MESSAGE[suggestion.reason]}</Text>
            )}

            {editing === null ? (
              <Button
                label="Dodaj serię"
                busy={busy}
                disabled={author === null}
                onPress={() => save('create')}
              />
            ) : (
              <View className="gap-2">
                <View className="flex-row gap-2">
                  <Button grow label="Zapisz zmiany" busy={busy} onPress={() => save('update')} />
                  <Button
                    grow
                    variant="secondary"
                    label="Dodaj jako nową"
                    busy={busy}
                    onPress={() => save('create')}
                  />
                </View>
                <View className="flex-row gap-2">
                  <Button grow variant="danger" label="Usuń" onPress={() => remove(editing)} />
                  <Button
                    grow
                    variant="secondary"
                    label="Anuluj"
                    onPress={() => {
                      setEditing(null);
                      setDraft(null);
                    }}
                  />
                </View>
              </View>
            )}
          </Card>

          <View className="gap-2">
            <SectionTitle>Serie tego dnia</SectionTitle>
            {daySets.length === 0 ? (
              <Text className="text-muted">Jeszcze żadnej — pierwsza pójdzie na górę listy.</Text>
            ) : (
              daySets.map((set, index) => (
                <Row key={set.id} selected={set.id === editing} onPress={() => select(set)}>
                  <Text className="w-6 text-right text-muted">{index + 1}.</Text>
                  <View className="flex-1">
                    <Text className="text-base text-text">{formatSet(loggingType, set)}</Text>
                    {set.note !== null && set.note.length > 0 && (
                      <Text className="text-xs text-muted">{set.note}</Text>
                    )}
                  </View>
                  <IconButton
                    label="Wyżej"
                    glyph="↑"
                    disabled={index === 0}
                    onPress={() => move(set.id, 'up')}
                  />
                  <IconButton
                    label="Niżej"
                    glyph="↓"
                    disabled={index === daySets.length - 1}
                    onPress={() => move(set.id, 'down')}
                  />
                </Row>
              ))
            )}
          </View>

          <View className="gap-2">
            <SectionTitle>Rekordy</SectionTitle>
            {records.length === 0 ? (
              <Text className="text-muted">
                Pierwsza kompletna seria od razu zostanie rekordem.
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

          <Button
            variant="secondary"
            label="Inne ćwiczenie"
            onPress={() => router.replace(`/day/${day}/pick`)}
          />
        </ScrollView>
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
        title="Nie ma już takiego ćwiczenia"
        hint="Zostało usunięte z biblioteki — wybierz inne."
      />
      <Button label="Wróć do dnia" onPress={onBack} />
    </SafeAreaView>
  );
}
