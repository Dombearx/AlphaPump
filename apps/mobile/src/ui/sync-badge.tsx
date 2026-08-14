/**
 * Pigułka statusu synchronizacji w nagłówku.
 *
 * Specyfikacja pozwala pokazywać status „dyskretnie", ze szczegółami po
 * tapnięciu — i tak to jest zrobione: w nagłówku jedno słowo, reszta dopiero po
 * dotknięciu. Status nigdy nie przerywa pracy, bo synchronizacja nie jest
 * czynnością użytkownika.
 */

import { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { describeSync, type SyncTone } from '../sync/describe';
import { useSyncEngine, useSyncSnapshot } from '../sync/provider';
import { Button } from './primitives';

const TONE: Record<SyncTone, { dot: string; text: string }> = {
  neutral: { dot: 'bg-muted', text: 'text-muted' },
  progress: { dot: 'bg-accent', text: 'text-accent' },
  warning: { dot: 'bg-accent', text: 'text-text' },
  danger: { dot: 'bg-danger', text: 'text-danger' },
};

export function SyncBadge() {
  const snapshot = useSyncSnapshot();
  const engine = useSyncEngine();
  const [open, setOpen] = useState(false);
  const description = describeSync(snapshot);
  const tone = TONE[description.tone];

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Sync status: ${description.label}`}
        className="flex-row items-center gap-2 px-2 py-1 active:opacity-70"
        onPress={() => setOpen(true)}
      >
        <View className={`h-2 w-2 rounded-full ${tone.dot}`} />
        <Text className={`text-xs ${tone.text}`}>{description.label}</Text>
      </Pressable>

      <Modal transparent visible={open} animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/60" onPress={() => setOpen(false)}>
          <View className="gap-4 rounded-t-3xl border-t border-border bg-surface p-6">
            <View className="gap-1">
              <Text className="text-lg font-semibold text-text">Sync</Text>
              <Text className="text-muted">{description.detail}</Text>
            </View>

            {snapshot.rejected > 0 && (
              <Text className="text-danger">
                The server rejected {snapshot.rejected} row(s) from the last batch — this usually
                means missing permission to edit someone else's exercise.
              </Text>
            )}

            <View className="flex-row gap-3">
              <Button
                grow
                label="Sync now"
                onPress={() => {
                  // Świadomie bez `await` — okno nie ma na co czekać, a wynik
                  // i tak pokaże się sam, bo pigułka słucha silnika.
                  void engine?.syncNow();
                  setOpen(false);
                }}
              />
              <Button grow variant="secondary" label="Close" onPress={() => setOpen(false)} />
            </View>
          </View>
        </Pressable>
      </Modal>
    </>
  );
}
