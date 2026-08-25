/**
 * Karta „Dictation" na ekranie konta — co zrobić z rozpoznaną serią.
 *
 * Jeden przełącznik i jedno zdanie pod nim. Zdanie mówi o **skutku**, a nie
 * o mechanizmie: „zapisuje serię od razu" zamiast „tryb `save`", bo wybiera się
 * tu zachowanie, a nie ustawienie.
 *
 * Podpis wspomina o serii niepełnej, bo to jedyny przypadek, w którym włączony
 * przełącznik nie robi tego, co obiecuje — a niewyjaśniony wyglądałby jak
 * awaria: „przecież mam włączone zapisywanie, a otworzył mi formularz".
 */

import { Text } from 'react-native';
import { useDictationMode } from '../dictation/use-dictation';
import type { DictationStore } from '../dictation/state';
import { Card, SectionTitle, Toggle } from './primitives';

export function DictationSettings({ store }: { store: DictationStore }) {
  const { mode, busy, choose } = useDictationMode(store);

  return (
    <Card className="gap-2">
      <SectionTitle>Dictation</SectionTitle>
      <Text className="text-muted">
        What happens after the app recognises a dictated set. The choice is kept on this device.
      </Text>
      <Toggle
        label="Save the set right away"
        hint="Off: the values go into the set form and you confirm them. A set missing some of its fields always opens the form."
        value={mode === 'save'}
        disabled={busy}
        onChange={(next) => void choose(next ? 'save' : 'form')}
      />
    </Card>
  );
}
