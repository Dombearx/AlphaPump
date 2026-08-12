/**
 * Tokeny API.
 *
 * Specyfikacja daje każdemu użytkownikowi wiele tokenów — służą do korzystania
 * z API poza aplikacją, na przykład przez bota Discord w tym samym VPN-ie. Bez
 * tego ekranu mechanizm istniał, ale nie prowadziła do niego żadna droga:
 * token dało się wydać wyłącznie ręcznym żądaniem do endpointu better-autha.
 *
 * ## Dlaczego ten ekran czeka na sieć
 *
 * Tokeny są stanem serwera i nie mają czego robić w bazie lokalnej: to serwer
 * je weryfikuje i tylko on wie, czy token jeszcze żyje. Lista trzymana lokalnie
 * kłamałaby po unieważnieniu z innego urządzenia. Ekran zachowuje się więc jak
 * rankingi — brak łączności pokazuje jako spokojne „offline" z ponowieniem,
 * a nie jako awarię.
 *
 * ## Sekret widać raz
 *
 * Serwer oddaje pełny token wyłącznie w odpowiedzi na utworzenie; potem zna już
 * tylko jego hash i kilka pierwszych znaków. Dlatego świeży token stoi na górze
 * w osobnej karcie, z przyciskiem kopiowania i zdaniem mówiącym wprost, że
 * drugi raz go nie będzie — a nie w linijce listy, którą łatwo przewinąć.
 */

import * as Clipboard from 'expo-clipboard';
import { Redirect, Stack } from 'expo-router';
import { useCallback, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  API_KEY_NAME_MAX_LENGTH,
  apiKeyNameProblem,
  describeApiKey,
  maskApiKey,
  normalizeApiKeyName,
  toApiKeySummaries,
  type ApiKeySummary,
} from '../api-keys';
import { authClient, useSession } from '../auth/client';
import { today as currentDay } from '../day-labels';
import { useRemote } from '../remote/use-remote';
import { SyncAuthError, SyncOfflineError, SyncServerError } from '../sync/transport';
import { Button, Card, EmptyState, Field, Loading, Row, SectionTitle } from '../ui/primitives';

/**
 * Odpowiedź klienta better-autha w kształcie, który da się rozstrzygnąć.
 *
 * Endpointy tokenów wołamy przez `$fetch`, a nie przez wtyczkę `apiKeyClient`.
 * Powód jest w `auth/client.ts`: wtyczka Expo wchodzi tam z `@ts-expect-error`
 * przez rozjazd sygnatur w samej bibliotece, co zbija wnioskowanie typów dla
 * **całej** listy wtyczek — akcje dołożone przez kolejną i tak nie miałyby
 * typów. Trzy ścieżki wpisane wprost są uczciwsze niż wtyczka, po której
 * zostałaby wyłącznie zależność.
 */
interface AuthResult<T> {
  data: T | null;
  error: { message?: string; status?: number } | null;
}

/** Ścieżki pluginu `apiKey`, względem `basePath` better-autha (`/api/auth`). */
const API_KEY_PATHS = {
  list: '/api-key/list',
  create: '/api-key/create',
  delete: '/api-key/delete',
} as const;

/**
 * Sprowadza odpowiedź better-autha do wartości albo wyjątku z klas
 * synchronizacji — tych samych, które rozróżniają „offline" od awarii. Dzięki
 * temu ekran nie musi znać kształtu błędów biblioteki, a brak VPN-u wygląda tu
 * tak samo jak wszędzie indziej w aplikacji.
 */
async function unwrap<T>(call: Promise<AuthResult<T>>): Promise<T> {
  let result: AuthResult<T>;
  try {
    result = await call;
  } catch (error) {
    // Rzucony wyjątek znaczy, że żądanie nie wyszło poza telefon.
    throw new SyncOfflineError(error);
  }

  if (result.error !== null) {
    const status = result.error.status ?? 0;
    if (status === 401 || status === 403) throw new SyncAuthError();
    // Brak statusu to brak odpowiedzi — czyli jesteśmy poza VPN-em.
    if (status === 0) throw new SyncOfflineError(result.error);
    throw new SyncServerError(
      result.error.message ?? `Serwer odpowiedział ${String(status)}`,
      status,
    );
  }

  return result.data as T;
}

/** Żądanie do better-autha sprowadzone do wartości albo wyjątku. */
async function authFetch<T>(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown } = { method: 'GET' },
): Promise<T> {
  return unwrap(authClient.$fetch(path, init) as Promise<AuthResult<T>>);
}

const listKeys = async (): Promise<ApiKeySummary[]> => {
  const rows = await authFetch<unknown[]>(API_KEY_PATHS.list);
  return toApiKeySummaries(rows);
};

export function ApiKeysScreen() {
  const { data: session, isPending } = useSession();
  const today = currentDay();

  const { state, reload } = useRemote(listKeys, []);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  /** Świeżo wydany token — trzymany w pamięci ekranu i nigdzie indziej. */
  const [fresh, setFresh] = useState<{ id: string; name: string; secret: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const create = useCallback(async () => {
    const invalid = apiKeyNameProblem(name);
    if (invalid !== null) {
      setProblem(invalid);
      return;
    }

    setBusy(true);
    setProblem(null);
    const wanted = normalizeApiKeyName(name);

    try {
      const created = await authFetch<{ id: string; key: string }>(API_KEY_PATHS.create, {
        method: 'POST',
        body: { name: wanted },
      });
      setFresh({ id: created.id, name: wanted, secret: created.key });
      setCopied(false);
      setName('');
      reload();
    } catch (error) {
      setProblem(
        error instanceof SyncOfflineError
          ? 'Serwer jest nieosiągalny — token wydaje serwer, więc trzeba być w VPN-ie'
          : error instanceof Error
            ? error.message
            : 'Nie udało się wydać tokenu',
      );
    } finally {
      setBusy(false);
    }
  }, [name, reload]);

  const revoke = useCallback(
    async (key: ApiKeySummary) => {
      setBusy(true);
      setProblem(null);
      try {
        await authFetch(API_KEY_PATHS.delete, { method: 'POST', body: { keyId: key.id } });
        // Unieważniony token przestaje istnieć — także wtedy, gdy to właśnie on
        // stoi wyżej jako świeżo wydany.
        setFresh((shown) => (shown?.id === key.id ? null : shown));
        reload();
      } catch (error) {
        setProblem(error instanceof Error ? error.message : 'Nie udało się unieważnić tokenu');
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (isPending) return <Loading />;
  if (!session) return <Redirect href="/sign-in" />;

  return (
    <SafeAreaView className="flex-1 bg-base" edges={['bottom']}>
      <Stack.Screen options={{ title: 'Tokeny API' }} />

      <ScrollView contentContainerClassName="gap-4 p-4 pb-8">
        <Text className="text-muted">
          Token pozwala korzystać z API poza aplikacją — na przykład botowi zapisującemu serie.
          Działa wyłącznie wewnątrz VPN-u i możesz mieć ich wiele.
        </Text>

        {fresh !== null && (
          <Card className="gap-2 border-accent">
            <SectionTitle>Nowy token: {fresh.name}</SectionTitle>
            <Text selectable className="font-mono text-base text-text">
              {fresh.secret}
            </Text>
            <Text className="text-xs text-muted">
              Zapisz go teraz — serwer trzyma już tylko jego skrót i drugi raz go nie pokaże.
              Zgubiony token unieważnia się i wydaje nowy.
            </Text>
            <View className="mt-1">
              <Button
                variant="secondary"
                label={copied ? 'Skopiowano' : 'Kopiuj token'}
                onPress={() => {
                  void Clipboard.setStringAsync(fresh.secret).then(() => setCopied(true));
                }}
              />
            </View>
          </Card>
        )}

        <Card className="gap-3">
          <Field
            label="Nazwa nowego tokenu"
            value={name}
            onChangeText={(value) => {
              setName(value);
              setProblem(null);
            }}
            placeholder="bot Discord"
            maxLength={API_KEY_NAME_MAX_LENGTH}
            autoCapitalize="none"
            hint="Po nazwie poznasz, który token unieważnić."
          />
          {problem !== null && <Text className="text-sm text-danger">{problem}</Text>}
          <Button label="Wydaj token" busy={busy} onPress={() => void create()} />
        </Card>

        <SectionTitle>Wydane tokeny</SectionTitle>

        {state.status === 'loading' && <Loading label="Wczytywanie tokenów…" />}

        {state.status === 'offline' && (
          <View className="gap-4">
            <EmptyState
              title="Offline"
              hint="Tokenami zarządza serwer, więc ten ekran wymaga połączenia. Reszta aplikacji działa dalej."
            />
            <Button variant="secondary" label="Spróbuj ponownie" onPress={reload} />
          </View>
        )}

        {state.status === 'error' && (
          <View className="gap-4">
            <EmptyState title="Nie udało się pobrać tokenów" hint={state.message} />
            <Button variant="secondary" label="Spróbuj ponownie" onPress={reload} />
          </View>
        )}

        {state.status === 'ready' &&
          (state.data.length === 0 ? (
            <EmptyState
              title="Nie masz jeszcze tokenów"
              hint="Wydaj token dopiero wtedy, gdy jakieś narzędzie ma pisać do API w twoim imieniu."
            />
          ) : (
            <View className="gap-2">
              {state.data.map((key) => (
                <Row key={key.id}>
                  <View className="flex-1">
                    <Text className="text-base text-text">{key.name}</Text>
                    <Text className="text-xs text-muted">{describeApiKey(key, today)}</Text>
                    <Text className="font-mono text-xs text-muted">{maskApiKey(key)}</Text>
                  </View>
                  <Button
                    variant="danger"
                    label="Unieważnij"
                    disabled={busy}
                    onPress={() => void revoke(key)}
                  />
                </Row>
              ))}
            </View>
          ))}
      </ScrollView>
    </SafeAreaView>
  );
}
