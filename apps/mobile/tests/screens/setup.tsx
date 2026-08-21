/**
 * Atrapy warstwy, której w Node nie ma.
 *
 * Reguła jest jedna: **atrapujemy wyłącznie to, czego nie da się wykonać poza
 * telefonem**, i nigdy własnej logiki. Nawigacja (`expo-router`), obszar
 * bezpieczny, identyfikator urządzenia i zlecenie synchronizacji to warstwa
 * natywna albo wejście do niej. Baza lokalna, zapytania, podpowiedzi, walidacja
 * pomiarów i cały `src/ui` jadą **prawdziwe** — inaczej test sprawdzałby atrapy.
 *
 * `useLiveQuery` jest wyjątkiem pozornym: w aplikacji przelicza zapytanie po
 * każdej zmianie tabeli, tutaj wykonuje je raz. Odświeżanie jest zachowaniem
 * `expo-sqlite`, a nie naszym, a asercje i tak stawiamy po renderze — z tym, co
 * ekran zbudował z **prawdziwego** wyniku zapytania.
 */

import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { TEST_USER } from '../local-database';
import { liveDatabase } from './live-database';

vi.mock('expo-router', () => ({
  Redirect: () => null,
  Stack: { Screen: () => null },
  useRouter: () => ({ back: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  useLocalSearchParams: () => ({}),
}));

vi.mock('react-native-safe-area-context', async () => {
  const { View } = await import('react-native');
  return {
    SafeAreaView: View,
    SafeAreaProvider: View,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});

// `src/hooks` to dwa haczyki i oba stoją na warstwie natywnej: identyfikator
// urządzenia czytany z `expo-secure-store` oraz autor złożony z niego i z sesji
// better-autha. Logiki jest tu tyle, co sklejenia trzech wartości — atrapa nie
// zabiera żadnej reguły, a bez niej nie da się zaimportować modułu poza
// telefonem.
vi.mock('../../src/hooks', () => ({
  useDeviceId: () => 'device-a',
  useLocalAuthor: () => ({
    userId: TEST_USER.id,
    deviceId: 'device-a',
    role: 'user' as const,
    email: TEST_USER.email,
  }),
}));

// Klient better-autha jedzie przez `expo-secure-store` i schemat aplikacji —
// jedno i drugie istnieje wyłącznie na urządzeniu. Ekran potrzebuje z niego
// tylko tego, kto jest zalogowany.
vi.mock('../../src/auth/client', () => ({
  APP_SCHEME: 'alphapump',
  useSession: () => ({ data: { user: { id: TEST_USER.id } }, isPending: false }),
  signIn: { email: vi.fn(), social: vi.fn() },
  signUp: { email: vi.fn() },
  signOut: vi.fn(),
  sessionCookie: () => '',
}));

vi.mock('../../src/sync/provider', () => ({
  useRequestSync: () => vi.fn(),
  useSyncSnapshot: () => ({ phase: 'idle', pending: 0, rejected: 0 }),
}));

vi.mock('../../src/db/client', () => ({
  get db() {
    return liveDatabase();
  },
}));

vi.mock('drizzle-orm/expo-sqlite', () => ({
  useLiveQuery: <T,>(query: { all: () => T }) => ({ data: query.all(), error: undefined }),
}));

afterEach(cleanup);
