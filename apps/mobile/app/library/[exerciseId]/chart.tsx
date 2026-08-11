/**
 * Ekran analityczny ćwiczenia. Identyfikator przychodzi z adresu, więc może być
 * czymkolwiek — wartość, która nie jest UUID-em, zawraca do listy.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ExerciseChartScreen } from '../../../src/screens/exercise-chart';

export default function ExerciseChartRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();

  if (!isUuid(exerciseId)) return <Redirect href="/library" />;
  return <ExerciseChartScreen exerciseId={exerciseId} />;
}
