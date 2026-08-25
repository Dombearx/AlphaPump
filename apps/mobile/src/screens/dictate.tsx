/**
 * Dyktowanie serii — dwa wejścia, jedno wyjście.
 *
 * Ekran istnieje po to, żeby zapisać serię **bez patrzenia w telefon**: między
 * seriami ręce są zajęte, a wybranie ćwiczenia z listy i wpisanie dwóch liczb to
 * kilkanaście dotknięć ekranu.
 *
 * | Wejście            | Kiedy jest lepsze                                     |
 * | ------------------ | ----------------------------------------------------- |
 * | mikrofon           | ręce zajęte, cicho, chce się powiedzieć i odłożyć      |
 * | opis z klawiatury  | głośno, nie wypada mówić albo chce się poprawić zdanie przed wysłaniem |
 *
 * Drugie wejście nie jest wariantem awaryjnym pierwszego. Klawiatura Androida ma
 * własny mikrofon — z własną transkrypcją, za którą nie płacimy — więc
 * „podyktuj klawiaturą" jest pełnoprawną drogą, dostępną także na wdrożeniu bez
 * klucza transkrypcji. Wtedy nasz mikrofon odpowiada „nie mam czym", a pole
 * tekstowe działa dalej.
 *
 * ## Co się dzieje z rozpoznaną serią
 *
 * Rozstrzyga przełącznik w ustawieniach (`src/dictation/`), a regułę liczy
 * `dictationOutcome`. Domyślnie wartości wchodzą do zwykłego formularza serii
 * i czekają na zatwierdzenie — bo seria dopisana po cichu do nie tego ćwiczenia
 * psuje rekord i wykres, a zauważa się ją tygodnie później. Kto sprawdził, że
 * model trafia, włącza zapis od razu. Seria niepełna trafia do formularza
 * zawsze: nie da się zapisać serii bez pól, których wymaga jej typ logowania.
 *
 * ## Dlaczego ten ekran wolno **czekać na sieć**
 *
 * Bo cała reszta aplikacji czyta z bazy lokalnej i działa offline — i to jest
 * reguła, od której są dokładnie trzy odstępstwa: rekordy globalne, rankingi
 * i to. Powód jest ten sam co tam: ani transkrypcji, ani modelu nie da się
 * policzyć na telefonie, a klucze do dostawców nie mają prawa być w binarce
 * aplikacji. Ekran mówi więc wprost, gdy serwera nie widać, zamiast udawać, że
 * nic się nie stało.
 */

import type { IsoDate, VoiceSetMatch, VoiceSetResponse } from '@alphapump/core';
import {
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioRecorder,
  useAudioRecorderState,
} from 'expo-audio';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useSession } from '../auth/client';
import { db } from '../db/client';
import { createSet } from '../db/sets';
import { expoDictationStore } from '../dictation/expo';
import { useDictationMode } from '../dictation/use-dictation';
import { useDeviceId } from '../hooks';
import { formatSet } from '../measurements';
import { voiceClient } from '../remote/reader';
import { recordingFrom, VoiceUnavailableError } from '../remote/voice';
import { useRequestSync } from '../sync/provider';
import { SyncAuthError, SyncOfflineError } from '../sync/transport';
import { Button, Card, Field, Loading, SectionTitle } from '../ui/primitives';
import { dictationOutcome, dictationParams } from '../voice-draft';
import { VOICE_MAX_SECONDS, VOICE_RECORDING_OPTIONS } from '../voice-recording';

const HINT =
  'Say or write the exercise and the numbers, for example: “bench press eighty for eight”.';

const PROBLEM = {
  permission: 'Without microphone access there is nothing to record — allow it in the settings.',
  offline: "The server is out of reach — dictation needs it, so it won't work offline.",
  auth: 'The session expired — sign in again.',
  noRecording:
    'Recording is off on this server — write the set below, or dictate it with the keyboard.',
  unavailable: 'This server has dictation switched off.',
  failed: "The set couldn't be recognised — try again.",
  save: "The set was recognised but couldn't be saved — pick the exercise and add it by hand.",
} as const;

type Problem = keyof typeof PROBLEM;

/** Zapisana seria, o której ekran ma jeszcze powiedzieć. */
interface Saved {
  label: string;
  record: boolean;
}

export function DictateScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();
  const deviceId = useDeviceId();
  const requestSync = useRequestSync();
  const { mode } = useDictationMode(expoDictationStore);

  // Preset zostaje presetem: nadpisujemy w nim wyłącznie pasmo i bitrate
  // (patrz `voice-recording.ts`), więc format pliku jest ten sam, co u Expo.
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder);

  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [answer, setAnswer] = useState<VoiceSetResponse | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const userId = session.user.id;

  /**
   * Zapis idzie tą samą drogą co z palca (`src/db/sets.ts`): jedna transakcja,
   * outbox i ocena rekordu bez sieci. Ekran zostaje na miejscu i pokazuje, co
   * zapisał — bo w tym trybie dyktuje się serię za serią, a odesłanie
   * użytkownika do widoku dnia po każdej z nich kosztowałoby dwa dotknięcia
   * ekranu, czyli dokładnie to, co ta funkcja miała oszczędzić.
   */
  const save = async (match: VoiceSetMatch) => {
    // Bez identyfikatora urządzenia nie zapisujemy niczego: to on rozstrzyga
    // remisy przy synchronizacji. Ten sam warunek co w formularzu serii.
    if (deviceId === null) {
      setProblem('save');
      return;
    }

    try {
      const result = await createSet(db, {
        userId,
        deviceId,
        exerciseId: match.exerciseId,
        performedOn: day,
        values: {
          weightG: match.weightG,
          reps: match.reps,
          durationS: match.durationS,
          distanceM: match.distanceM,
          bodyweightG: match.bodyweightG,
          note: match.note,
        },
      });

      setSaved({
        label: `${match.name}: ${formatSet(match.loggingType, match)}`,
        record: result.record.outcome === 'new' || result.record.outcome === 'improved',
      });
      setText('');
      requestSync();
    } catch {
      setProblem('save');
    }
  };

  /** Wspólne zakończenie obu wejść — różnią się wyłącznie tym, co wysyłają. */
  const handle = async (response: VoiceSetResponse) => {
    setAnswer(response);
    if (response.match === null) return;

    if (dictationOutcome(mode, response.match) === 'save') {
      await save(response.match);
      return;
    }

    // `replace`, a nie `push`: cofnięcie z formularza ma wrócić do dnia, a nie
    // do mikrofonu, z którego przed chwilą się wyszło. To ta sama zasada, na
    // której stoi wybór ćwiczenia z listy.
    router.replace({
      pathname: '/day/[date]/log/[exerciseId]',
      params: {
        date: day,
        exerciseId: response.match.exerciseId,
        ...dictationParams(response.match),
      },
    });
  };

  /** Jedna obsługa błędów dla obu wejść — różni je tylko znaczenie 503. */
  const failed = (error: unknown, recording: boolean) => {
    if (error instanceof SyncOfflineError) setProblem('offline');
    else if (error instanceof SyncAuthError) setProblem('auth');
    else if (error instanceof VoiceUnavailableError) {
      // 503 z `/voice/set` znaczy „serwer nie ma transkrypcji" — a to zostawia
      // klawiaturę; z `/voice/text` znaczy, że nie ma całego dyktowania.
      setProblem(recording ? 'noRecording' : 'unavailable');
    } else setProblem('failed');
  };

  const run = (send: () => Promise<VoiceSetResponse>, recording: boolean) => {
    if (busy) return;
    setBusy(true);
    setProblem(null);
    setAnswer(null);
    setSaved(null);

    void (async () => {
      try {
        await handle(await send());
      } catch (error) {
        failed(error, recording);
      } finally {
        setBusy(false);
      }
    })();
  };

  const startRecording = () => {
    setProblem(null);
    setAnswer(null);
    setSaved(null);

    void (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        setProblem('permission');
        return;
      }

      // Bez tego Android nagrywa przez tor przygotowany do odtwarzania i oddaje
      // ciszę — a cisza wraca z transkrypcji pustym napisem, czyli błędem
      // wyglądającym na cudzy.
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      recorder.record({ forDuration: VOICE_MAX_SECONDS });
    })();
  };

  const stopRecording = () => {
    run(async () => {
      await recorder.stop();
      const uri = recorder.uri;
      if (uri === null) throw new Error('Nagranie nie zostawiło pliku');
      return voiceClient.dictateSet(recordingFrom(uri));
    }, true);
  };

  const sendText = () => {
    const described = text.trim();
    if (described.length === 0) return;
    run(() => voiceClient.describeSet(described), false);
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Dictate a set' }} />

      <ScrollView contentContainerClassName="gap-4 p-4" keyboardShouldPersistTaps="handled">
        <Card className="items-center gap-3">
          <Text className="text-6xl">{state.isRecording ? '⏺️' : '🎤'}</Text>
          <Text className="text-center text-muted">
            {state.isRecording
              ? `Recording… ${String(Math.round(state.durationMillis / 1000))} s`
              : HINT}
          </Text>
          <Button
            grow
            label={state.isRecording ? 'Stop and recognise' : 'Record'}
            busy={busy && !state.isRecording}
            variant={state.isRecording ? 'danger' : 'primary'}
            onPress={state.isRecording ? stopRecording : startRecording}
          />
        </Card>

        {/* Pole tekstowe stoi pod mikrofonem, a nie obok: to druga droga do tego
            samego, a nie inne ustawienie tej samej. Własnego przycisku
            dyktowania tu nie ma i nie będzie — klawiatura ma swój, lepszy,
            bo systemowy i darmowy. */}
        <Card className="gap-3">
          <SectionTitle>Or write it</SectionTitle>
          <Field
            label="Set"
            value={text}
            onChangeText={setText}
            placeholder="bench press 82.5 for 8"
            autoCapitalize="none"
          />
          <Button
            grow
            label="Recognise"
            busy={busy && !state.isRecording}
            disabled={text.trim().length === 0}
            onPress={sendText}
          />
        </Card>

        {problem !== null && (
          <Card>
            <Text className="text-danger">{PROBLEM[problem]}</Text>
          </Card>
        )}

        {saved !== null && (
          <Card className="gap-1">
            <SectionTitle>Saved</SectionTitle>
            <Text className="text-lg text-text">{saved.label}</Text>
            {saved.record && <Text className="font-semibold text-success">New record!</Text>}
            <Text className="text-xs text-muted">Dictate the next set, or go back to the day.</Text>
            <View className="mt-2">
              <Button
                variant="secondary"
                label="Back to the day"
                onPress={() => router.replace(`/day/${day}`)}
              />
            </View>
          </Card>
        )}

        {/* Zostajemy na ekranie z odpowiedzią wyłącznie wtedy, gdy modelowi nie
            udało się wskazać ćwiczenia — przy dopasowaniu ekran albo się
            przełączył, albo pokazał zapisaną serię. Transkrypcja jest tu
            najważniejsza: mówi, czy nie zrozumiał mikrofon, czy model, a bez
            niej „nie wiem" nie prowadzi donikąd. */}
        {answer !== null && answer.match === null && (
          <View className="gap-2">
            <SectionTitle>What I understood</SectionTitle>
            <Card className="gap-2">
              <Text className="text-text">
                {answer.transcript.length === 0 ? '(silence)' : answer.transcript}
              </Text>
              {answer.reason !== null && <Text className="text-muted">{answer.reason}</Text>}
            </Card>
            <Button
              variant="secondary"
              label="Pick the exercise myself"
              onPress={() => router.replace(`/day/${day}/pick`)}
            />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}
