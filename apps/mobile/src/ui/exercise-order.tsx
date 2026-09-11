/**
 * Karta „Exercise list" na ekranie konta — po czym układa się lista przy
 * dodawaniu serii.
 *
 * Jeden przełącznik i jedno zdanie pod nim, jak przy dyktowaniu. Zdanie mówi
 * o **skutku**, a nie o mechanizmie: „na górze to, co domyka cykl" zamiast
 * nazwy algorytmu, bo wybiera się tu zachowanie listy, a nie ustawienie.
 *
 * Cardio jest w podpisie wymienione wprost, bo to jedyny przypadek, w którym
 * włączony przełącznik świadomie nie robi tego, co obiecuje — a niewyjaśniony
 * wyglądałby jak awaria: „mam w cyklu bieganie, a nic mi go nie podpowiada".
 */

import { Text } from 'react-native';
import type { ExerciseOrderStore } from '../exercise-order/state';
import { useExerciseOrder } from '../exercise-order/use-exercise-order';
import { Card, SectionTitle, Toggle } from './primitives';

export function ExerciseOrderSettings({ store }: { store: ExerciseOrderStore }) {
  const { order, busy, choose } = useExerciseOrder(store);

  return (
    <Card className="gap-2">
      <SectionTitle>Exercise list</SectionTitle>
      <Text className="text-muted">
        How the library is ordered when you pick an exercise for a set. The choice is kept on this
        device.
      </Text>
      <Toggle
        label="Suggest what to do next"
        hint="On: exercises that fill what is left in your active cycles come first, preferring the ones that rest the muscles you have just worked. Cardio is left out of it. Off: the exercises you log most often come first."
        value={order === 'rotation'}
        disabled={busy}
        onChange={(next) => void choose(next ? 'rotation' : 'usage')}
      />
    </Card>
  );
}
