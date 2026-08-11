/**
 * Ćwiczenie w bibliotece. Identyfikator przychodzi z adresu, więc może być
 * czymkolwiek — wartość, która nie jest UUID-em, zawraca do listy.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ExerciseScreen } from '../../../src/screens/exercise';

export default function ExerciseRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();

  if (!isUuid(exerciseId)) return <Redirect href="/library" />;
  return <ExerciseScreen exerciseId={exerciseId} />;
}
