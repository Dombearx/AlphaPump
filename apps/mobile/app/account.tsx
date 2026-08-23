/**
 * Konto i stan wymiany danych.
 *
 * Ekran jest celowo ubogi: nick, adres, stan synchronizacji i wylogowanie.
 * Wszystko, co dotyczy treningu, dzieje się na widoku dnia — tu trafia się
 * rzadko i zwykle po to, żeby sprawdzić, czy dane pojechały.
 *
 * Wersja stoi tu z tego samego powodu, co stan synchronizacji: to jest ekran,
 * na który wchodzi się sprawdzić, czy coś dojechało. Dopóki jej nie było,
 * „zrestartowałem po aktualizacji, ale nie widzę zmiany" nie dawało się
 * rozstrzygnąć z wnętrza aplikacji — bo wydanie OTA nie rusza numeru wersji.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut, useSession } from '../src/auth/client';
import { today } from '../src/day-labels';
import { db } from '../src/db/client';
import { localUser } from '../src/db/queries';
import { describeSync } from '../src/sync/describe';
import { useSyncEngine, useSyncSnapshot } from '../src/sync/provider';
import { describeRunningBundle } from '../src/update/running';
import { useRunningBundle } from '../src/update/use-update';
import { BackgroundSettings } from '../src/ui/background';
import { LanguageSettings } from '../src/ui/language';
import { Button, Card, Loading, SectionTitle } from '../src/ui/primitives';

export default function AccountRoute() {
  const { data: session, isPending } = useSession();
  const snapshot = useSyncSnapshot();
  const engine = useSyncEngine();
  const router = useRouter();

  const account = useLiveQuery(localUser(db, session?.user.id ?? ''));
  const bundle = useRunningBundle();

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const description = describeSync(snapshot);
  const running = describeRunningBundle(bundle, today());

  return (
    <SafeAreaView className="flex-1" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Account' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card>
          <SectionTitle>Signed in as</SectionTitle>
          {/* Nick czytany z bazy lokalnej, a nie z sesji — to on dowodzi, że
              zapis wykonany przy logowaniu przerysował ekran bez odświeżania. */}
          <Text className="mt-1 text-2xl font-semibold text-text">
            {account.data[0]?.nickname ?? '—'}
          </Text>
          <Text className="mt-1 text-muted">{session.user.email}</Text>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Sync</SectionTitle>
          <Text className="text-lg text-text">{description.label}</Text>
          <Text className="text-muted">{description.detail}</Text>
          <View className="mt-2">
            <Button variant="secondary" label="Sync now" onPress={() => void engine?.syncNow()} />
          </View>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Data</SectionTitle>
          <Text className="text-muted">
            Export and import as JSON. Works offline — the data lives on this device.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Export and import"
              onPress={() => router.push('/transfer')}
            />
          </View>
        </Card>

        <LanguageSettings />

        <BackgroundSettings />

        <Card className="gap-2">
          <SectionTitle>API tokens</SectionTitle>
          <Text className="text-muted">
            For tools outside the app — for example a bot that logs sets. You can have several.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Manage tokens"
              onPress={() => router.push('/api-keys')}
            />
          </View>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Feedback</SectionTitle>
          <Text className="text-muted">
            Found a bug or missing something? Send a note — the app attaches its recent log entries
            automatically, so it's easier to track down.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Send feedback"
              onPress={() => router.push('/feedback')}
            />
          </View>
        </Card>

        <Card className="gap-1">
          <SectionTitle>Version</SectionTitle>
          {/* Numer pakietu jest tu największy, bo to on pada w rozmowie — ale
              o tym, czy wydanie dojechało, mówi dopiero data paczki niżej:
              wydanie OTA zostawia numer pakietu bez zmian. */}
          <Text className="mt-1 text-2xl font-semibold text-text">{running.version}</Text>
          <Text className="text-muted">{running.source}</Text>
          {running.detail.length > 0 && (
            <Text className="text-xs text-muted">{running.detail}</Text>
          )}
          {running.warning !== null && <Text className="mt-1 text-danger">{running.warning}</Text>}
        </Card>

        <Button variant="danger" label="Sign out" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
