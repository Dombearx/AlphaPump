/**
 * Zgłoszenie zwrotne.
 *
 * Celowo schowane w koncie, a nie na ekranie dnia: to jest kanał do zgłoszenia
 * problemu albo pomysłu, nie coś, po co sięga się w trakcie treningu.
 *
 * Do tekstu dokleja się automatycznie do 30 linijek diagnostyki: stan
 * synchronizacji tego telefonu razem z wierszami, których serwer nie przyjął,
 * a za nim bufor logów aplikacji (`feedback.ts`, `app-log.ts`). Bez pytania
 * o zgodę za każdym razem, ale **widocznie**: ekran mówi wprost, ile ich idzie,
 * żeby nie było niespodzianki po drugiej stronie. Wysyłka omija bazę lokalną
 * i outbox — to nie jest encja produktu, tylko jednorazowa wiadomość na serwer.
 */

import { Redirect, Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { AppLogEntry } from '../app-log';
import { sessionCookie, useSession } from '../auth/client';
import { appConfig } from '../config/index';
import { db } from '../db/client';
import {
  feedbackLogs,
  feedbackProblem,
  FEEDBACK_MESSAGE_MAX_LENGTH,
  submitFeedback,
} from '../feedback';
import { SyncAuthError, SyncOfflineError } from '../sync/transport';
import { Button, Card, Field, Loading } from '../ui/primitives';

export function FeedbackScreen() {
  const { data: session, isPending } = useSession();
  const router = useRouter();

  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  // Diagnostyka czytana jest z bazy, więc jest stanem, a nie wyliczeniem
  // w trakcie renderu. Pusta lista do czasu odczytu jest w porządku: ekran
  // mówi wtedy „nic nie jedzie", a przycisk i tak wysyła to, co ma w chwili
  // naciśnięcia.
  const [logs, setLogs] = useState<readonly AppLogEntry[]>([]);

  useEffect(() => {
    let alive = true;
    void feedbackLogs(db).then((entries) => {
      if (alive) setLogs(entries);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

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
        logs: [...logs],
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
    <SafeAreaView className="flex-1" edges={['bottom']}>
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
              ? 'Just the text above goes.'
              : `${String(logs.length)} diagnostic line(s) go along with it: how sync is doing on this device — including changes the server would not accept — and the app log from this session, so a stuck change or a silent error is easier to track down.`}
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
