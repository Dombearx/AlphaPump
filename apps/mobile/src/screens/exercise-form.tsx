/**
 * Dodawanie i edycja ćwiczenia.
 *
 * Jeden komponent na oba tryby, bo pola są te same, a dwa podobne formularze
 * rozjechałyby się przy pierwszej zmianie. Różnice są dwie i obie wynikają
 * z reguł domenowych: typ logowania wybiera się **tylko** przy tworzeniu (zmiana
 * unieważniłaby historyczne serie), a edytować może wyłącznie autor albo
 * administrator.
 *
 * ## Ostrzeżenie o duplikacie
 *
 * Podobne ćwiczenia pokazują się na bieżąco, w trakcie pisania nazwy, i **nie
 * blokują zapisu** — tak wymaga specyfikacja. Warstwy są dwie i różnią się
 * dostępnością, nie tylko trafnością:
 *
 * - **lokalna, zawsze** — `findSimilarExercises` z rdzenia po bibliotece
 *   z bazy lokalnej. Działa w trybie samolotowym i łapie pisownię: literówki
 *   i odmianę.
 * - **serwerowa, gdy jest łączność** — `GET /exercises/similar`: embeddingi
 *   i ocena modelu. Łapie to, czego pierwsza nie może, czyli że „martwy ciąg"
 *   i „deadlift" to to samo ćwiczenie.
 *
 * Druga warstwa jest **dodatkiem**. Telefon poza VPN-em, wyłączona warstwa
 * semantyczna i awaria dostawcy modeli dają ten sam skutek: zostaje ostrzeżenie
 * lokalne, bez komunikatu o błędzie, bo z punktu widzenia użytkownika nic się nie
 * stało. Scalenie obu warstw w jedną listę robi `mergeDuplicateHints`.
 *
 * Osobny przypadek to nazwa, której slug jest **identyczny** z istniejącym
 * ćwiczeniem tego samego autora. Wtedy zapis nie utworzy nic nowego, tylko
 * trafi w istniejący wiersz — bo z tej samej nazwy wychodzi ten sam
 * identyfikator. Mówimy o tym wprost, zamiast udawać, że powstał nowy wpis.
 */

import {
  findSimilarExercises,
  LOGGING_TYPES,
  type LoggingType,
  type IsoDate,
} from '@alphapump/core';
import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { db } from '../db/client';
import { createExercise, createTag, updateExercise } from '../db/library';
import { describeHint, mergeDuplicateHints } from '../duplicate-hint';
import { remoteReader } from '../remote/reader';
import { useServerDuplicates } from '../remote/use-duplicates';
import { additionalTagsOf, exerciseDetails, exerciseLibrary, tagLibrary } from '../db/queries';
import { useLocalAuthor } from '../hooks';
import { LOGGING_TYPE_LABELS } from '../measurements';
import { useRequestSync } from '../sync/provider';
import {
  Button,
  Card,
  Chip,
  ChipRow,
  EmptyState,
  Field,
  Loading,
  SectionTitle,
} from '../ui/primitives';

export type ExerciseFormMode = { kind: 'create'; tagId?: string } | { kind: 'edit'; id: string };

export function ExerciseFormScreen({ mode, day }: { mode: ExerciseFormMode; day?: IsoDate }) {
  const router = useRouter();
  const author = useLocalAuthor();
  const requestSync = useRequestSync();

  const tags = useLiveQuery(tagLibrary(db));
  const library = useLiveQuery(exerciseLibrary(db, author?.userId ?? ''));
  const editedId = mode.kind === 'edit' ? mode.id : '';
  const edited = useLiveQuery(exerciseDetails(db, editedId), [editedId]);
  const editedTags = useLiveQuery(additionalTagsOf(db, editedId), [editedId]);

  const [name, setName] = useState('');
  const [loggingType, setLoggingType] = useState<LoggingType>('weight_reps');
  const [primaryTagId, setPrimaryTagId] = useState<string | null>(
    mode.kind === 'create' ? (mode.tagId ?? null) : null,
  );
  const [additionalTagIds, setAdditionalTagIds] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [newTag, setNewTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(mode.kind === 'create');

  const existing = edited.data[0];

  // Wartości edytowanego ćwiczenia wchodzą do formularza **raz**. Późniejsze
  // przerysowanie zapytania (choćby po pullu) nie może zabrać użytkownikowi
  // tego, co właśnie wpisał.
  useEffect(() => {
    if (mode.kind !== 'edit' || loaded || existing === undefined) return;

    setName(existing.name);
    setLoggingType(existing.loggingType);
    setPrimaryTagId(existing.tagId);
    setAdditionalTagIds(editedTags.data.map((tag) => tag.id));
    setNote(existing.note ?? '');
    setLoaded(true);
  }, [mode.kind, loaded, existing, editedTags.data]);

  const excludeId = mode.kind === 'edit' ? mode.id : null;

  const similar = useMemo(
    () => findSimilarExercises(name, library.data ?? [], { excludeId }),
    [name, library.data, excludeId],
  );

  const remote = useServerDuplicates(remoteReader, name, excludeId);
  const hints = useMemo(() => mergeDuplicateHints(similar, remote), [similar, remote]);

  const identical = similar.find((match) => match.identical);

  if (author === null) return <Loading />;
  if (mode.kind === 'edit' && !loaded) {
    return edited.updatedAt === undefined ? (
      <Loading label="Wczytywanie ćwiczenia…" />
    ) : (
      <MissingExercise onBack={() => router.replace('/library')} />
    );
  }

  const canModify =
    mode.kind === 'create' ||
    author.role === 'admin' ||
    existing?.authorId === author.userId ||
    existing === undefined;

  const run = (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);

    void (async () => {
      try {
        await action();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Nie udało się zapisać ćwiczenia');
      } finally {
        setBusy(false);
      }
    })();
  };

  const addTag = () =>
    run(async () => {
      const saved = await createTag(db, { name: newTag, ...author });
      setNewTag('');
      // Nowy tag zwykle powstaje po to, żeby od razu go użyć.
      if (primaryTagId === null) setPrimaryTagId(saved.id);
      requestSync();
    });

  const save = () =>
    run(async () => {
      if (primaryTagId === null) {
        setProblem('Wybierz tag główny — to on decyduje o zaliczaniu serii do cykli.');
        return;
      }

      if (mode.kind === 'create') {
        const saved = await createExercise(db, {
          ...author,
          name,
          loggingType,
          primaryTagId,
          additionalTagIds,
          note: note.trim().length === 0 ? null : note.trim(),
        });

        requestSync();
        router.replace(day === undefined ? `/library/${saved.id}` : `/day/${day}/log/${saved.id}`);
        return;
      }

      await updateExercise(db, {
        ...author,
        exerciseId: mode.id,
        name,
        primaryTagId,
        additionalTagIds,
        note: note.trim().length === 0 ? null : note.trim(),
      });

      requestSync();
      router.back();
    });

  const toggleAdditional = (tagId: string) => {
    setAdditionalTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId],
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen
        options={{ title: mode.kind === 'create' ? 'Nowe ćwiczenie' : 'Edycja ćwiczenia' }}
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="gap-4 p-4 pb-10" keyboardShouldPersistTaps="handled">
          <Card className="gap-3">
            <Field
              label="Nazwa"
              value={name}
              onChangeText={setName}
              placeholder="np. Wyciskanie francuskie"
              autoFocus={mode.kind === 'create'}
            />

            {identical !== undefined && (
              <Text className="text-xs text-muted">
                Ta nazwa wskazuje na istniejące ćwiczenie „{identical.exercise.name}" — zapis trafi
                w nie, zamiast tworzyć drugie.
              </Text>
            )}

            {hints.length > 0 && identical === undefined && (
              <View className="gap-1 rounded-2xl border border-border p-3">
                <SectionTitle>Podobne już są</SectionTitle>
                {hints.map((hint) => (
                  <View key={hint.exerciseId}>
                    <Text className="text-sm text-muted">
                      • {hint.name}
                      {hint.authorNickname === null ? '' : ` (autor: ${hint.authorNickname})`}
                    </Text>
                    <Text className="ml-3 text-xs text-muted">{describeHint(hint)}</Text>
                  </View>
                ))}
                <Text className="text-xs text-muted">
                  To tylko podpowiedź — możesz zapisać mimo wszystko.
                </Text>
              </View>
            )}
          </Card>

          {mode.kind === 'create' && (
            <View className="gap-2">
              <SectionTitle>Typ logowania</SectionTitle>
              <Text className="text-xs text-muted">
                Ustawiany raz na zawsze. Zmiana wymagałaby nowego ćwiczenia, bo inaczej historyczne
                serie przestałyby do niego pasować.
              </Text>
              <ChipRow>
                {LOGGING_TYPES.map((type) => (
                  <Chip
                    key={type}
                    label={LOGGING_TYPE_LABELS[type]}
                    selected={loggingType === type}
                    onPress={() => setLoggingType(type)}
                  />
                ))}
              </ChipRow>
            </View>
          )}

          <View className="gap-2">
            <SectionTitle>Tag główny</SectionTitle>
            <Text className="text-xs text-muted">
              To on zalicza serie do celów cyklu opartych o partie mięśniowe.
            </Text>
            <ChipRow>
              {(tags.data ?? []).map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  color={tag.color}
                  selected={primaryTagId === tag.id}
                  onPress={() => {
                    setPrimaryTagId(tag.id);
                    setAdditionalTagIds((current) => current.filter((id) => id !== tag.id));
                  }}
                />
              ))}
            </ChipRow>
          </View>

          <View className="gap-2">
            <SectionTitle>Tagi dodatkowe</SectionTitle>
            <ChipRow>
              {(tags.data ?? [])
                .filter((tag) => tag.id !== primaryTagId)
                .map((tag) => (
                  <Chip
                    key={tag.id}
                    label={tag.name}
                    color={tag.color}
                    selected={additionalTagIds.includes(tag.id)}
                    onPress={() => toggleAdditional(tag.id)}
                  />
                ))}
            </ChipRow>
          </View>

          <Card className="gap-3">
            <Field
              label="Nowy tag"
              value={newTag}
              onChangeText={setNewTag}
              placeholder="np. Przedramiona"
              hint="Kolor przydziela system — jest wyliczany z nazwy, więc taki sam na każdym urządzeniu."
            />
            <Button
              variant="secondary"
              label="Dodaj tag"
              disabled={newTag.trim().length === 0}
              busy={busy}
              onPress={addTag}
            />
          </Card>

          <Field
            label="Notatka"
            value={note}
            onChangeText={setNote}
            placeholder="opcjonalna"
            multiline
          />

          {problem !== null && <Text className="text-danger">{problem}</Text>}

          {canModify ? (
            <Button
              label={mode.kind === 'create' ? 'Zapisz ćwiczenie' : 'Zapisz zmiany'}
              busy={busy}
              disabled={name.trim().length === 0}
              onPress={save}
            />
          ) : (
            <Text className="text-danger">
              Ćwiczenie może zmieniać wyłącznie jego autor albo administrator.
            </Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function MissingExercise({ onBack }: { onBack: () => void }) {
  return (
    <SafeAreaView className="flex-1 justify-center gap-4 bg-base p-6">
      <EmptyState
        title="Nie ma już takiego ćwiczenia"
        hint="Zostało usunięte z biblioteki — wybierz inne."
      />
      <Button label="Wróć do biblioteki" onPress={onBack} />
    </SafeAreaView>
  );
}
