/**
 * Karta „Bodyweight" na ekranie konta — masa ciała podstawiana do serii.
 *
 * Jedno pole i jeden przycisk. Pole jest w kilogramach, bo w kilogramach
 * wpisuje się ciężar wszędzie indziej w aplikacji — jednostki są jedne dla
 * całości i nie ma tu czego wybierać.
 *
 * Puste pole zapisane przyciskiem **kasuje** ustawienie i jest to jedyna droga
 * wyjścia — osobny przycisk „Clear" robiłby to samo, co pole, w którym i tak
 * trzeba skasować liczbę. Podpis mówi o tym wprost, bo bez niego kasowanie
 * byłoby funkcją, o której nikt nie wie.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { useBodyweight } from '../bodyweight/use-bodyweight';
import { parseBodyweightInput, type BodyweightStore } from '../bodyweight/state';
import { formatWeight } from '../measurements';
import { Button, Card, Field, SectionTitle } from './primitives';

const PROBLEM =
  'Enter your weight in kilograms, for example 80.5 — or clear the field to remove it.';

export function BodyweightSettings({ store }: { store: BodyweightStore }) {
  const { bodyweightG, busy, save } = useBodyweight(store);
  // `null` znaczy „nikt jeszcze nie pisał", więc pole pokazuje wartość zapisaną
  // — także tę doczytaną z dysku **po** pierwszym renderze. Stan trzymany
  // wprost gubiłby ją albo wymagał efektu przepisującego jedno w drugie.
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const current = text ?? (bodyweightG === null ? '' : formatWeight(bodyweightG));

  const submit = () => {
    const empty = current.trim().length === 0;
    const parsed = empty ? null : parseBodyweightInput(current);

    if (!empty && parsed === null) {
      setProblem(PROBLEM);
      return;
    }

    setProblem(null);
    setText(null);
    void save(parsed);
  };

  return (
    <Card className="gap-2">
      <SectionTitle>Bodyweight</SectionTitle>
      <Text className="text-muted">
        Filled in for you when you log a set of a bodyweight exercise, so you don't have to type it
        every time. You can still change it for a single set. Kept on this device.
      </Text>
      {/* Etykieta pola jest inna niż tytuł karty, a nie ta sama dwa razy pod
          sobą: karta mówi, czego dotyczy ustawienie, a pole — że chodzi
          o wartość **dzisiejszą**, tę, która ma wejść do kolejnych serii. */}
      <Field
        label="Current weight"
        unit="kg"
        hint="Leave it empty and save to stop filling it in."
        value={current}
        onChangeText={setText}
        placeholder="optional"
        keyboardType="decimal-pad"
      />
      {problem !== null && <Text className="text-danger">{problem}</Text>}
      <View className="mt-1">
        <Button variant="secondary" label="Save bodyweight" busy={busy} onPress={submit} />
      </View>
    </Card>
  );
}
