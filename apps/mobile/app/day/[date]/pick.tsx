/**
 * Wybór ćwiczenia dla wskazanego dnia.
 *
 * Dzień jest w adresie, a nie w stanie aplikacji — dzięki temu powrót z tego
 * ekranu, ponowne wejście i przywrócenie aplikacji przez system trafiają zawsze
 * w ten sam dzień, o który chodziło.
 */

import { isIsoDate } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { PickExerciseScreen } from '../../../src/screens/pick-exercise';

export default function PickExerciseRoute() {
  const { date } = useLocalSearchParams<{ date: string }>();

  if (!isIsoDate(date)) return <Redirect href="/" />;
  return <PickExerciseScreen day={date} />;
}
