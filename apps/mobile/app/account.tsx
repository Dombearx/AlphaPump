/**
 * Konto i stan wymiany danych.
 *
 * Ekran jest celowo ubogi: nick, adres, stan synchronizacji i wylogowanie.
 * Wszystko, co dotyczy treningu, dzieje się na widoku dnia — tu trafia się
 * rzadko i zwykle po to, żeby sprawdzić, czy dane pojechały.
 */

import { useLiveQuery } from 'drizzle-orm/expo-sqlite';
import { Redirect, Stack, useRouter } from 'expo-router';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { signOut, useSession } from '../src/auth/client';
import { db } from '../src/db/client';
import { localUser } from '../src/db/queries';
import { describeSync } from '../src/sync/describe';
import { useSyncEngine, useSyncSnapshot } from '../src/sync/provider';
import { Button, Card, Loading, SectionTitle } from '../src/ui/primitives';

export default function AccountRoute() {
  const { data: session, isPending } = useSession();
  const snapshot = useSyncSnapshot();
  const engine = useSyncEngine();
  const router = useRouter();

  const account = useLiveQuery(localUser(db, session?.user.id ?? ''));

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  const description = describeSync(snapshot);

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Konto' }} />

      <ScrollView contentContainerClassName="gap-4 p-4">
        <Card>
          <SectionTitle>Zalogowano jako</SectionTitle>
          {/* Nick czytany z bazy lokalnej, a nie z sesji — to on dowodzi, że
              zapis wykonany przy logowaniu przerysował ekran bez odświeżania. */}
          <Text className="mt-1 text-2xl font-semibold text-text">
            {account.data[0]?.nickname ?? '—'}
          </Text>
          <Text className="mt-1 text-muted">{session.user.email}</Text>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Synchronizacja</SectionTitle>
          <Text className="text-lg text-text">{description.label}</Text>
          <Text className="text-muted">{description.detail}</Text>
          <View className="mt-2">
            <Button
              variant="secondary"
              label="Synchronizuj teraz"
              onPress={() => void engine?.syncNow()}
            />
          </View>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Dane</SectionTitle>
          <Text className="text-muted">
            Eksport i import w JSON-ie. Działa bez internetu — dane są na tym urządzeniu.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Eksport i import"
              onPress={() => router.push('/transfer')}
            />
          </View>
        </Card>

        <Card className="gap-2">
          <SectionTitle>Tokeny API</SectionTitle>
          <Text className="text-muted">
            Dla narzędzi poza aplikacją — na przykład bota zapisującego serie. Możesz mieć ich
            wiele.
          </Text>
          <View className="mt-1">
            <Button
              variant="secondary"
              label="Zarządzaj tokenami"
              onPress={() => router.push('/api-keys')}
            />
          </View>
        </Card>

        <Button variant="danger" label="Wyloguj" onPress={() => void signOut()} />
      </ScrollView>
    </SafeAreaView>
  );
}
