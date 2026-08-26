/**
 * Historia serii ćwiczenia. Identyfikator przychodzi z adresu, więc może być
 * czymkolwiek — wartość, która nie jest UUID-em, zawraca do listy.
 */

import { isUuid } from '@alphapump/core';
import { Redirect, useLocalSearchParams } from 'expo-router';
import { ExerciseHistoryScreen } from '../../../src/screens/exercise-history';

export default function ExerciseHistoryRoute() {
  const { exerciseId } = useLocalSearchParams<{ exerciseId: string }>();

  if (!isUuid(exerciseId)) return <Redirect href="/library" />;
  return <ExerciseHistoryScreen exerciseId={exerciseId} />;
}
