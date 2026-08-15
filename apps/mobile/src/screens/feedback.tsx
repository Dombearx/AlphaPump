/**
 * Zgłoszenie zwrotne.
 *
 * Celowo schowane w koncie, a nie na ekranie dnia: to jest kanał do zgłoszenia
 * problemu albo pomysłu, nie coś, po co sięga się w trakcie treningu.
 *
 * Do tekstu dokleja się automatycznie ostatnie do 30 wpisów z bufora logów
 * telefonu (`app-log.ts`) — bez pytania o zgodę za każdym razem, ale
 * **widocznie**: ekran mówi wprost, ile ich idzie, żeby nie było niespodzianki
 * po drugiej stronie. Wysyłka omija bazę lokalną i outbox — to nie jest encja
 * produktu, tylko jednorazowa wiadomość na serwer.
 */

import { Redirect, Stack, useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { recentLogs } from '../app-log';
import { sessionCookie, useSession } from '../auth/client';
import { appConfig } from '../config/index';
import { feedbackProblem, FEEDBACK_MESSAGE_MAX_LENGTH, submitFeedback } from '../feedback';
import { SyncAuthError, SyncOfflineError } from '../sync/transport';
import { Button, Card, Field, Loading } from '../ui/primitives';

export function FeedbackScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const logs = recentLogs();

  const send = async () => {
    const invalid = feedbackProblem(message);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }

    setBusy(true);
    setProblem(null);
    try {
      await submitFeedback({
        baseUrl: appConfig.apiUrl,
        cookie: sessionCookie,
        message,
        logs,
      });
      setMessage('');
      setSent(true);
    } catch (error) {
      setProblem(
        error instanceof SyncOfflineError
          ? "Can't reach the server — you need to be on the VPN to send feedback"
          : error instanceof SyncAuthError
            ? 'Your session expired — sign in again'
            : error instanceof Error
              ? error.message
              : 'Failed to send feedback',
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Feedback' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card className="gap-3">
          <Field
            label="What's wrong, or what's missing"
            multiline
            numberOfLines={6}
            value={message}
            onChangeText={(value) => {
              setMessage(value);
              setSent(false);
            }}
            placeholder="Describe what happened…"
            maxLength={FEEDBACK_MESSAGE_MAX_LENGTH}
          />
          <Text className="text-xs text-muted">
            {logs.length === 0
              ? 'No app log entries this session — just the text above goes.'
              : `The last ${String(logs.length)} app log ${logs.length === 1 ? 'entry' : 'entries'} from this session go along with it, so a crash or a silent error is easier to track down.`}
          </Text>

          {problem !== null && <Text className="text-danger">{problem}</Text>}
          {sent && <Text className="text-success">Sent — thanks.</Text>}

          <Button label="Send feedback" busy={busy} onPress={() => void send()} />
        </Card>

        <Button variant="secondary" label="Back to account" onPress={() => router.back()} />
      </ScrollView>
    </SafeAreaView>
  );
}
