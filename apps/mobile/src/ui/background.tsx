/**
 * Tapeta na ekranie: zdjęcie pod całą aplikacją i karta ustawień w koncie.
 *
 * Zdjęcie leży w korzeniu, pod nawigacją, a ekrany są przezroczyste — dlatego
 * żaden z nich nie musi o tapecie wiedzieć. Nieprzezroczyste zostają karty,
 * nagłówek i paski akcji: to na nich stoi tekst, a tekst nad zdjęciem czyta się
 * źle niezależnie od tego, jakie ono jest.
 */

import { Image, StyleSheet, Text, View } from 'react-native';
import { useAppBackground } from '../background/provider';
import { MAX_BACKGROUND_BYTES } from '../background/state';
import { COLORS } from '../theme';
import { Button, Card, SectionTitle } from './primitives';

/**
 * Zdjęcie pod wszystkim, co rysuje aplikacja.
 *
 * Skalowanie to `cover`: zdjęcie wypełnia ekran w całości i z zachowaniem
 * proporcji, bo tapeta z paskami po bokach wygląda jak błąd, a rozciągnięta —
 * jak zepsuta.
 */
export function AppBackdrop() {
  const { uri } = useAppBackground();
  if (uri === null) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill} testID="app-backdrop">
      <Image source={{ uri }} resizeMode="cover" style={StyleSheet.absoluteFill} />
      {/* Przyciemnienie kolorem tła. Bez niego jasne zdjęcie zjada biały tekst
          list i podpisów — a to jest tapeta, nie nowy motyw. */}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: COLORS.base, opacity: 0.6 }]} />
    </View>
  );
}

const MAX_MEGABYTES = String(MAX_BACKGROUND_BYTES / (1024 * 1024));

/** Karta „Background" na ekranie konta — wybór zdjęcia i powrót do tła domyślnego. */
export function BackgroundSettings() {
  const { uri, busy, problem, choose, restore } = useAppBackground();

  return (
    <Card className="gap-2">
      <SectionTitle>Background</SectionTitle>
      <Text className="text-muted">
        {`Put your own photo behind the app instead of the plain dark background. JPG or PNG up to ${MAX_MEGABYTES} MB, scaled to fill the screen. The photo stays on this device.`}
      </Text>
      <Text className="text-lg text-text">
        {uri === null ? 'Default background' : 'Your photo'}
      </Text>

      {problem !== null && <Text className="text-danger">{problem}</Text>}

      <View className="mt-1 flex-row gap-2">
        <Button
          grow
          variant="secondary"
          label={uri === null ? 'Choose a photo' : 'Change photo'}
          busy={busy}
          onPress={() => void choose()}
        />
        {uri !== null && (
          <Button
            grow
            variant="secondary"
            label="Use the default"
            disabled={busy}
            onPress={() => void restore()}
          />
        )}
      </View>
    </Card>
  );
}
