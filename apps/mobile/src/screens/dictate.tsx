/**
 * Dyktowanie serii — jeden przycisk i jedno zdanie.
 *
 * Ekran istnieje po to, żeby zapisać serię **bez patrzenia w telefon**: między
 * seriami ręce są zajęte, a wybranie ćwiczenia z listy i wpisanie dwóch liczb to
 * kilkanaście dotknięć ekranu. Tutaj jest jedno — start nagrania — i drugie na
 * jego koniec.
 *
 * Rozpoznana seria **nie zapisuje się sama**. Ekran przechodzi do zwykłego
 * formularza serii z wypełnionymi polami, a zapis zostaje tam, gdzie był: pod
 * przyciskiem „Add set", który użytkownik naciska świadomie. Model myli się
 * w liczbie rzadko, ale seria dopisana po cichu do nie tego ćwiczenia psuje
 * rekord i wykres, a zauważa się ją tygodnie później.
 *
 * ## Dlaczego ten ekran wolno **czekać na sieć**
 *
 * Bo cała reszta aplikacji czyta z bazy lokalnej i działa offline — i to jest
 * reguła, od której są dokładnie trzy odstępstwa: rekordy globalne, rankingi
 * i to. Powód jest ten sam co tam: transkrypcji i modelu nie da się policzyć na
 * telefonie, a klucze do dostawców nie mają prawa być w binarce aplikacji.
 * Ekran mówi więc wprost, gdy serwera nie widać, zamiast udawać, że nic się nie
 * stało.
 */

import type { IsoDate, VoiceSetResponse } from '@alphapump/core';
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
import { voiceClient } from '../remote/reader';
import { recordingFrom, VoiceUnavailableError } from '../remote/voice';
import { SyncAuthError, SyncOfflineError } from '../sync/transport';
import { Button, Card, Loading, SectionTitle } from '../ui/primitives';
import { dictationParams } from '../voice-draft';
import { VOICE_MAX_SECONDS, VOICE_RECORDING_OPTIONS } from '../voice-recording';

const HINT = 'Say the exercise and the numbers, for example: “bench press eighty for eight”.';

const PROBLEM = {
  permission: 'Without microphone access there is nothing to record — allow it in the settings.',
  offline: "The server is out of reach — dictation needs it, so it won't work offline.",
  auth: 'The session expired — sign in again.',
  unavailable: 'This server has dictation switched off.',
  failed: "The recording couldn't be recognised — try again.",
} as const;

type Problem = keyof typeof PROBLEM;

export function DictateScreen({ day }: { day: IsoDate }) {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  // Preset zostaje presetem: nadpisujemy w nim wyłącznie pasmo i bitrate
  // (patrz `voice-recording.ts`), więc format pliku jest ten sam, co u Expo.
  const recorder = useAudioRecorder(VOICE_RECORDING_OPTIONS);
  const state = useAudioRecorderState(recorder);

  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [answer, setAnswer] = useState<VoiceSetResponse | null>(null);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const start = () => {
    setProblem(null);
    setAnswer(null);

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

  const stop = () => {
    setBusy(true);

    void (async () => {
      try {
        await recorder.stop();
        const uri = recorder.uri;
        if (uri === null) {
          setProblem('failed');
          return;
        }

        const response = await voiceClient.dictateSet(recordingFrom(uri));
        setAnswer(response);

        // Dopasowanie prowadzi wprost do formularza — `replace`, a nie `push`,
        // bo cofnięcie z formularza ma wrócić do dnia, a nie do mikrofonu,
        // z którego przed chwilą się wyszło. To ta sama zasada, na której stoi
        // wybór ćwiczenia z listy.
        if (response.match !== null) {
          router.replace({
            pathname: '/day/[date]/log/[exerciseId]',
            params: {
              date: day,
              exerciseId: response.match.exerciseId,
              ...dictationParams(response.match),
            },
          });
        }
      } catch (error) {
        if (error instanceof SyncOfflineError) setProblem('offline');
        else if (error instanceof SyncAuthError) setProblem('auth');
        else if (error instanceof VoiceUnavailableError) setProblem('unavailable');
        else setProblem('failed');
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Dictate a set' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
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
            busy={busy}
            variant={state.isRecording ? 'danger' : 'primary'}
            onPress={state.isRecording ? stop : start}
          />
        </Card>

        {problem !== null && (
          <Card>
            <Text className="text-danger">{PROBLEM[problem]}</Text>
          </Card>
        )}

        {/* Zostajemy na ekranie wyłącznie wtedy, gdy modelowi nie udało się
            wskazać ćwiczenia — przy dopasowaniu ekran już się przełączył.
            Transkrypcja jest tu najważniejsza: mówi, czy nie zrozumiał
            mikrofon, czy model, a bez niej „nie wiem" nie prowadzi donikąd. */}
        {answer !== null && answer.match === null && (
          <View className="gap-2">
            <SectionTitle>What I heard</SectionTitle>
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
