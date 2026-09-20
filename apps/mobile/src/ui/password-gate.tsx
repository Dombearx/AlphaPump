/**
 * Ekran „ustaw własne hasło", pokazywany nad całą aplikacją.
 *
 * Nad aplikacją, a nie jako trasa, bo dotyczy konta, a nie miejsca, w którym
 * ktoś akurat jest: hasło tymczasowe nadaje administrator w dowolnej chwili,
 * także wtedy, gdy telefon stoi otwarty na widoku dnia.
 *
 * Okna nie da się zamknąć i to jest różnica względem okna aktualizacji.
 * Aktualizacja może poczekać do jutra; hasło znane osobie trzeciej — nie.
 * Wyjście jest jedno i uczciwe: wylogowanie.
 */

import { useState } from 'react';
import { Modal, Text, View } from 'react-native';
import { MIN_PASSWORD_LENGTH } from '@alphapump/core';
import { signOut } from '../auth/client';
import type { PasswordGate as Gate } from '../auth/use-password-gate';
import { Button, Field, SectionTitle } from './primitives';

export function PasswordGate({ gate }: { gate: Gate }) {
  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (gate.state !== 'required') return null;

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const mismatch = repeat.length > 0 && repeat !== password;
  const ready = password.length >= MIN_PASSWORD_LENGTH && repeat === password;

  const submit = () => {
    setBusy(true);
    setProblem(null);
    void gate
      .setPassword(password)
      .catch((error: unknown) => {
        setProblem(error instanceof Error ? error.message : 'Could not set the password');
      })
      .finally(() => setBusy(false));
  };

  return (
    <Modal animationType="fade" transparent visible>
      <View className="flex-1 justify-end bg-black/60 p-4">
        <View className="gap-4 rounded-2xl border border-border bg-surface p-5">
          <View className="gap-1">
            <SectionTitle>Set your own password</SectionTitle>
            <Text className="text-muted">
              Your account uses a temporary password set by an administrator. Pick your own to carry
              on.
            </Text>
          </View>

          <Field
            label="New password"
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder={`minimum ${String(MIN_PASSWORD_LENGTH)} characters`}
          />
          <Field label="Repeat password" secureTextEntry value={repeat} onChangeText={setRepeat} />

          {tooShort && (
            <Text className="text-danger">
              Password is too short — {MIN_PASSWORD_LENGTH} characters at least.
            </Text>
          )}
          {mismatch && <Text className="text-danger">The two passwords differ.</Text>}
          {problem !== null && <Text className="text-danger">{problem}</Text>}

          <View className="flex-row gap-2">
            <Button
              label="Sign out"
              variant="secondary"
              onPress={() => void signOut()}
              disabled={busy}
              grow
            />
            <Button label="Save password" onPress={submit} disabled={!ready} busy={busy} grow />
          </View>
        </View>
      </View>
    </Modal>
  );
}
