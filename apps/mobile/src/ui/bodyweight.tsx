/**
 * Karta „Bodyweight" na ekranie konta — masa ciała podstawiana do serii.
 *
 * Jedno pole, jeden przycisk i lista dotychczasowych pomiarów. Pole jest
 * w kilogramach, bo w kilogramach wpisuje się ciężar wszędzie indziej
 * w aplikacji — jednostki są jedne dla całości i nie ma tu czego wybierać.
 *
 * Lista pokazuje **zmianę**, a nie same liczby: „78 kg" mówi mniej niż „78 kg,
 * −1.5 kg", a to drugie jest tym, po co ktokolwiek zapisuje swoją masę przez
 * kilka miesięcy. Pomiary starsze niż kilka ostatnich zostają w rejestrze, ale
 * nie na ekranie konta — ten ma być ustawieniem, a nie wykresem.
 *
 * Puste pole zapisane przyciskiem **kasuje** ustawienie razem z historią i jest
 * to jedyna droga wyjścia — osobny przycisk „Clear" robiłby to samo, co pole,
 * w którym i tak trzeba skasować liczbę. Podpis mówi o tym wprost, bo bez niego
 * kasowanie byłoby funkcją, o której nikt nie wie, a skasowanie historii —
 * niespodzianką.
 */

import { useState } from 'react';
import { Text, View } from 'react-native';
import { useBodyweight } from '../bodyweight/use-bodyweight';
import {
  parseBodyweightInput,
  type BodyweightEntry,
  type BodyweightStore,
} from '../bodyweight/state';
import { formatDate, today } from '../day-labels';
import { formatWeight } from '../measurements';
import { Button, Card, Field, Row, SectionTitle } from './primitives';

const PROBLEM =
  'Enter your weight in kilograms, for example 80.5 — or clear the field to remove it.';

/** Ile pomiarów mieści się w ustawieniach, zanim karta zrobi się listą. */
const HISTORY_SHOWN = 6;

/** Zmiana względem pomiaru poprzedniego; `null` przy pierwszym w historii. */
function changeLabel(entry: BodyweightEntry, older: BodyweightEntry | undefined): string | null {
  if (older === undefined) return null;

  const delta = entry.bodyweightG - older.bodyweightG;
  if (delta === 0) return 'no change';
  return `${delta > 0 ? '+' : '−'}${formatWeight(Math.abs(delta))} kg`;
}

export function BodyweightSettings({ store }: { store: BodyweightStore }) {
  const { history, bodyweightG, busy, save } = useBodyweight(store);
  // `null` znaczy „nikt jeszcze nie pisał", więc pole pokazuje wartość zapisaną
  // — także tę doczytaną z dysku **po** pierwszym renderze. Stan trzymany
  // wprost gubiłby ją albo wymagał efektu przepisującego jedno w drugie.
  const [text, setText] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const current = text ?? (bodyweightG === null ? '' : formatWeight(bodyweightG));
  const now = today();

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
        hint="Saved with today's date, so you can see how it changes."
        value={current}
        onChangeText={setText}
        placeholder="optional"
        keyboardType="decimal-pad"
      />
      {problem !== null && <Text className="text-danger">{problem}</Text>}
      <View className="mt-1">
        <Button variant="secondary" label="Save bodyweight" busy={busy} onPress={submit} />
      </View>

      {history.length > 0 && (
        <View className="mt-3 gap-2">
          <SectionTitle>History</SectionTitle>
          {history.slice(0, HISTORY_SHOWN).map((entry, index) => {
            const change = changeLabel(entry, history[index + 1]);

            return (
              <Row key={entry.on}>
                <Text className="text-base text-text">{formatWeight(entry.bodyweightG)} kg</Text>
                {change !== null && <Text className="text-xs text-muted">{change}</Text>}
                <Text className="flex-1 text-right text-xs text-muted">
                  {formatDate(entry.on, now)}
                </Text>
              </Row>
            );
          })}
          <Text className="text-xs text-muted">
            Clearing the field above removes the whole history.
          </Text>
        </View>
      )}
    </Card>
  );
}
