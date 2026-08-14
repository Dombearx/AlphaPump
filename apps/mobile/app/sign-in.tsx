/**
 * Logowanie — e-mail z hasłem oraz Google.
 *
 * Konto jest obowiązkowe i nie ma trybu anonimowego, więc to jest pierwszy
 * ekran, jaki widzi nowa osoba. Rejestracja siedzi na tym samym ekranie:
 * osobny widok dla dwóch pól i przycisku byłby kosztem bez zysku.
 *
 * Po udanym logowaniu konto ląduje w bazie lokalnej. Nie jest to zapas na
 * przyszłość — ćwiczenia tworzone offline wskazują na autora kluczem obcym,
 * więc bez tego wiersza pierwsze własne ćwiczenie nie miałoby się do czego
 * odwołać.
 */

import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Redirect } from 'expo-router';
import { authClient, useSession } from '../src/auth/client';
import { signInWithGoogle } from '../src/auth/google';
import { appConfig, isGoogleSignInConfigured } from '../src/config/index';
import { db } from '../src/db/client';
import { cacheSessionUser } from '../src/db/users';
import { COLORS } from '../src/theme';

type Mode = 'sign-in' | 'sign-up';

export default function SignInScreen() {
  const { data: session } = useSession();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (session) return <Redirect href="/" />;

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const withEmail = () =>
    run(async () => {
      const result =
        mode === 'sign-in'
          ? await authClient.signIn.email({ email: email.trim(), password })
          : await authClient.signUp.email({
              email: email.trim(),
              password,
              name: nickname.trim() || email.trim(),
            });

      if (result.error) throw new Error(result.error.message ?? 'Sign-in failed');
      if (result.data?.user) await cacheSessionUser(db, result.data.user);
    });

  const withGoogle = () =>
    run(async () => {
      const { cancelled } = await signInWithGoogle();
      if (cancelled) return;
      const current = await authClient.getSession();
      if (current.data?.user) await cacheSessionUser(db, current.data.user);
    });

  return (
    <SafeAreaView className="flex-1 bg-base">
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerClassName="flex-grow justify-center gap-4 p-6">
          <View className="mb-2">
            <Text className="text-4xl font-bold text-text">AlphaPump</Text>
            <Text className="mt-1 text-muted">
              {mode === 'sign-in' ? 'Sign in to get started.' : 'Create an account — it only takes a moment.'}
            </Text>
          </View>

          {mode === 'sign-up' && (
            <Field
              label="Nickname"
              value={nickname}
              onChangeText={setNickname}
              placeholder="shown on records"
              autoCapitalize="none"
            />
          )}

          <Field
            label="Email"
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            autoCapitalize="none"
            keyboardType="email-address"
          />

          <Field
            label="Password"
            value={password}
            onChangeText={setPassword}
            placeholder="minimum 8 characters"
            secureTextEntry
          />

          {problem !== null && <Text className="text-danger">{problem}</Text>}

          <Pressable
            className="mt-2 rounded-2xl bg-accent p-4 active:opacity-80"
            disabled={busy}
            onPress={() => void withEmail()}
          >
            {busy ? (
              <ActivityIndicator color={COLORS.base} />
            ) : (
              <Text className="text-center text-base font-semibold text-base">
                {mode === 'sign-in' ? 'Sign in' : 'Create account'}
              </Text>
            )}
          </Pressable>

          {isGoogleSignInConfigured(appConfig) && (
            <Pressable
              className="rounded-2xl border border-border bg-surface p-4 active:opacity-70"
              disabled={busy}
              onPress={() => void withGoogle()}
            >
              <Text className="text-center text-base font-semibold text-text">
                Continue with Google
              </Text>
            </Pressable>
          )}

          <Pressable
            className="mt-2 active:opacity-70"
            onPress={() => setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')}
          >
            <Text className="text-center text-muted">
              {mode === 'sign-in' ? "Don't have an account? Create one." : 'Already have an account? Sign in.'}
            </Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

type FieldProps = {
  label: string;
} & React.ComponentProps<typeof TextInput>;

function Field({ label, ...input }: FieldProps) {
  return (
    <View className="gap-1">
      <Text className="text-sm uppercase tracking-wide text-muted">{label}</Text>
      <TextInput
        className="rounded-2xl border border-border bg-surface p-4 text-base text-text"
        placeholderTextColor={COLORS.muted}
        {...input}
      />
    </View>
  );
}
