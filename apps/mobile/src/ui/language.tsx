/**
 * Karta „Language" na ekranie konta — przełącznik języka nazw.
 *
 * Etykiety języków są w nich samych („English", „Polski"), bo szuka się swojego
 * języka, a nie jego nazwy w cudzym. Z tego samego powodu nie ma tu chorągiewek:
 * flaga jest nazwą kraju, a nie języka.
 *
 * Podpis mówi wprost, czego wybór dotyczy — nazw ćwiczeń i tagów — bo reszta
 * interfejsu jest po angielsku i zostaje po angielsku. Obiecywanie w tym miejscu
 * przetłumaczonej aplikacji byłoby obietnicą, której ten przełącznik nie
 * spełnia.
 */

import { LANGUAGE_LABELS, LANGUAGES } from '@alphapump/core';
import { Text, View } from 'react-native';
import { useAppLanguage } from '../language/provider';
import { Card, Chip, ChipRow, SectionTitle } from './primitives';

export function LanguageSettings() {
  const { language, busy, choose } = useAppLanguage();

  return (
    <Card className="gap-2">
      <SectionTitle>Language</SectionTitle>
      <Text className="text-muted">
        Which language exercise and tag names show up in. Names without a translation stay as they
        were typed. The choice is kept on this device.
      </Text>
      <View className="mt-1">
        <ChipRow>
          {LANGUAGES.map((option) => (
            <Chip
              key={option}
              label={LANGUAGE_LABELS[option]}
              selected={language === option}
              // Zapis idzie w tle, ale drugie stuknięcie w trakcie zapisu nie
              // ma czego przyspieszyć — a kolejny zapis tej samej wartości
              // wyścigałby się z poprzednim.
              onPress={busy ? undefined : () => void choose(option)}
            />
          ))}
        </ChipRow>
      </View>
    </Card>
  );
}
